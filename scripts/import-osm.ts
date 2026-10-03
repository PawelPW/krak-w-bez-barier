import { mkdirSync, writeFileSync } from 'node:fs';
import { polylineLength } from '../packages/domain/src/index';
import type { AttrValue, Feature, LonLat, Snapshot } from '../packages/domain/src/index';

const BBOX = { south: 50.045, west: 19.925, north: 50.068, east: 19.955 };
const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const FOOT = 'footway|path|pedestrian|steps|living_street|residential|service|cycleway';
const ROADS = 'unclassified|tertiary|secondary|primary';

type Tags = Record<string, string>;
interface OsmWay { type: 'way'; id: number; timestamp: string; tags?: Tags; nodes: number[]; geometry: { lat: number; lon: number }[] }
interface RawWay { type: 'way'; id: number; timestamp: string; tags?: Tags; nodes: number[] }
interface OsmNode { type: 'node'; id: number; timestamp: string; tags?: Tags; lat: number; lon: number }

const yesNo = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === 'no' || v === 'incorrect' ? false : true;

function parseMeters(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return /cm/.test(v) ? n / 100 : n;
}

function parseIncline(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;   // "up" / "down"
  if (v.includes('°')) return Math.round(Math.abs(Math.tan((n * Math.PI) / 180)) * 100);
  return Math.abs(Math.round(n));
}

const KERB_CM: Record<string, number> = { flush: 0, lowered: 3, raised: 12, rolled: 6 };

function wayAttrs(t: Tags): Record<string, AttrValue> {
  const a: Record<string, AttrValue> = {
    steps: t.highway === 'steps',
    cycleway: t.highway === 'cycleway' || t.bicycle === 'designated',
    open_area: t.highway === 'pedestrian' && t.area === 'yes',
  };
  if (t.surface) a.surface = t.surface;
  if (t.smoothness) a.smoothness = t.smoothness;
  const w = parseMeters(t.width);
  if (w !== undefined) a.width_cm = Math.round(w * 100);
  const inc = parseIncline(t.incline);
  if (inc !== undefined) a.incline_pct = inc;
  const ramp = yesNo(t['ramp:wheelchair'] ?? t.ramp);
  if (ramp !== undefined) a.ramp = ramp;
  const handrail = yesNo(t.handrail);
  if (handrail !== undefined) a.handrail = handrail;
  const guide = yesNo(t.tactile_paving);
  if (guide !== undefined) a.guidance_line = guide;
  const lit = yesNo(t.lit);
  if (lit !== undefined) a.lit = lit;
  return a;
}

function nodeAttrs(t: Tags): Record<string, AttrValue> {
  const a: Record<string, AttrValue> = {};
  const tp = yesNo(t.tactile_paving);
  if (tp !== undefined) a.tactile_paving = tp;
  const snd = yesNo(t['traffic_signals:sound']);
  if (snd !== undefined) a.signal_sound = snd;
  const vib = yesNo(t['traffic_signals:vibration']);
  if (vib !== undefined) a.signal_vibration = vib;
  if (t.kerb && t.kerb in KERB_CM) a.kerb_height_cm = KERB_CM[t.kerb];
  return a;
}

function usable(t: Tags): boolean {
  if (t.access === 'private' || t.access === 'no' || t.foot === 'no') return false;
  if (new RegExp(`^(${ROADS})$`).test(t.highway) && /^(no|none|separate)$/.test(t.sidewalk ?? '')) return false;
  return true;
}

const API = 'https://api.openstreetmap.org/api/0.6/map.json';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Box = { south: number; west: number; north: number; east: number };

async function fetchBox(b: Box, out: (RawWay | OsmNode)[]): Promise<void> {
  const res = await fetch(`${API}?bbox=${b.west},${b.south},${b.east},${b.north}`, {
    headers: { 'User-Agent': 'krakow-bez-granic-demo' },
  });
  await sleep(1000);
  if (res.status === 400) {
    const mx = (b.west + b.east) / 2, my = (b.south + b.north) / 2;
    for (const q of [
      { south: b.south, west: b.west, north: my, east: mx }, { south: b.south, west: mx, north: my, east: b.east },
      { south: my, west: b.west, north: b.north, east: mx }, { south: my, west: mx, north: b.north, east: b.east },
    ]) await fetchBox(q, out);
    return;
  }
  if (!res.ok) throw new Error(`OSM API ${res.status}: ${await res.text()}`);
  const { elements } = (await res.json()) as { elements: { type: string }[] };
  for (const e of elements) if (e.type === 'node' || e.type === 'way') out.push(e as RawWay | OsmNode);
}

