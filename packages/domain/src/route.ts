import { ATTRS, formatValue } from './attributes';
import { nearestNode, shortestPath } from './graph';
import type { Graph } from './graph';
import { evaluate } from './rules';
import type { Evaluation, Profile, Reason, Values } from './rules';
import type { Feature, LonLat } from './types';

const CROSSING_BASE_M = 20;
const HARD_PENALTY = 1000;
const SNAP_M = 100;

export interface RouteStep { featureId: string; kind: Feature['kind']; name?: string; lengthM: number; text: string; reasons: Reason[] }
export interface RouteSummary {
  lengthM: number;
  crossings: { total: number; tactile: number; sound: number; unknown: number };
  stepsCount: number;
  surfaces: Record<string, number>;   // etykieta PL → metry
  unknownM: number;
}
export interface RouteResult {
  coords: LonLat[];
  summary: RouteSummary;
  sentence: string;
  steps: RouteStep[];
  violatesHardRules: boolean;
  violated: Reason[];
}
export type RouteError = { error: 'out_of_area' | 'no_route' };

export function planRoute(
  g: Graph, featuresById: Map<string, Feature>, valuesOf: (featureId: string) => Values,
  profile: Profile, from: LonLat, to: LonLat,
): RouteResult | RouteError {
  const a = nearestNode(g, from, SNAP_M);
  const b = nearestNode(g, to, SNAP_M);
  if (!a || !b) return { error: 'out_of_area' };

  const cache = new Map<string, Evaluation>();
  const ev = (id: string) => {
    let e = cache.get(id);
    if (!e) { e = evaluate(profile, valuesOf(id), featuresById.get(id)!.kind); cache.set(id, e); }
    return e;
  };
  const run = (strict: boolean) => shortestPath(g, a, b,
    (e) => { const x = ev(e.featureId); return x.blocked ? (strict ? Infinity : e.lengthM * x.costMultiplier * HARD_PENALTY) : e.lengthM * x.costMultiplier; },
    (n) => {
      const fid = g.nodeFeature.get(n);
      if (!fid) return 0;
      const x = ev(fid);
      if (x.blocked) return strict ? Infinity : CROSSING_BASE_M * HARD_PENALTY;
      return CROSSING_BASE_M * Math.max(0, x.costMultiplier - 1);
    });

  let path = run(true);
  let violatesHardRules = false;
  if (!path) { path = run(false); violatesHardRules = true; }
  if (!path) return { error: 'no_route' };

  const coords: LonLat[] = [];
  const steps: RouteStep[] = [];
  const violated: Reason[] = [];
  const summary: RouteSummary = { lengthM: 0, crossings: { total: 0, tactile: 0, sound: 0, unknown: 0 }, stepsCount: 0, surfaces: {}, unknownM: 0 };

  for (const e of path) {
    const f = featuresById.get(e.featureId)!;
    const v = valuesOf(f.id);
    const x = ev(f.id);
    const c = e.forward ? f.coords : [...f.coords].reverse();
    coords.push(...(coords.length ? c.slice(1) : c));
    summary.lengthM += f.lengthM;
    if (v.steps === true) summary.stepsCount++;
    const surf = v.surface === undefined ? 'brak danych' : formatValue('surface', v.surface);
    summary.surfaces[surf] = Math.round((summary.surfaces[surf] ?? 0) + f.lengthM);
    if (x.reasons.some((r) => r.kind === 'unknown')) summary.unknownM += f.lengthM;
    if (x.blocked) violated.push(...x.reasons.filter((r) => r.kind === 'hard'));

    const name = f.name ?? (v.steps === true ? 'schody' : 'odcinek bez nazwy');
    const notes = x.reasons.filter((r) => r.kind !== 'unknown');
    const last = steps[steps.length - 1];
    const sig = notes.map((r) => r.text).join('; ');
    if (last && last.kind === 'segment' && last.name === name && last.reasons.map((r) => r.text).join('; ') === sig) {
      last.lengthM += f.lengthM;
      last.text = stepText(name, last.lengthM, sig);
    } else {
      steps.push({ featureId: f.id, kind: 'segment', name, lengthM: f.lengthM, text: stepText(name, f.lengthM, sig), reasons: notes });
    }

    const nfId = g.nodeFeature.get(e.to);
    if (nfId) {
      const nf = featuresById.get(nfId)!;
      const nv = valuesOf(nfId);
      const nx = ev(nfId);
      if (nx.blocked) violated.push(...nx.reasons.filter((r) => r.kind === 'hard'));
      if (nf.kind === 'crossing') {
        summary.crossings.total++;
        if (nv.tactile_paving === true) summary.crossings.tactile++;
        if (nv.signal_sound === true) summary.crossings.sound++;
        if (nv.tactile_paving === undefined || nx.reasons.some((r) => r.kind === 'unknown')) summary.crossings.unknown++;
      }
      const facts = ['tactile_paving', 'signal_sound', 'kerb_height_cm']
        .map((attr) => `${ATTRS[attr].label.toLowerCase()}: ${nv[attr] === undefined ? 'brak danych' : formatValue(attr, nv[attr]!)}`)
        .join(', ');
      steps.push({ featureId: nfId, kind: nf.kind, lengthM: 0, text: `${nf.kind === 'crossing' ? 'Przejście' : 'Krawężnik'} (${facts})`, reasons: nx.reasons.filter((r) => r.kind !== 'unknown') });
    }
  }
  summary.lengthM = Math.round(summary.lengthM);
  summary.unknownM = Math.round(summary.unknownM);
  const c = summary.crossings;
  const sentence = `Trasa ${summary.lengthM} m. Przejścia: ${c.total} (pola uwagi: ${c.tactile}, sygnał dźwiękowy: ${c.sound}, brak danych: ${c.unknown}). Schody: ${summary.stepsCount}. Odcinki z brakami danych: ${summary.unknownM} m.`;
  return { coords, summary, sentence, steps, violatesHardRules, violated };
}

function stepText(name: string, lengthM: number, notes: string): string {
  return `${name}, ${Math.round(lengthM)} m${notes ? ` — ${notes}` : ''}`;
}