const inBbox = (n: OsmNode) => n.lat >= BBOX.south && n.lat <= BBOX.north && n.lon >= BBOX.west && n.lon <= BBOX.east;

async function main() {
  const raw: (RawWay | OsmNode)[] = [];
  const N = 3;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    await fetchBox({
      south: BBOX.south + ((BBOX.north - BBOX.south) * i) / N, north: BBOX.south + ((BBOX.north - BBOX.south) * (i + 1)) / N,
      west: BBOX.west + ((BBOX.east - BBOX.west) * j) / N, east: BBOX.west + ((BBOX.east - BBOX.west) * (j + 1)) / N,
    }, raw);
  }
  const nodeMap = new Map<number, OsmNode>();
  const rawWays = new Map<number, RawWay>();
  for (const e of raw) { if (e.type === 'node') nodeMap.set(e.id, e); else rawWays.set(e.id, e); }

  const highwayRe = new RegExp(`^(${FOOT}|${ROADS})$`);
  let skippedWays = 0;
  const ways: OsmWay[] = [];
  for (const w of rawWays.values()) {
    const t = w.tags ?? {};
    if (!t.highway || !highwayRe.test(t.highway) || !usable(t)) continue;
    const pts = w.nodes.map((id) => nodeMap.get(id));
    if (pts.some((p) => !p)) { skippedWays++; continue; }
    ways.push({ ...w, geometry: pts.map((p) => ({ lat: p!.lat, lon: p!.lon })) });
  }
  const keptNodeIds = new Set<number>();
  for (const w of ways) for (const n of w.nodes) keptNodeIds.add(n);
  const nodes = [...nodeMap.values()].filter((n) => {
    const t = n.tags ?? {};
    return (t.highway === 'crossing' || t.barrier === 'kerb') && (inBbox(n) || keptNodeIds.has(n.id));
  });

  const use = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes) use.set(n, (use.get(n) ?? 0) + 1);
  const splitAt = new Set<number>(nodes.map((n) => n.id));
  for (const [n, c] of use) if (c > 1) splitAt.add(n);

  const features: Feature[] = [];
  for (const w of ways) {
    const tags = w.tags ?? {};
    const attrs = wayAttrs(tags);
    let start = 0, k = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && !splitAt.has(w.nodes[i])) continue;
      const coords: LonLat[] = w.geometry.slice(start, i + 1).map((g) => [g.lon, g.lat]);
      const lengthM = polylineLength(coords);
      if (lengthM > 0.5) {
        features.push({
          id: `way/${w.id}#${k++}`, kind: 'segment', osmType: 'way', osmId: w.id,
          name: tags.name, coords, lengthM: Math.round(lengthM * 10) / 10,
          from: String(w.nodes[start]), to: String(w.nodes[i]),
          osmTimestamp: w.timestamp, attrs,
        });
      }
      start = i;
    }
  }
  for (const n of nodes) {
    const tags = n.tags ?? {};
    features.push({
      id: `node/${n.id}`, kind: tags.highway === 'crossing' ? 'crossing' : 'kerb',
      osmType: 'node', osmId: n.id, coords: [[n.lon, n.lat]], lengthM: 0,
      nodeId: String(n.id), osmTimestamp: n.timestamp, attrs: nodeAttrs(tags),
    });
  }

  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), bbox: BBOX, features };
  mkdirSync('data', { recursive: true });
  writeFileSync('data/krakow.json', JSON.stringify(snapshot));
  const cr = features.filter((f) => f.kind === 'crossing');
  console.log({
    segments: features.filter((f) => f.kind === 'segment').length,
    crossings: cr.length,
    crossingsWithTactile: cr.filter((f) => 'tactile_paving' in f.attrs).length,
    crossingsWithSound: cr.filter((f) => 'signal_sound' in f.attrs).length,
    skippedWays,
    withSurface: features.filter((f) => 'surface' in f.attrs).length,
  });
}
main();
