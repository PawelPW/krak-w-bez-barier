# Kraków bez granic — plan implementacji dema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Działające na telefonie demo PWA pokazujące fakty o dostępności odcinków i przejść Starego Miasta i Kazimierza, z profilami, trasą zależną od profilu, zgłoszeniem ze zdjęciem i AI oraz potwierdzaniem zgłoszeń.

**Architecture:** Monorepo pnpm. `packages/domain` zawiera całą logikę (słownik atrybutów, reguły, pewność, reputacja, graf, trasa) i jest używany zarówno przez serwer, jak i klienta. `apps/api` (Hono) trzyma migawkę OSM w pamięci, dane społeczności w SQLite i serwuje zbudowany front z `apps/web` (React + MapLibre).

**Tech Stack:** Node 22, pnpm, TypeScript, tsx, Hono, `node:sqlite`, React 18, Vite, MapLibre GL JS, vite-plugin-pwa, `@anthropic-ai/sdk`, Railway.

Spec: `docs/superpowers/specs/2026-10-03-krakow-bez-granic-design.md`

## Global Constraints

- **Bez testów automatycznych.** Decyzja użytkownika. Każde zadanie kończy się ręczną weryfikacją opisaną w ostatnich krokach.
- Budżet 15 h. Kolejność cięcia przy poślizgu: reputacja (Task 9), AI (Task 10), routing (Task 5 i 8).
- Interfejs po polsku, mobile first. Identyfikatory w kodzie po angielsku.
- Pakiet `@kbg/domain` jest importowany jako źródło TypeScript (bez kroku budowania). Importy względne w całym repo bez rozszerzeń.
- Brak tagu OSM nigdy nie tworzy obserwacji ani wartości „nie ma”.
- Profil potrzeb nie jest zapisywany ani logowany na serwerze.
- `ANTHROPIC_API_KEY` wyłącznie po stronie serwera, nigdy w `apps/web`.
- Obszar: `south=50.045, west=19.925, north=50.068, east=19.955`.
- Stałe z briefu i spec: wagi źródeł osm 0,6 / user 0,8 / ai 0,3; półokres 180 dni; reputacja start 0,5, zakres 0,1–1,0; okno kary 7 dni; kary −0,05 / −0,15; nagroda +0,05.
- Commit po każdym zadaniu, ze stopką `Co-Authored-By` ustawioną w sesji.
- Deploy na Railway (Task 11) wymaga wyraźnej zgody użytkownika w momencie wykonania.

## Struktura plików

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, Dockerfile
data/krakow.json                      migawka OSM (commitowana)
scripts/import-osm.ts                 Overpass → data/krakow.json
packages/domain/src/
  types.ts        Feature, AttrValue, Source, AttributeState, Snapshot
  attributes.ts   słownik ATTRS, isBarrier, formatValue
  geo.ts          haversine, pointToSegmentM, nearestFeature
  rules.ts        Rule, Profile, evaluate, statusOf, mergeOverrides
  profiles.ts     PROFILES (7)
  confidence.ts   computeState
  reputation.ts   reputationDelta, clampReputation
  graph.ts        buildGraph, nearestNode, shortestPath
  route.ts        planRoute, RouteResult
  index.ts        re-eksport
apps/api/src/
  db.ts           otwarcie SQLite, schemat
  store.ts        seed OSM, recompute, cache stanów, zapisy
  ai.ts           classifyPhoto
  app.ts          trasy Hono
  server.ts       start, pliki statyczne
apps/web/src/
  main.tsx, App.tsx, styles.css
  api.ts          klient HTTP
  state.tsx       kontekst: dane, profil, wybór, trasa
  profileStore.ts localStorage: profil, nadpisania, authorId
  components/TabBar.tsx, MapView.tsx, FeatureSheet.tsx, AttrRow.tsx,
             ListView.tsx, ProfileView.tsx, RouteView.tsx, ReportDialog.tsx
```

---

### Task 1: Szkielet monorepo i typy domeny

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`
- Create: `packages/domain/src/types.ts`, `attributes.ts`, `geo.ts`, `index.ts`

**Interfaces:**
- Produces: typy `Feature`, `AttrValue`, `Source`, `AttributeState`, `Snapshot`; `ATTRS`, `isBarrier(attr, value)`, `formatValue(attr, value)`; `haversine(a, b)`, `pointToSegmentM(p, a, b)`, `nearestFeature(features, p, maxM)`.

- [ ] **Step 1: Pliki główne**

`package.json`:
```json
{
  "name": "krakow-bez-granic",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "import:osm": "tsx scripts/import-osm.ts",
    "dev:api": "pnpm --filter @kbg/api dev",
    "dev:web": "pnpm --filter @kbg/web dev",
    "build": "pnpm --filter @kbg/web build",
    "start": "pnpm --filter @kbg/api start",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0", "@types/node": "^22.0.0" }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
onlyBuiltDependencies:
  - esbuild
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": true, "resolveJsonModule": true,
    "noEmit": true, "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

`.gitignore`:
```
node_modules
dist
.env
var/
```

`packages/domain/package.json`:
```json
{ "name": "@kbg/domain", "version": "0.0.0", "private": true, "type": "module",
  "main": "src/index.ts", "types": "src/index.ts" }
```

`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: `packages/domain/src/types.ts`**

```ts
export type AttrValue = string | number | boolean;
export type Source = 'osm' | 'user' | 'ai';
export type FeatureKind = 'segment' | 'crossing' | 'kerb';
export type LonLat = [number, number];

export interface Feature {
  id: string;                 // "way/123#4" | "node/456"
  kind: FeatureKind;
  osmType: 'way' | 'node';
  osmId: number;
  name?: string;
  coords: LonLat[];           // segment: polilinia; węzeł: jeden punkt
  lengthM: number;            // 0 dla węzłów
  from?: string;              // id węzła OSM (segment)
  to?: string;
  nodeId?: string;            // id węzła OSM (crossing, kerb)
  osmTimestamp: string;       // ISO, data ostatniej edycji obiektu
  attrs: Record<string, AttrValue>; // tylko atrybuty obecne w OSM
}

export interface Snapshot {
  generatedAt: string;
  bbox: { south: number; west: number; north: number; east: number };
  features: Feature[];
}

export interface AttributeState {
  value: AttrValue;
  confidence: number;         // 0..1
  lastConfirmed: string;      // ISO
  sources: Source[];
  unconfirmed: boolean;
}

export type StatesByAttr = Record<string, AttributeState>;
export type StatesByFeature = Record<string, StatesByAttr>;
```

- [ ] **Step 3: `packages/domain/src/attributes.ts`**

```ts
import type { AttrValue } from './types';

export type AppliesTo = 'segment' | 'node';
export interface AttrDef {
  label: string;
  type: 'bool' | 'number' | 'enum';
  unit?: string;
  options?: Record<string, string>;        // enum: wartość → etykieta PL
  appliesTo: AppliesTo[];
  barrier: (v: AttrValue) => boolean;      // czy wartość oznacza barierę
  unknownIsNeutral?: boolean;              // brak danych nie podnosi kosztu
  reportable?: boolean;                    // widoczny w formularzu zgłoszenia
}

const SURFACES: Record<string, string> = {
  asphalt: 'asfalt', concrete: 'beton', paving_stones: 'kostka betonowa',
  sett: 'kostka granitowa', cobblestone: 'bruk', unhewn_cobblestone: 'kocie łby',
  'concrete:plates': 'płyty betonowe', gravel: 'żwir', fine_gravel: 'szuter',
  compacted: 'utwardzona', ground: 'ziemia', grass: 'trawa', sand: 'piasek',
  pebblestone: 'otoczaki', wood: 'drewno', metal: 'metal',
};
export const ROUGH_SURFACES = ['sett', 'cobblestone', 'unhewn_cobblestone', 'gravel', 'pebblestone', 'ground', 'grass', 'sand'];
const SMOOTHNESS: Record<string, string> = {
  excellent: 'doskonała', good: 'dobra', intermediate: 'średnia',
  bad: 'zła', very_bad: 'bardzo zła', horrible: 'fatalna',
};
const yes = (v: AttrValue) => v === true;
const no = (v: AttrValue) => v === false;

export const ATTRS: Record<string, AttrDef> = {
  surface: { label: 'Nawierzchnia', type: 'enum', options: SURFACES, appliesTo: ['segment'], barrier: (v) => ROUGH_SURFACES.includes(String(v)), reportable: true },
  smoothness: { label: 'Gładkość', type: 'enum', options: SMOOTHNESS, appliesTo: ['segment'], barrier: (v) => ['bad', 'very_bad', 'horrible'].includes(String(v)), reportable: true },
  width_cm: { label: 'Szerokość', type: 'number', unit: 'cm', appliesTo: ['segment'], barrier: (v) => Number(v) < 90, reportable: true },
  incline_pct: { label: 'Nachylenie', type: 'number', unit: '%', appliesTo: ['segment'], barrier: (v) => Number(v) > 6, reportable: true },
  kerb_height_cm: { label: 'Wysokość krawężnika', type: 'number', unit: 'cm', appliesTo: ['node'], barrier: (v) => Number(v) > 3, reportable: true },
  steps: { label: 'Schody', type: 'bool', appliesTo: ['segment'], barrier: yes, reportable: true },
  ramp: { label: 'Podjazd', type: 'bool', appliesTo: ['segment'], barrier: no, reportable: true },
  handrail: { label: 'Poręcz', type: 'bool', appliesTo: ['segment'], barrier: no, reportable: true },
  tactile_paving: { label: 'Pola uwagi', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  guidance_line: { label: 'Linia prowadząca', type: 'bool', appliesTo: ['segment'], barrier: no, unknownIsNeutral: true, reportable: true },
  signal_sound: { label: 'Sygnał dźwiękowy', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  signal_vibration: { label: 'Sygnał wibracyjny', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  lit: { label: 'Oświetlenie', type: 'bool', appliesTo: ['segment', 'node'], barrier: no, reportable: true },
  bench: { label: 'Ławka', type: 'bool', appliesTo: ['segment'], barrier: no, unknownIsNeutral: true, reportable: true },
  cycleway: { label: 'Droga rowerowa', type: 'bool', appliesTo: ['segment'], barrier: () => false },
  open_area: { label: 'Otwarty plac', type: 'bool', appliesTo: ['segment'], barrier: yes },
  temporary_obstacle: { label: 'Przeszkoda tymczasowa', type: 'bool', appliesTo: ['segment', 'node'], barrier: yes, unknownIsNeutral: true, reportable: true },
};

export function isBarrier(attr: string, value: AttrValue): boolean {
  return ATTRS[attr]?.barrier(value) ?? false;
}

export function formatValue(attr: string, value: AttrValue): string {
  const def = ATTRS[attr];
  if (!def) return String(value);
  if (def.type === 'bool') return value ? 'jest' : 'nie ma';
  if (def.type === 'number') return `${value} ${def.unit ?? ''}`.trim();
  return def.options?.[String(value)] ?? String(value);
}

export function isValidValue(attr: string, value: unknown): value is AttrValue {
  const def = ATTRS[attr];
  if (!def) return false;
  if (def.type === 'bool') return typeof value === 'boolean';
  if (def.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10000;
  return typeof value === 'string' && value in (def.options ?? {});
}
```

- [ ] **Step 4: `packages/domain/src/geo.ts`**

```ts
import type { Feature, LonLat } from './types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function polylineLength(coords: LonLat[]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += haversine(coords[i - 1], coords[i]);
  return m;
}

/** Odległość punktu od odcinka w metrach (rzut lokalny, wystarczający w skali miasta). */
export function pointToSegmentM(p: LonLat, a: LonLat, b: LonLat): number {
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToFeatureM(f: Feature, p: LonLat): number {
  if (f.coords.length === 1) return haversine(f.coords[0], p);
  let best = Infinity;
  for (let i = 1; i < f.coords.length; i++) best = Math.min(best, pointToSegmentM(p, f.coords[i - 1], f.coords[i]));
  return best;
}

export function nearestFeature(features: Iterable<Feature>, p: LonLat, maxM: number, kind?: Feature['kind']): Feature | null {
  let best: Feature | null = null;
  let bestD = maxM;
  for (const f of features) {
    if (kind && f.kind !== kind) continue;
    const d = distanceToFeatureM(f, p);
    if (d <= bestD) { bestD = d; best = f; }
  }
  return best;
}
```

- [ ] **Step 5: `packages/domain/src/index.ts`**

```ts
export * from './types';
export * from './attributes';
export * from './geo';
```
(Kolejne zadania dopisują tu `rules`, `profiles`, `confidence`, `reputation`, `graph`, `route`.)

- [ ] **Step 6: Instalacja i weryfikacja**

Run: `pnpm install && pnpm tsx -e "import {ATTRS,formatValue} from './packages/domain/src/index'; console.log(Object.keys(ATTRS).length, formatValue('surface','sett'))"`
Expected: `17 kostka granitowa`

Run: `pnpm tsx -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(':memory:'); console.log(d.prepare('select 1 as x').get())"`
Expected: `{ x: 1 }` (dopuszczalne ostrzeżenie ExperimentalWarning). Jeśli import `node:sqlite` pod tsx zawiedzie, zamień w Task 6 na `better-sqlite3` i dopisz go do `onlyBuiltDependencies`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "Scaffold monorepo and domain types"`

---

### Task 2: Import OSM

**Files:**
- Create: `scripts/import-osm.ts`
- Create: `data/krakow.json` (wynik)

**Interfaces:**
- Consumes: `Feature`, `Snapshot`, `polylineLength` z `@kbg/domain`.
- Produces: `data/krakow.json` typu `Snapshot`.

- [ ] **Step 1: `scripts/import-osm.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { polylineLength } from '../packages/domain/src/index';
import type { AttrValue, Feature, LonLat, Snapshot } from '../packages/domain/src/index';

const BBOX = { south: 50.045, west: 19.925, north: 50.068, east: 19.955 };
const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const FOOT = 'footway|path|pedestrian|steps|living_street|residential|service|cycleway';
const ROADS = 'unclassified|tertiary|secondary|primary';
const QUERY = `[out:json][timeout:120];
(
  way["highway"~"^(${FOOT}|${ROADS})$"](${B});
  node["highway"="crossing"](${B});
  node["barrier"="kerb"](${B});
);
out meta geom;`;

type Tags = Record<string, string>;
interface OsmWay { type: 'way'; id: number; timestamp: string; tags?: Tags; nodes: number[]; geometry: { lat: number; lon: number }[] }
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

async function main() {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: 'data=' + encodeURIComponent(QUERY),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'krakow-bez-granic-demo' },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const { elements } = (await res.json()) as { elements: (OsmWay | OsmNode)[] };
  const ways = elements.filter((e): e is OsmWay => e.type === 'way' && usable(e.tags ?? {}));
  const nodes = elements.filter((e): e is OsmNode => e.type === 'node');

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
    withSurface: features.filter((f) => 'surface' in f.attrs).length,
  });
}
main();
```

- [ ] **Step 2: Uruchom import**

Run: `pnpm import:osm`
Expected: obiekt z liczbami, `segments` rzędu kilku–kilkunastu tysięcy, `crossings` rzędu setek. Zapisz wynik w wiadomości commita: to jest pomiar pokrycia z „Następnych kroków” briefu. Przy błędzie 429/504 z Overpass odczekaj minutę i powtórz albo zmień host na `https://overpass.kumi.systems/api/interpreter`.

- [ ] **Step 3: Sprawdź rozmiar i kształt**

Run: `ls -lh data/krakow.json && node -e "const s=require('./data/krakow.json');console.log(s.features[0], s.features.at(-1))"`
Expected: plik poniżej ok. 10 MB; pierwszy element to segment z `from`/`to`, ostatni to węzeł z `nodeId`.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Add OSM import and Kraków snapshot"` (w treści liczby z kroku 2)

---

### Task 3: Reguły i profile

**Files:**
- Create: `packages/domain/src/rules.ts`, `packages/domain/src/profiles.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `ATTRS`, `formatValue`, `AttrValue`, `FeatureKind`.
- Produces: `Rule`, `Profile`, `Reason`, `Evaluation`, `Status`, `evaluate(profile, values, kind)`, `statusOf(ev)`, `mergeOverrides(profile, overrides)`, `Overrides`, `PROFILES`, `valuesFromStates(states)`.

- [ ] **Step 1: `packages/domain/src/rules.ts`**

```ts
import { ATTRS, formatValue } from './attributes';
import type { AttrValue, FeatureKind, StatesByAttr } from './types';

export interface Rule {
  attr: string;
  eq?: AttrValue;
  gt?: number;
  lt?: number;
  in?: AttrValue[];
  unless?: string;
  cost?: number;          // tylko reguły miękkie
}
export interface Profile {
  id: string;
  label: string;
  hard: Rule[];
  soft: Rule[];
  unknown_cost: number;
}
export interface Reason {
  kind: 'hard' | 'soft' | 'unknown';
  attr: string;
  value?: AttrValue;
  text: string;
}
export interface Evaluation { blocked: boolean; costMultiplier: number; reasons: Reason[] }
export type Status = 'ok' | 'difficult' | 'blocked' | 'unknown';
export type Values = Record<string, AttrValue | undefined>;
/** Nadpisania progów: klucz `${'hard'|'soft'}:${attr}:${'gt'|'lt'}` → nowy próg. */
export type Overrides = Record<string, number>;

function matches(rule: Rule, v: AttrValue): boolean {
  if (rule.eq !== undefined) return v === rule.eq;
  if (rule.gt !== undefined) return typeof v === 'number' && v > rule.gt;
  if (rule.lt !== undefined) return typeof v === 'number' && v < rule.lt;
  if (rule.in !== undefined) return rule.in.includes(v);
  return false;
}

function explain(rule: Rule, v: AttrValue): string {
  const def = ATTRS[rule.attr];
  const unit = def.unit ? ` ${def.unit}` : '';
  if (rule.gt !== undefined) return `${def.label}: ${v}${unit}, twój limit ${rule.gt}${unit}`;
  if (rule.lt !== undefined) return `${def.label}: ${v}${unit}, twoje minimum ${rule.lt}${unit}`;
  if (def.type === 'bool') return `${def.label}: ${formatValue(rule.attr, v)}`;
  return `${def.label}: ${formatValue(rule.attr, v)}`;
}

export function evaluate(profile: Profile, values: Values, kind: FeatureKind): Evaluation {
  const applies = kind === 'segment' ? 'segment' : 'node';
  const reasons: Reason[] = [];
  const unknown = new Set<string>();
  let blocked = false;
  let costMultiplier = 1;

  const check = (rule: Rule, hard: boolean) => {
    const def = ATTRS[rule.attr];
    if (!def || !def.appliesTo.includes(applies)) return;
    const v = values[rule.attr];
    if (v === undefined) {
      if (!def.unknownIsNeutral) unknown.add(rule.attr);
      return;
    }
    if (!matches(rule, v)) return;
    if (rule.unless && values[rule.unless] === true) return;
    if (hard) blocked = true;
    else costMultiplier *= rule.cost ?? 1;
    reasons.push({ kind: hard ? 'hard' : 'soft', attr: rule.attr, value: v, text: explain(rule, v) });
  };
  for (const r of profile.hard) check(r, true);
  for (const r of profile.soft) check(r, false);
  for (const attr of unknown) {
    costMultiplier *= profile.unknown_cost;
    reasons.push({ kind: 'unknown', attr, text: `${ATTRS[attr].label}: brak danych` });
  }
  return { blocked, costMultiplier, reasons };
}

export function statusOf(ev: Evaluation): Status {
  if (ev.blocked) return 'blocked';
  if (ev.reasons.some((r) => r.kind === 'soft' && (r.cost ?? 1) > 1)) return 'difficult';
  if (ev.reasons.some((r) => r.kind === 'unknown')) return 'unknown';
  return 'ok';
}

export function valuesFromStates(states: StatesByAttr | undefined): Values {
  const out: Values = {};
  if (states) for (const [attr, s] of Object.entries(states)) out[attr] = s.value;
  return out;
}

export function overrideKey(tier: 'hard' | 'soft', rule: Rule): string | null {
  if (rule.gt !== undefined) return `${tier}:${rule.attr}:gt`;
  if (rule.lt !== undefined) return `${tier}:${rule.attr}:lt`;
  return null;
}

export function mergeOverrides(profile: Profile, overrides: Overrides): Profile {
  const apply = (tier: 'hard' | 'soft') => (rule: Rule): Rule => {
    const key = overrideKey(tier, rule);
    if (!key || overrides[key] === undefined) return rule;
    return rule.gt !== undefined ? { ...rule, gt: overrides[key] } : { ...rule, lt: overrides[key] };
  };
  return { ...profile, hard: profile.hard.map(apply('hard')), soft: profile.soft.map(apply('soft')) };
}
```

- [ ] **Step 2: `packages/domain/src/profiles.ts`**

```ts
import { ROUGH_SURFACES } from './attributes';
import type { Profile } from './rules';

const BAD_SMOOTH = ['bad', 'very_bad', 'horrible'];

export const PROFILES: Profile[] = [
  { id: 'wheelchair_manual', label: 'Wózek manualny', unknown_cost: 1.5,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 3 },
      { attr: 'width_cm', lt: 90 },
      { attr: 'temporary_obstacle', eq: true },
    ],
    soft: [
      { attr: 'incline_pct', gt: 6, cost: 5 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 4 },
      { attr: 'smoothness', in: BAD_SMOOTH, cost: 3 },
    ] },
  { id: 'wheelchair_electric', label: 'Wózek elektryczny', unknown_cost: 1.3,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 6 },
      { attr: 'width_cm', lt: 80 },
      { attr: 'temporary_obstacle', eq: true },
    ],
    soft: [
      { attr: 'incline_pct', gt: 10, cost: 3 },
      { attr: 'surface', in: ['cobblestone', 'unhewn_cobblestone', 'sand', 'grass'], cost: 2 },
    ] },
  { id: 'blind', label: 'Osoba niewidoma / słabowidząca', unknown_cost: 1.2,
    hard: [],
    soft: [
      { attr: 'tactile_paving', eq: false, cost: 2 },
      { attr: 'signal_sound', eq: false, cost: 2 },
      { attr: 'open_area', eq: true, cost: 3 },
      { attr: 'guidance_line', eq: true, cost: 0.8 },
      { attr: 'temporary_obstacle', eq: true, cost: 5 },
    ] },
  { id: 'senior', label: 'Senior / chodzik', unknown_cost: 1.2,
    hard: [],
    soft: [
      { attr: 'steps', eq: true, unless: 'handrail', cost: 4 },
      { attr: 'incline_pct', gt: 5, cost: 3 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 4 },
    ] },
  { id: 'stroller', label: 'Wózek dziecięcy', unknown_cost: 1.2,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 10 },
    ],
    soft: [
      { attr: 'kerb_height_cm', gt: 3, cost: 2 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 5 },
    ] },
  { id: 'skates', label: 'Rolki', unknown_cost: 1.5,
    hard: [{ attr: 'steps', eq: true }],
    soft: [
      { attr: 'surface', in: [...ROUGH_SURFACES, 'paving_stones'], cost: 6 },
      { attr: 'smoothness', in: ['intermediate', ...BAD_SMOOTH], cost: 3 },
      { attr: 'temporary_obstacle', eq: true, cost: 4 },
    ] },
  { id: 'bike', label: 'Rower', unknown_cost: 1.1,
    hard: [],
    soft: [
      { attr: 'steps', eq: true, cost: 10 },
      { attr: 'cycleway', eq: false, cost: 1.5 },
      { attr: 'surface', in: ['cobblestone', 'unhewn_cobblestone', 'sett', 'gravel', 'sand'], cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 3 },
    ] },
];

export const profileById = (id: string): Profile => PROFILES.find((p) => p.id === id) ?? PROFILES[0];
```

- [ ] **Step 3:** dopisz do `index.ts`: `export * from './rules'; export * from './profiles';`

- [ ] **Step 4: Weryfikacja ręczna**

Run:
```bash
pnpm tsx -e "import {evaluate,statusOf,PROFILES,mergeOverrides} from './packages/domain/src/index';
const p=PROFILES[0];
const a=evaluate(p,{steps:false,surface:'sett',width_cm:120},'segment'); console.log(statusOf(a),a.costMultiplier,a.reasons.map(r=>r.text));
const b=evaluate(p,{kerb_height_cm:5},'crossing'); console.log(statusOf(b),b.reasons[0].text);
const c=evaluate(mergeOverrides(p,{'hard:kerb_height_cm:gt':6}),{kerb_height_cm:5},'crossing'); console.log(statusOf(c));
console.log(statusOf(evaluate(p,{steps:true,ramp:true,surface:'asphalt',width_cm:150,incline_pct:2,smoothness:'good'},'segment')));"
```
Expected:
```
difficult 9 [ 'Nawierzchnia: kostka granitowa', 'Nachylenie: brak danych', 'Gładkość: brak danych' ]
blocked Wysokość krawężnika: 5 cm, twój limit 3 cm
ok
ok
```
(9 = 4 × 1,5 × 1,5.)

- [ ] **Step 5: Commit** — `git commit -am "Add rule engine and seven profiles"`

---

### Task 4: Pewność i reputacja

**Files:**
- Create: `packages/domain/src/confidence.ts`, `packages/domain/src/reputation.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `ObsForState`, `computeState(obs, now): AttributeState | null`, `SOURCE_WEIGHT`, `HALF_LIFE_DAYS`; `reputationDelta(agree, obs, now): number`, `clampReputation(r)`, `START_REPUTATION`.

- [ ] **Step 1: `packages/domain/src/confidence.ts`**

```ts
import type { AttrValue, AttributeState, Source } from './types';

export const SOURCE_WEIGHT: Record<Source, number> = { osm: 0.6, user: 0.8, ai: 0.3 };
export const HALF_LIFE_DAYS = 180;

export interface ObsForState {
  value: AttrValue;
  source: Source;
  authorReputation: number;   // 1 dla osm i ai
  observedAt: string;
  validUntil: string | null;
  agreeWeight: number;        // suma reputacji potwierdzających
  disagreeWeight: number;     // suma reputacji zaprzeczających
  agreeCount: number;
  lastAgreeAt: string | null;
}

export function obsWeight(o: ObsForState, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(o.observedAt)) / 86400000);
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return Math.max(0, SOURCE_WEIGHT[o.source] * o.authorReputation * decay + o.agreeWeight - o.disagreeWeight);
}

export function computeState(observations: ObsForState[], now: Date): AttributeState | null {
  const groups = new Map<string, { value: AttrValue; weight: number; sources: Set<Source>; agrees: number; last: string }>();
  let total = 0;
  for (const o of observations) {
    if (o.validUntil && Date.parse(o.validUntil) < now.getTime()) continue;
    const w = obsWeight(o, now);
    if (w <= 0) continue;
    total += w;
    const key = JSON.stringify(o.value);
    const g = groups.get(key) ?? { value: o.value, weight: 0, sources: new Set<Source>(), agrees: 0, last: o.observedAt };
    g.weight += w;
    g.sources.add(o.source);
    g.agrees += o.agreeCount;
    const latest = o.lastAgreeAt && o.lastAgreeAt > o.observedAt ? o.lastAgreeAt : o.observedAt;
    if (latest > g.last) g.last = latest;
    groups.set(key, g);
  }
  if (total <= 0) return null;
  const win = [...groups.values()].sort((a, b) => b.weight - a.weight)[0];
  return {
    value: win.value,
    confidence: Math.round((win.weight / total) * Math.min(1, win.weight) * 100) / 100,
    lastConfirmed: win.last,
    sources: [...win.sources],
    unconfirmed: win.sources.size === 1 && win.agrees === 0,
  };
}
```

- [ ] **Step 2: `packages/domain/src/reputation.ts`**

```ts
import { isBarrier } from './attributes';
import type { AttrValue } from './types';

export const START_REPUTATION = 0.5;
export const PENALTY_WINDOW_DAYS = 7;

export const clampReputation = (r: number) => Math.min(1, Math.max(0.1, Math.round(r * 100) / 100));

/** Zmiana reputacji autora obserwacji po cudzej weryfikacji. */
export function reputationDelta(agree: boolean, obs: { attr: string; value: AttrValue; observedAt: string }, now: Date): number {
  if (agree) return 0.05;
  const ageDays = (now.getTime() - Date.parse(obs.observedAt)) / 86400000;
  if (ageDays > PENALTY_WINDOW_DAYS) return 0;
  return isBarrier(obs.attr, obs.value) ? -0.05 : -0.15;
}
```

- [ ] **Step 3:** dopisz do `index.ts`: `export * from './confidence'; export * from './reputation';`

- [ ] **Step 4: Weryfikacja ręczna**

Run:
```bash
pnpm tsx -e "import {computeState,reputationDelta} from './packages/domain/src/index';
const now=new Date('2026-10-03T12:00:00Z'); const base={authorReputation:1,validUntil:null,agreeWeight:0,disagreeWeight:0,agreeCount:0,lastAgreeAt:null};
console.log(computeState([{...base,value:'sett',source:'osm',observedAt:'2026-10-03T12:00:00Z'}],now));
console.log(computeState([{...base,value:'sett',source:'osm',observedAt:'2026-04-06T12:00:00Z'},{...base,value:'asphalt',source:'user',authorReputation:0.5,observedAt:'2026-10-03T11:00:00Z',agreeWeight:0.5,agreeCount:1,lastAgreeAt:'2026-10-03T11:30:00Z'}],now));
console.log(computeState([{...base,value:true,source:'user',observedAt:'2026-09-01T00:00:00Z',validUntil:'2026-09-08T00:00:00Z'}],now));
console.log(reputationDelta(false,{attr:'steps',value:false,observedAt:'2026-10-02T12:00:00Z'},now), reputationDelta(false,{attr:'steps',value:true,observedAt:'2026-10-02T12:00:00Z'},now), reputationDelta(false,{attr:'steps',value:false,observedAt:'2026-09-01T12:00:00Z'},now));"
```
Expected: pierwszy stan `value: 'sett', confidence: 0.6, unconfirmed: true`; drugi `value: 'asphalt'`, `confidence` ok. 0,68, `unconfirmed: false`, `lastConfirmed: '2026-10-03T11:30:00Z'`; trzeci `null`; ostatnia linia `-0.15 -0.05 0`.

- [ ] **Step 5: Commit** — `git commit -am "Add confidence and reputation logic"`

---

### Task 5: Graf i trasa

**Files:**
- Create: `packages/domain/src/graph.ts`, `packages/domain/src/route.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Feature`, `LonLat`, `haversine`, `evaluate`, `Profile`, `Reason`, `Values`, `ATTRS`, `formatValue`.
- Produces: `Graph`, `Edge`, `buildGraph(features)`, `nearestNode(g, p, maxM)`, `shortestPath(g, from, to, edgeCost, nodeCost)`; `RouteResult`, `RouteStep`, `RouteSummary`, `planRoute(g, featuresById, valuesOf, profile, from, to)`.

- [ ] **Step 1: `packages/domain/src/graph.ts`**

```ts
import { haversine } from './geo';
import type { Feature, LonLat } from './types';

export interface Edge { from: string; to: string; featureId: string; lengthM: number; forward: boolean }
export interface Graph {
  nodes: Map<string, LonLat>;
  adj: Map<string, Edge[]>;
  nodeFeature: Map<string, string>;   // id węzła → id Feature (przejście, krawężnik)
}

export function buildGraph(features: Iterable<Feature>): Graph {
  const g: Graph = { nodes: new Map(), adj: new Map(), nodeFeature: new Map() };
  const add = (e: Edge) => { const l = g.adj.get(e.from); if (l) l.push(e); else g.adj.set(e.from, [e]); };
  for (const f of features) {
    if (f.kind === 'segment' && f.from && f.to) {
      g.nodes.set(f.from, f.coords[0]);
      g.nodes.set(f.to, f.coords[f.coords.length - 1]);
      add({ from: f.from, to: f.to, featureId: f.id, lengthM: f.lengthM, forward: true });
      add({ from: f.to, to: f.from, featureId: f.id, lengthM: f.lengthM, forward: false });
    } else if (f.nodeId) {
      g.nodeFeature.set(f.nodeId, f.id);
    }
  }
  return g;
}

export function nearestNode(g: Graph, p: LonLat, maxM: number): string | null {
  let best: string | null = null;
  let bestD = maxM;
  for (const [id, c] of g.nodes) {
    if (Math.abs(c[1] - p[1]) > 0.002 || Math.abs(c[0] - p[0]) > 0.003) continue;
    const d = haversine(c, p);
    if (d <= bestD) { bestD = d; best = id; }
  }
  return best;
}

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size() { return this.a.length; }
  push(k: number, v: T) {
    const a = this.a; a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): { k: number; v: T } {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Zwraca listę krawędzi od `from` do `to` albo null. Koszt Infinity wyklucza krawędź lub węzeł. */
export function shortestPath(g: Graph, from: string, to: string, edgeCost: (e: Edge) => number, nodeCost: (nodeId: string) => number): Edge[] | null {
  if (from === to) return [];
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, Edge>();
  const heap = new MinHeap<string>();
  heap.push(0, from);
  while (heap.size) {
    const { k: d, v: u } = heap.pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u === to) break;
    for (const e of g.adj.get(u) ?? []) {
      const c = edgeCost(e) + nodeCost(e.to);
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, e); heap.push(nd, e.to); }
    }
  }
  if (!prev.has(to)) return null;
  const path: Edge[] = [];
  for (let cur = to; cur !== from; ) { const e = prev.get(cur)!; path.unshift(e); cur = e.from; }
  return path;
}
```

- [ ] **Step 2: `packages/domain/src/route.ts`**

```ts
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
        if (nv.tactile_paving === undefined) summary.crossings.unknown++;
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
```

- [ ] **Step 3:** dopisz do `index.ts`: `export * from './graph'; export * from './route';`

- [ ] **Step 4: Weryfikacja na prawdziwym grafie (to jest spike wydajności z briefu)**

Run:
```bash
pnpm tsx -e "import {readFileSync} from 'node:fs'; import {buildGraph,planRoute,PROFILES} from './packages/domain/src/index';
const s=JSON.parse(readFileSync('data/krakow.json','utf8')); const byId=new Map(s.features.map(f=>[f.id,f])); const g=buildGraph(s.features);
console.log('nodes',g.nodes.size);
for(const p of [PROFILES[0],PROFILES[2],PROFILES[5]]){ const t=Date.now(); const r=planRoute(g,byId,id=>byId.get(id).attrs,p,[19.9373,50.0617],[19.9445,50.0516]); console.log(p.id,Date.now()-t,'ms', r.error ?? r.sentence, r.violatesHardRules); }"
```
(Rynek Główny → plac Wolnica.) Expected: trzy linie ze zdaniem podsumowującym, czas każdej poniżej 500 ms, długość 1,3–2,5 km. Jeśli wynik to `no_route` lub `out_of_area`, sprawdź spójność grafu (liczbę węzłów i czy `from`/`to` segmentów się pokrywają) przed pójściem dalej.

- [ ] **Step 5: Commit** — `git commit -am "Add pedestrian graph and profile-aware routing"`

---

### Task 6: API i SQLite

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/api/src/db.ts`, `store.ts`, `app.ts`, `server.ts`

**Interfaces:**
- Consumes: całość `@kbg/domain`.
- Produces (HTTP, wszystkie pod `/api`):
  - `GET /api/features` → `Snapshot`
  - `GET /api/states` → `StatesByFeature`
  - `GET /api/profiles` → `Profile[]`
  - `GET /api/features/:id` → `FeatureDetail` (URL-encode id)
  - `POST /api/observations` `{ featureId, attr, value, validUntil?, photoId? }` → `{ id, states: StatesByAttr }`
  - `POST /api/observations/:id/verify` `{ agree: boolean }` → `{ states: StatesByAttr }`
  - `POST /api/route` `{ from: LonLat, to: LonLat, profile: Profile }` → `RouteResult | RouteError`
  - Nagłówek `X-Author-Id` wymagany dla POST poza `/api/route`.
- Produces (TS, dla Task 10): `store.insertObservation(input)`, `store.featuresById`, `store.dataDir`, `db`.

```ts
// kształt odpowiedzi GET /api/features/:id
interface ObservationView {
  id: string; attr: string; value: AttrValue; source: Source;
  observedAt: string; validUntil: string | null; expired: boolean;
  photoId: string | null; agree: number; disagree: number;
  mine: boolean; myVote: boolean | null;
}
interface FeatureDetail { states: StatesByAttr; observations: ObservationView[] }
```

- [ ] **Step 1: Pakiet**

`apps/api/package.json`:
```json
{ "name": "@kbg/api", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "dev": "tsx watch src/server.ts", "start": "tsx src/server.ts" },
  "dependencies": { "@kbg/domain": "workspace:*", "hono": "^4.6.0", "@hono/node-server": "^1.13.0", "tsx": "^4.19.0" } }
```
`apps/api/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

- [ ] **Step 2: `apps/api/src/db.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const repoRoot = resolve(import.meta.dirname, '../../..');
export const dataDir = process.env.DATA_DIR ?? resolve(repoRoot, 'var');
mkdirSync(resolve(dataDir, 'photos'), { recursive: true });

export const db = new DatabaseSync(resolve(dataDir, 'kbg.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS authors (id TEXT PRIMARY KEY, reputation REAL NOT NULL DEFAULT 0.5);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL, feature_id TEXT, lon REAL, lat REAL,
  ai_result TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL,
  source TEXT NOT NULL, author_id TEXT, observed_at TEXT NOT NULL, valid_until TEXT, photo_id TEXT);
CREATE INDEX IF NOT EXISTS obs_feature_attr ON observations (feature_id, attr);
CREATE INDEX IF NOT EXISTS obs_valid_until ON observations (valid_until) WHERE valid_until IS NOT NULL;
CREATE TABLE IF NOT EXISTS verifications (
  observation_id TEXT NOT NULL, author_id TEXT NOT NULL, agree INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (observation_id, author_id));
CREATE TABLE IF NOT EXISTS attribute_states (
  feature_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL, confidence REAL NOT NULL,
  last_confirmed TEXT NOT NULL, sources TEXT NOT NULL, unconfirmed INTEGER NOT NULL,
  PRIMARY KEY (feature_id, attr));
`);
```

- [ ] **Step 3: `apps/api/src/store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGraph, clampReputation, computeState, reputationDelta, valuesFromStates } from '@kbg/domain';
import type { AttrValue, AttributeState, Feature, ObsForState, Snapshot, Source, StatesByAttr, StatesByFeature } from '@kbg/domain';
import { db, repoRoot } from './db';

export const snapshot: Snapshot = JSON.parse(readFileSync(resolve(repoRoot, 'data/krakow.json'), 'utf8'));
export const featuresById = new Map<string, Feature>(snapshot.features.map((f) => [f.id, f]));
export const graph = buildGraph(snapshot.features);
export const states: StatesByFeature = {};
export const valuesOf = (featureId: string) => valuesFromStates(states[featureId]);

const qObs = db.prepare(`
SELECT o.value, o.source, o.observed_at, o.valid_until, COALESCE(a.reputation, 1) AS rep,
  (SELECT COALESCE(SUM(va.reputation), 0) FROM verifications v JOIN authors va ON va.id = v.author_id WHERE v.observation_id = o.id AND v.agree = 1) AS agree_w,
  (SELECT COALESCE(SUM(va.reputation), 0) FROM verifications v JOIN authors va ON va.id = v.author_id WHERE v.observation_id = o.id AND v.agree = 0) AS disagree_w,
  (SELECT COUNT(*) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 1) AS agree_n,
  (SELECT MAX(v.created_at) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 1) AS last_agree
FROM observations o LEFT JOIN authors a ON a.id = o.author_id
WHERE o.feature_id = ? AND o.attr = ?`);
const upState = db.prepare(`INSERT OR REPLACE INTO attribute_states (feature_id, attr, value, confidence, last_confirmed, sources, unconfirmed) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const delState = db.prepare(`DELETE FROM attribute_states WHERE feature_id = ? AND attr = ?`);

export function recompute(featureId: string, attr: string, now = new Date()): void {
  const rows = qObs.all(featureId, attr) as any[];
  const obs: ObsForState[] = rows.map((r) => ({
    value: JSON.parse(r.value), source: r.source as Source,
    authorReputation: r.source === 'user' ? r.rep : 1,
    observedAt: r.observed_at, validUntil: r.valid_until,
    agreeWeight: r.agree_w, disagreeWeight: r.disagree_w, agreeCount: r.agree_n, lastAgreeAt: r.last_agree,
  }));
  const s = computeState(obs, now);
  if (!s) {
    delState.run(featureId, attr);
    if (states[featureId]) delete states[featureId][attr];
    return;
  }
  upState.run(featureId, attr, JSON.stringify(s.value), s.confidence, s.lastConfirmed, JSON.stringify(s.sources), s.unconfirmed ? 1 : 0);
  (states[featureId] ??= {})[attr] = s;
}

export function ensureAuthor(id: string): void {
  db.prepare(`INSERT OR IGNORE INTO authors (id) VALUES (?)`).run(id);
}

export interface NewObservation {
  featureId: string; attr: string; value: AttrValue; source: Source;
  authorId: string | null; validUntil?: string | null; photoId?: string | null;
}
export function insertObservation(o: NewObservation): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO observations (id, feature_id, attr, value, source, author_id, observed_at, valid_until, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, o.featureId, o.attr, JSON.stringify(o.value), o.source, o.authorId, new Date().toISOString(), o.validUntil ?? null, o.photoId ?? null);
  recompute(o.featureId, o.attr);
  return id;
}

export type VerifyResult = { ok: true; featureId: string } | { ok: false; status: 403 | 404 | 409; message: string };
export function verify(observationId: string, authorId: string, agree: boolean): VerifyResult {
  const o = db.prepare(`SELECT feature_id, attr, value, author_id, observed_at FROM observations WHERE id = ?`).get(observationId) as any;
  if (!o) return { ok: false, status: 404, message: 'Nie ma takiego zgłoszenia' };
  if (o.author_id === authorId) return { ok: false, status: 403, message: 'Nie można potwierdzać własnych zgłoszeń' };
  const exists = db.prepare(`SELECT 1 FROM verifications WHERE observation_id = ? AND author_id = ?`).get(observationId, authorId);
  if (exists) return { ok: false, status: 409, message: 'To zgłoszenie już oceniłeś' };
  const now = new Date();
  db.prepare(`INSERT INTO verifications (observation_id, author_id, agree, created_at) VALUES (?, ?, ?, ?)`).run(observationId, authorId, agree ? 1 : 0, now.toISOString());
  if (o.author_id) {
    const delta = reputationDelta(agree, { attr: o.attr, value: JSON.parse(o.value), observedAt: o.observed_at }, now);
    const cur = (db.prepare(`SELECT reputation FROM authors WHERE id = ?`).get(o.author_id) as any).reputation as number;
    db.prepare(`UPDATE authors SET reputation = ? WHERE id = ?`).run(clampReputation(cur + delta), o.author_id);
  }
  recompute(o.feature_id, o.attr, now);
  return { ok: true, featureId: o.feature_id };
}

export function featureDetail(featureId: string, authorId: string | null) {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT o.*, 
      (SELECT COUNT(*) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 1) AS agree,
      (SELECT COUNT(*) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 0) AS disagree,
      (SELECT v.agree FROM verifications v WHERE v.observation_id = o.id AND v.author_id = ?) AS my_vote
    FROM observations o WHERE o.feature_id = ? ORDER BY o.observed_at DESC`).all(authorId, featureId) as any[];
  return {
    states: (states[featureId] ?? {}) as StatesByAttr,
    observations: rows.map((r) => ({
      id: r.id, attr: r.attr, value: JSON.parse(r.value) as AttrValue, source: r.source as Source,
      observedAt: r.observed_at, validUntil: r.valid_until, expired: !!r.valid_until && r.valid_until < now,
      photoId: r.photo_id, agree: r.agree, disagree: r.disagree,
      mine: !!authorId && r.author_id === authorId, myVote: r.my_vote === null ? null : r.my_vote === 1,
    })),
  };
}

/** Start: tagi OSM → obserwacje (raz), potem stany do pamięci. */
export function init(): void {
  const have = (db.prepare(`SELECT COUNT(*) AS n FROM observations WHERE source = 'osm'`).get() as any).n as number;
  if (have === 0) {
    const ins = db.prepare(`INSERT OR IGNORE INTO observations (id, feature_id, attr, value, source, author_id, observed_at) VALUES (?, ?, ?, ?, 'osm', NULL, ?)`);
    db.exec('BEGIN');
    for (const f of snapshot.features)
      for (const [attr, value] of Object.entries(f.attrs))
        ins.run(`osm:${f.id}:${attr}`, f.id, attr, JSON.stringify(value), f.osmTimestamp);
    db.exec('COMMIT');
    db.exec('BEGIN');
    for (const f of snapshot.features) for (const attr of Object.keys(f.attrs)) recompute(f.id, attr);
    db.exec('COMMIT');
  } else {
    for (const r of db.prepare(`SELECT * FROM attribute_states`).all() as any[]) {
      const s: AttributeState = { value: JSON.parse(r.value), confidence: r.confidence, lastConfirmed: r.last_confirmed, sources: JSON.parse(r.sources), unconfirmed: !!r.unconfirmed };
      (states[r.feature_id] ??= {})[r.attr] = s;
    }
  }
  // Wygasanie zgłoszeń tymczasowych: co minutę przelicz atrybuty, których obserwacje właśnie wygasły.
  let last = new Date().toISOString();
  setInterval(() => {
    const now = new Date().toISOString();
    const rows = db.prepare(`SELECT DISTINCT feature_id, attr FROM observations WHERE valid_until > ? AND valid_until <= ?`).all(last, now) as any[];
    for (const r of rows) recompute(r.feature_id, r.attr);
    last = now;
  }, 60_000).unref();
}
```

- [ ] **Step 4: `apps/api/src/app.ts`**

```ts
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { ATTRS, PROFILES, isValidValue, planRoute } from '@kbg/domain';
import type { LonLat, Profile } from '@kbg/domain';
import * as store from './store';

export const app = new Hono();
app.use('*', compress());

const authorOf = (c: any): string | null => {
  const id = c.req.header('x-author-id');
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  store.ensureAuthor(id);
  return id;
};
const isLonLat = (v: unknown): v is LonLat => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isRule = (r: any) => r && typeof r.attr === 'string' && r.attr in ATTRS && (r.unless === undefined || r.unless in ATTRS);
const isProfile = (p: any): p is Profile =>
  p && Array.isArray(p.hard) && Array.isArray(p.soft) && p.hard.length < 50 && p.soft.length < 50 &&
  p.hard.every(isRule) && p.soft.every((r: any) => isRule(r) && typeof r.cost === 'number' && r.cost > 0 && r.cost <= 100) &&
  typeof p.unknown_cost === 'number' && p.unknown_cost >= 1 && p.unknown_cost <= 10;

app.get('/api/features', (c) => { c.header('Cache-Control', 'public, max-age=3600'); return c.json(store.snapshot); });
app.get('/api/states', (c) => c.json(store.states));
app.get('/api/profiles', (c) => c.json(PROFILES));

app.get('/api/features/:id', (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  if (!store.featuresById.has(id)) return c.json({ message: 'Nie ma takiego miejsca' }, 404);
  return c.json(store.featureDetail(id, authorOf(c)));
});

app.post('/api/observations', async (c) => {
  const author = authorOf(c);
  if (!author) return c.json({ message: 'Brak identyfikatora urządzenia' }, 401);
  const b = await c.req.json().catch(() => null);
  if (!b || !store.featuresById.has(b.featureId)) return c.json({ message: 'Nieznane miejsce' }, 400);
  if (!isValidValue(b.attr, b.value)) return c.json({ message: 'Nieprawidłowa wartość atrybutu' }, 400);
  if (b.validUntil != null && Number.isNaN(Date.parse(b.validUntil))) return c.json({ message: 'Nieprawidłowa data ważności' }, 400);
  const id = store.insertObservation({ featureId: b.featureId, attr: b.attr, value: b.value, source: 'user', authorId: author, validUntil: b.validUntil ?? null, photoId: typeof b.photoId === 'string' ? b.photoId : null });
  return c.json({ id, states: store.states[b.featureId] ?? {} });
});

app.post('/api/observations/:id/verify', async (c) => {
  const author = authorOf(c);
  if (!author) return c.json({ message: 'Brak identyfikatora urządzenia' }, 401);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.agree !== 'boolean') return c.json({ message: 'Brak pola agree' }, 400);
  const r = store.verify(c.req.param('id'), author, b.agree);
  if (!r.ok) return c.json({ message: r.message }, r.status);
  return c.json({ states: store.states[r.featureId] ?? {} });
});

// Profil przychodzi w zapytaniu i nie jest zapisywany ani logowany.
app.post('/api/route', async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || !isLonLat(b.from) || !isLonLat(b.to) || !isProfile(b.profile)) return c.json({ message: 'Nieprawidłowe zapytanie o trasę' }, 400);
  return c.json(planRoute(store.graph, store.featuresById, store.valuesOf, b.profile, b.from, b.to));
});
```

- [ ] **Step 5: `apps/api/src/server.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';
import { dataDir, repoRoot } from './db';
import { init } from './store';

init();

const webDist = resolve(repoRoot, 'apps/web/dist');
app.use('/photos/*', serveStatic({ root: dataDir }));
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }));
  const index = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(index));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => console.log(`API na http://localhost:${port}`));
```
Uwaga: `serveStatic` z `@hono/node-server` oczekuje ścieżki `root` względnej do katalogu roboczego. Jeśli ścieżka absolutna nie zadziała, użyj `relative(process.cwd(), dataDir)` i `relative(process.cwd(), webDist)` z `node:path`.

- [ ] **Step 6: Weryfikacja ręczna**

Run: `pnpm install && pnpm dev:api` (pierwszy start zasiewa obserwacje OSM, może trwać kilkanaście sekund), a w drugim terminalu:
```bash
A=11111111-1111-4111-8111-111111111111; B=22222222-2222-4222-8222-222222222222
curl -s localhost:3000/api/states | head -c 300; echo
FID=$(node -e "const s=require('./data/krakow.json');console.log(s.features.find(f=>f.kind==='crossing').id)")
curl -s -XPOST localhost:3000/api/observations -H "x-author-id: $A" -H 'content-type: application/json' -d "{\"featureId\":\"$FID\",\"attr\":\"tactile_paving\",\"value\":true}"; echo
OID=$(curl -s "localhost:3000/api/features/$(node -e "console.log(encodeURIComponent('$FID'))")" -H "x-author-id: $B" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).observations.find(o=>o.source==='user').id))")
curl -s -XPOST localhost:3000/api/observations/$OID/verify -H "x-author-id: $A" -H 'content-type: application/json' -d '{"agree":true}'; echo
curl -s -XPOST localhost:3000/api/observations/$OID/verify -H "x-author-id: $B" -H 'content-type: application/json' -d '{"agree":true}'; echo
curl -s -XPOST localhost:3000/api/route -H 'content-type: application/json' -d "{\"from\":[19.9373,50.0617],\"to\":[19.9445,50.0516],\"profile\":$(curl -s localhost:3000/api/profiles | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d)[2])))")}" | head -c 400; echo
```
Expected: stany jako JSON; zgłoszenie zwraca `states.tactile_paving` z `unconfirmed: true`; weryfikacja przez autora A zwraca 403 „Nie można potwierdzać własnych zgłoszeń”; przez B zwraca stan z wyższą `confidence` i `unconfirmed: false`; trasa zwraca `coords` i `sentence`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "Add API with SQLite store, verification and routing"`

---

### Task 7: Front — powłoka, mapa, karta odcinka

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `apps/web/src/main.tsx`, `App.tsx`, `styles.css`, `api.ts`, `state.tsx`, `profileStore.ts`
- Create: `apps/web/src/components/TabBar.tsx`, `MapView.tsx`, `FeatureSheet.tsx`, `AttrRow.tsx`

**Interfaces:**
- Consumes: endpointy z Task 6; `evaluate`, `statusOf`, `mergeOverrides`, `valuesFromStates`, `ATTRS`, `formatValue`, `PROFILES`.
- Produces:
  - `profileStore.ts`: `getAuthorId(): string`, `loadProfileChoice(): { id: string; overrides: Overrides }`, `saveProfileChoice(c)`.
  - `api.ts`: `getSnapshot()`, `getStates()`, `getDetail(id)`, `postObservation(body)`, `postVerify(id, agree)`, `postRoute(from, to, profile)`, `postPhoto(form)`; każda rzuca `Error` z polskim komunikatem z pola `message`.
  - `state.tsx`: `useApp()` zwraca `{ features, featuresById, states, setFeatureStates(id, s), profile, choice, setChoice, tab, setTab, selectedId, select(id|null), route, setRoute, statusFor(feature), evalFor(feature) }`.
  - `type Tab = 'map' | 'list' | 'route' | 'profile'`.

- [ ] **Step 1: Pakiet i Vite**

`apps/web/package.json`:
```json
{ "name": "@kbg/web", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "@kbg/domain": "workspace:*", "maplibre-gl": "^4.7.0", "react": "^18.3.0", "react-dom": "^18.3.0" },
  "devDependencies": { "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.0", "vite": "^5.4.0", "vite-plugin-pwa": "^0.20.0" } }
```
`apps/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy: { '/api': 'http://localhost:3000', '/photos': 'http://localhost:3000' } },
});
```
`apps/web/index.html`: `<html lang="pl">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<title>Kraków bez granic</title>`, `<div id="root">`, skrypt `/src/main.tsx`.

- [ ] **Step 2: `profileStore.ts` i `api.ts`**

```ts
// profileStore.ts
import type { Overrides } from '@kbg/domain';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* tryb prywatny */ } };

export function getAuthorId(): string {
  let id = get('kbg.author');
  if (!id) { id = crypto.randomUUID(); set('kbg.author', id); }
  return id;
}
export interface ProfileChoice { id: string; overrides: Overrides }
export function loadProfileChoice(): ProfileChoice {
  try { const c = JSON.parse(get('kbg.profile') ?? ''); if (c && typeof c.id === 'string') return { id: c.id, overrides: c.overrides ?? {} }; } catch { /* brak zapisu */ }
  return { id: 'wheelchair_manual', overrides: {} };
}
export const saveProfileChoice = (c: ProfileChoice) => set('kbg.profile', JSON.stringify(c));
```

```ts
// api.ts
import type { AttrValue, LonLat, Profile, RouteError, RouteResult, Snapshot, Source, StatesByAttr, StatesByFeature } from '@kbg/domain';
import { getAuthorId } from './profileStore';

export interface ObservationView { id: string; attr: string; value: AttrValue; source: Source; observedAt: string; validUntil: string | null; expired: boolean; photoId: string | null; agree: number; disagree: number; mine: boolean; myVote: boolean | null }
export interface FeatureDetail { states: StatesByAttr; observations: ObservationView[] }
export interface Suggestion { attr: string; value: AttrValue; confidence: number }
export interface PhotoResult { photoId: string; featureId: string | null; aiAvailable: boolean; suggestions: Suggestion[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { ...init, headers: { 'x-author-id': getAuthorId(), ...(init?.headers ?? {}) } }); }
  catch { throw new Error('Brak połączenia z serwerem'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Błąd serwera (${res.status})`);
  return body as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const getSnapshot = () => call<Snapshot>('/api/features');
export const getStates = () => call<StatesByFeature>('/api/states');
export const getDetail = (id: string) => call<FeatureDetail>(`/api/features/${encodeURIComponent(id)}`);
export const postObservation = (b: { featureId: string; attr: string; value: AttrValue; validUntil?: string | null; photoId?: string | null }) => call<{ id: string; states: StatesByAttr }>('/api/observations', json(b));
export const postVerify = (id: string, agree: boolean) => call<{ states: StatesByAttr }>(`/api/observations/${id}/verify`, json({ agree }));
export const postRoute = (from: LonLat, to: LonLat, profile: Profile) => call<RouteResult | RouteError>('/api/route', json({ from, to, profile }));
export const postPhoto = (form: FormData) => call<PhotoResult>('/api/photos', { method: 'POST', body: form });
```

- [ ] **Step 3: `state.tsx`**

Kontekst React z jednym providerem `AppProvider`:
- przy montowaniu `Promise.all([getSnapshot(), getStates()])`; w trakcie ładowania `<p role="status">Wczytywanie danych…</p>`, przy błędzie komunikat i przycisk „Spróbuj ponownie”;
- `featuresById` jako `useMemo(new Map)`;
- `profile = useMemo(() => mergeOverrides(profileById(choice.id), choice.overrides), [choice])`; `setChoice` zapisuje też przez `saveProfileChoice`;
- `evalFor(f) = evaluate(profile, valuesFromStates(states[f.id]), f.kind)`, `statusFor(f) = statusOf(evalFor(f))`;
- `setFeatureStates(id, s)` podmienia `states[id]` niemutująco (to wywołuje przekolorowanie mapy);
- `route: RouteResult | null`, `tab`, `selectedId`.

- [ ] **Step 4: `MapView.tsx`**

- Mapa MapLibre ze stylem `https://tiles.openfreemap.org/styles/positron`, środek `[19.940, 50.057]`, zoom 15, `maxBounds` równe bbox migawki z marginesem 0,01°.
- Atrybucja zawiera „© OpenStreetMap contributors” (OpenFreeMap dodaje ją w stylu; nie wyłączaj kontrolki atrybucji).
- Kontener mapy ma `aria-hidden="true"`; przed nim link `<a href="#main" class="skip">Pomiń mapę</a>`.
- Jedno źródło GeoJSON `features` budowane z `features` + `statusFor`; właściwości każdej cechy: `id`, `kind`, `status`. Przebuduj dane źródła (`source.setData`) w `useEffect` zależnym od `states` i `profile`.
- Cztery warstwy linii filtrowane po `status` (maplibre nie obsługuje `line-dasharray` sterowanego danymi, stąd osobne warstwy):

```ts
const LINE: Record<Status, { color: string; dash?: number[]; width: number }> = {
  ok:        { color: '#1a7f37', width: 4 },
  difficult: { color: '#b35900', width: 4, dash: [2, 1] },
  blocked:   { color: '#b3261e', width: 5, dash: [0.5, 1.2] },
  unknown:   { color: '#6b7280', width: 3, dash: [1, 2] },
};
for (const [status, s] of Object.entries(LINE)) {
  map.addLayer({
    id: `seg-${status}`, type: 'line', source: 'features',
    filter: ['all', ['==', ['get', 'kind'], 'segment'], ['==', ['get', 'status'], status]],
    layout: { 'line-cap': 'butt' },
    paint: { 'line-color': s.color, 'line-width': s.width, ...(s.dash ? { 'line-dasharray': s.dash } : {}) },
  });
}
map.addLayer({
  id: 'nodes', type: 'circle', source: 'features', minzoom: 15,
  filter: ['!=', ['get', 'kind'], 'segment'],
  paint: { 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
    'circle-color': ['match', ['get', 'status'], 'ok', '#1a7f37', 'difficult', '#b35900', 'blocked', '#b3261e', '#6b7280'] },
});
```
- Kliknięcie: `map.queryRenderedFeatures` w prostokącie ±12 px wokół punktu, warstwy `nodes` i `seg-*`; węzeł ma pierwszeństwo przed segmentem; wywołaj `select(id)`. Gdy `tab === 'route'`, kliknięcie nie wybiera cechy, tylko wywołuje `onPick(lngLat)` (prop, używane w Task 8).
- Warstwa trasy `route` (linia `#1d4ed8`, szerokość 7, pod nią biała obwódka 10) ze źródła aktualizowanego z `route.coords`; po ustawieniu trasy `map.fitBounds`.
- Legenda pod mapą jako lista HTML z czterema pozycjami: wzór linii (inline SVG) i podpis „przejezdne”, „utrudnione”, „zablokowane”, „brak danych”.
- Kontrolka `GeolocateControl` w prawym górnym rogu.

- [ ] **Step 5: `AttrRow.tsx` i `FeatureSheet.tsx`**

`FeatureSheet` to dolny panel (`<section role="dialog" aria-modal="false" aria-labelledby="sheet-title">`) widoczny, gdy `selectedId` jest ustawione; fokus trafia na nagłówek po otwarciu, przycisk „Zamknij” i klawisz Escape zamykają.

Zawartość, w tej kolejności:
1. `<h2 id="sheet-title">`: nazwa ulicy lub „Przejście dla pieszych” / „Krawężnik” / „Odcinek bez nazwy”.
2. Werdykt profilu: `<p class="verdict verdict-{status}">` z tekstem „Dla profilu {label}: przejezdne / utrudnione / zablokowane / za mało danych” i lista `<ul>` z `evalFor(f).reasons.map(r => r.text)`.
3. Lista atrybutów: dla każdego klucza z `ATTRS`, którego `appliesTo` pasuje do rodzaju cechy, jeden `<AttrRow>`.
4. Zdjęcia: miniatury `/photos/{photoId}.jpg` z obserwacji mających `photoId`, każda z podpisem „zdjęcie niezweryfikowane, {data}”.
5. Przycisk „Zgłoś zmianę” (otwiera `ReportDialog` z Task 9; w tym zadaniu przycisk może być nieaktywny).

`AttrRow` props: `{ attr: string; state?: AttributeState; observations: ObservationView[]; onVerify(obsId, agree) }`. Renderuje `<li>`:
- etykieta atrybutu;
- stan jednym z trzech tekstów i klas: `jest` (lub wartość z `formatValue`), `nie ma`, `brak danych`. „Brak danych” ma inną ikonę i styl (szary, kursywa, ikona znaku zapytania), nigdy nie wygląda jak „nie ma”;
- gdy `state` istnieje: „Źródło: OpenStreetMap / użytkownik / AI ze zdjęcia” (z `state.sources`), „Ostatnie potwierdzenie: {dd.mm.rrrr}”, pasek pewności `<meter min="0" max="1" value={confidence}>` z tekstem „pewność {n}%”;
- gdy `state.unconfirmed`: znacznik `<span class="badge">niepotwierdzone</span>` i zdanie „To nie jest zapewnienie dostępności.”;
- dla najnowszej niewygasłej obserwacji zgodnej z bieżącą wartością, jeśli `!mine && myVote === null`: przyciski „Potwierdzam” i „Nieprawda” (min. 44 px wysokości), z `aria-label` zawierającym nazwę atrybutu, np. „Potwierdzam: Nawierzchnia kostka granitowa”;
- dla obserwacji z `expired`: tekst „Zgłoszenie wygasło {data}. Czy nadal aktualne?” (przycisk ponownego zgłoszenia dochodzi w Task 9).

`FeatureSheet` pobiera `getDetail(selectedId)` przy każdej zmianie wyboru; `onVerify` woła `postVerify`, potem `setFeatureStates(id, res.states)` i ponownie `getDetail`. Błędy pokazuje w `<p role="alert">`.

- [ ] **Step 6: `App.tsx`, `TabBar.tsx`, `styles.css`**

- `App`: `<AppProvider>`; `<MapView>` zamontowana zawsze (ukrywana przez CSS `visibility: hidden` w zakładkach Lista i Profil, żeby nie tracić stanu mapy); `<main id="main" tabIndex={-1}>` z widokiem aktywnej zakładki; `<FeatureSheet>`; `<TabBar>`.
- `TabBar`: `<nav aria-label="Główna nawigacja">` z czterema `<button aria-current={tab === t ? 'page' : undefined}>`: Mapa, Lista, Trasa, Profil. Wysokość 56 px, `padding-bottom: env(safe-area-inset-bottom)`.
- `styles.css`: zmienne kolorów zgodne z kontrastem AA na białym tle (te same wartości co w `LINE`), `font-size: 16px` minimum, widoczny `:focus-visible` (obrys 3 px), klasa `.skip` widoczna tylko przy fokusie, przyciski min. 44 × 44 px, układ jednokolumnowy do 480 px.

- [ ] **Step 7: Weryfikacja ręczna**

Run: `pnpm install && pnpm dev:api` oraz `pnpm dev:web`, otwórz `http://localhost:5173` w trybie urządzenia mobilnego (390 × 844).
Sprawdź:
- mapa pokazuje segmenty w czterech stylach linii i punkty przejść po przybliżeniu;
- dotknięcie segmentu otwiera kartę z werdyktem, atrybutami w trzech stanach, źródłem, datą i pewnością;
- atrybut bez danych jest opisany „brak danych”, nie „nie ma”;
- „Potwierdzam” na atrybucie z OSM podnosi pewność i usuwa znacznik „niepotwierdzone”;
- nawigacja klawiszem Tab przechodzi: „Pomiń mapę” → treść → pasek zakładek, fokus jest widoczny.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "Add web shell, map and feature sheet"`

---

### Task 8: Front — lista, profil, trasa

**Files:**
- Create: `apps/web/src/components/ListView.tsx`, `ProfileView.tsx`, `RouteView.tsx`
- Modify: `apps/web/src/App.tsx`, `MapView.tsx` (prop `onPick`, znaczniki startu i celu)

**Interfaces:**
- Consumes: `useApp()`, `postRoute`, `distanceToFeatureM`, `overrideKey`, `PROFILES`.
- Produces: w `state.tsx` dodatkowe pola `routeFrom: LonLat | null`, `routeTo: LonLat | null`, `setRouteFrom`, `setRouteTo`, `mapCenter: LonLat` (aktualizowane z `map.on('moveend')`), `userPos: LonLat | null`.

- [ ] **Step 1: `ListView.tsx`**

- `<h1>Miejsca w pobliżu</h1>`, pod nim zdanie o punkcie odniesienia: „Sortowanie według odległości od Twojej pozycji” albo „…od środka mapy”, gdy nie ma zgody na lokalizację.
- Pole wyboru `<label><input type="checkbox"> Tylko problemy dla mojego profilu</label>` (filtr: status `blocked` lub `difficult`).
- Przełącznik rodzaju: Wszystkie / Przejścia / Odcinki (`<fieldset>` z radio).
- Lista: 60 najbliższych cech według `distanceToFeatureM(f, ref)`; segmenty tej samej drogi OSM o tej samej nazwie i statusie scalone w jedną pozycję (klucz `osmId + status`), z najmniejszą odległością.
- Każda pozycja to `<li><button>` z tekstem w pełni czytelnym bez mapy, np.: „Przejście dla pieszych, 40 m. Zablokowane dla Twojego profilu: Wysokość krawężnika: 12 cm, twój limit 3 cm. Pola uwagi: brak danych.” Status jest też słowem, nie tylko kolorem. Kliknięcie: `select(id)`.

- [ ] **Step 2: `ProfileView.tsx`**

- `<h1>Twój profil</h1>`, `<fieldset><legend>Jak się poruszasz?</legend>` z siedmioma radio z `PROFILES` (etykiety `label`).
- Sekcja „Twoje progi”: dla każdej reguły profilu z `gt` lub `lt` jeden `<label>` z `<input type="range">` i wartością liczbową obok; klucz nadpisania z `overrideKey(tier, rule)`. Zakresy: `kerb_height_cm` 0–15 krok 1, `width_cm` 60–150 krok 5, `incline_pct` 0–15 krok 1. Etykieta w pierwszej osobie, np. „Najwyższy próg, który pokonam: 4 cm”.
- Przycisk „Przywróć domyślne progi” (czyści `overrides`).
- Akapit: „Profil jest zapisany tylko na tym urządzeniu. Wysyłamy go wyłącznie przy wyznaczaniu trasy i nie zapisujemy na serwerze.”
- Zmiana profilu czyści `route`.

- [ ] **Step 3: `RouteView.tsx`**

- `<h1>Trasa</h1>` oraz stały akapit: „Aplikacja służy do planowania trasy, nie do prowadzenia. GPS w wąskich ulicach myli się o 5–15 m i nie rozróżnia stron ulicy.”
- Dwa pola „Start” i „Cel”. Każde: przycisk „Wskaż na mapie” (ustawia tryb wyboru; następne dotknięcie mapy wywołuje `onPick` i zapisuje punkt), a dla startu także „Moja pozycja” (`navigator.geolocation.getCurrentPosition`; przy odmowie komunikat „Brak zgody na lokalizację. Wskaż start na mapie.”). Wybrany punkt opisany nazwą najbliższego segmentu (`nearestFeature(features, p, 60, 'segment')?.name`) lub współrzędnymi.
- Przycisk „Wyznacz trasę” aktywny, gdy oba punkty są ustawione; woła `postRoute(from, to, profile)`.
- Wynik w `<div aria-live="polite">`:
  - `error: 'out_of_area'` → „Ten punkt jest poza obszarem dema (Stare Miasto i Kazimierz).”
  - `error: 'no_route'` → „Nie znaleziono połączenia między tymi punktami.”
  - sukces → `<p class="sentence">{sentence}</p>`; gdy `violatesHardRules`, nad nim `<p role="alert">Nie ma trasy spełniającej Twoje wymagania. Ta trasa łamie je w tych miejscach:</p>` i lista `violated.map(r => r.text)`;
  - `<h2>Nawierzchnie</h2>` i lista `surfaces` (etykieta i metry);
  - `<h2>Krok po kroku</h2>` i `<ol>` z `steps.map(s => s.text)`; każdy krok to przycisk wybierający cechę (`select(s.featureId)`).
- `MapView`: znaczniki `maplibregl.Marker` dla startu (zielony) i celu (czerwony), linia trasy z Task 7.

- [ ] **Step 4: Weryfikacja ręczna**

W przeglądarce (tryb mobilny):
- Lista działa bez mapy: da się przeczytać status i powody każdej pozycji, filtr „Tylko problemy” zawęża listę.
- Profil: zmiana z „Wózek manualny” na „Rolki” przekolorowuje mapę; przesunięcie suwaka progu krawężnika z 3 na 12 zmienia przejścia z `kerb=raised` z zablokowanych na przejezdne.
- Trasa Rynek Główny → plac Wolnica dla „Wózek manualny” i dla „Osoba niewidoma” daje różne przebiegi lub różne podsumowania; zdanie podsumowujące zawiera liczby przejść; kroki są klikalne.
- Punkt startu wskazany poza obszarem daje komunikat o zasięgu dema.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add list, profile and route views"`

---

### Task 9: Zgłoszenia ręczne i potwierdzanie

**Files:**
- Create: `apps/web/src/components/ReportDialog.tsx`
- Modify: `apps/web/src/components/FeatureSheet.tsx`, `AttrRow.tsx`, `MapView.tsx` (przycisk „Zgłoś”)

**Interfaces:**
- Consumes: `postObservation`, `ATTRS`, `isValidValue`, `nearestFeature`.
- Produces: `<ReportDialog featureId onClose onSaved(states) initialPhoto?>`; props `initialPhoto?: PhotoResult` używane w Task 10.

- [ ] **Step 1: `ReportDialog.tsx`**

- `<dialog>` otwierany `showModal()` (natywna pułapka fokusu i Escape), `<h2>Zgłoś zmianę</h2>`, podtytuł z nazwą miejsca.
- `<select>` „Co chcesz zgłosić?” z atrybutami, które mają `reportable` i pasują do rodzaju cechy.
- Pole wartości zależne od typu: `bool` → dwa radio „jest” / „nie ma”; `number` → `<input type="number" inputmode="numeric">` z jednostką; `enum` → `<select>` z `options`.
- Dla `temporary_obstacle`: pole „Ważne do” (`<input type="date">`), domyślnie dziś + 7 dni; wysyłane jako `validUntil` (koniec dnia, ISO).
- „Zapisz” woła `postObservation`, potem `onSaved(res.states)`; błąd w `<p role="alert">`.
- Po zapisie komunikat `role="status"`: „Dziękujemy. Zgłoszenie jest oznaczone jako niepotwierdzone, dopóki nie potwierdzi go inna osoba.”

- [ ] **Step 2: Podpięcia**

- `FeatureSheet`: przycisk „Zgłoś zmianę” otwiera dialog dla `selectedId`; `onSaved` woła `setFeatureStates` i odświeża `getDetail`.
- `AttrRow`: przy wygasłej obserwacji przycisk „Nadal aktualne” wysyła nową obserwację z tą samą wartością i `validUntil` za 7 dni; przycisk „Już nieaktualne” wysyła wartość przeciwną bez `validUntil`.
- `MapView`: pływający przycisk „Zgłoś” (prawy dolny róg, nad paskiem zakładek). Gdy nic nie jest wybrane: bierze `userPos` lub środek mapy, `nearestFeature(features, p, 30)`; gdy brak cechy w 30 m, komunikat „Dotknij odcinka lub przejścia na mapie, którego dotyczy zgłoszenie.”

- [ ] **Step 3: Weryfikacja ręczna (dwa „urządzenia”)**

Otwórz aplikację w zwykłym oknie i w oknie prywatnym (różne `authorId`).
- Okno A: na przejściu bez danych zgłoś „Pola uwagi: jest”. Karta pokazuje wartość ze źródłem „użytkownik” i znacznikiem „niepotwierdzone”; kolor punktu na mapie zmienia się dla profilu „Osoba niewidoma”.
- Okno A: przy własnym zgłoszeniu nie ma przycisków potwierdzania.
- Okno B (po odświeżeniu): „Potwierdzam” podnosi pewność i usuwa znacznik.
- Okno A: zgłoś „Przeszkoda tymczasowa: jest” na odcinku leżącym na wcześniej wyznaczonej trasie dla wózka manualnego; ponowne „Wyznacz trasę” omija ten odcinek.
- Okno B: „Nieprawda” na tym zgłoszeniu; `sqlite3 var/kbg.sqlite "select id, reputation from authors"` (lub ten sam SELECT przez `pnpm tsx -e` z `node:sqlite`) pokazuje reputację autora A obniżoną o 0,05.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Add manual reports and verification UI"`

---

### Task 10: Zgłoszenie ze zdjęciem i AI

**Files:**
- Create: `apps/api/src/ai.ts`
- Modify: `apps/api/src/app.ts` (trasa `POST /api/photos`), `apps/api/package.json` (`@anthropic-ai/sdk`)
- Modify: `apps/web/src/components/ReportDialog.tsx`

**Interfaces:**
- Consumes: `store.insertObservation`, `store.featuresById`, `dataDir`, `db`, `nearestFeature`, `isValidValue`.
- Produces: `classifyPhoto(jpeg: Buffer): Promise<Suggestion[] | null>` (null = AI niedostępne); `POST /api/photos` (multipart: `file`, `lon`, `lat`, opcjonalnie `featureId`) → `PhotoResult`.

Przed napisaniem `ai.ts` wczytaj skill `claude-api` i sprawdź aktualny kształt wywołania z wymuszonym narzędziem oraz identyfikator modelu.

- [ ] **Step 1: `apps/api/src/ai.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { isValidValue } from '@kbg/domain';
import type { AttrValue } from '@kbg/domain';

export interface Suggestion { attr: string; value: AttrValue; confidence: number }

const MODEL = 'claude-haiku-4-5-20251001';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const field = (type: object) => ({
  type: 'object',
  properties: { value: type, confidence: { type: 'number', description: '0..1' } },
  required: ['value', 'confidence'],
});
const TOOL = {
  name: 'report_pavement',
  description: 'Zgłoś cechy nawierzchni widoczne na zdjęciu chodnika lub przejścia. Użyj "unknown", gdy cechy nie da się ocenić.',
  input_schema: {
    type: 'object' as const,
    properties: {
      surface: field({ type: 'string', enum: ['asphalt', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'concrete:plates', 'gravel', 'ground', 'grass', 'unknown'] }),
      smoothness: field({ type: 'string', enum: ['excellent', 'good', 'intermediate', 'bad', 'very_bad', 'unknown'] }),
      tactile_paving: field({ type: 'string', enum: ['yes', 'no', 'unknown'] }),
      steps: field({ type: 'string', enum: ['yes', 'no', 'unknown'] }),
    },
    required: ['surface', 'smoothness', 'tactile_paving', 'steps'],
  },
};
const PROMPT = `Zdjęcie przedstawia fragment chodnika, przejścia dla pieszych lub drogi pieszej w Krakowie.
Oceń tylko to, co widać: rodzaj nawierzchni (sett = kostka granitowa, cobblestone = bruk, paving_stones = kostka betonowa, concrete:plates = płyty), jej gładkość, obecność pól uwagi (żółte lub ryflowane płyty z guzkami przed przejściem) i schodów.
Nie oceniaj wysokości krawężnika ani nachylenia. Przy wątpliwości wybierz "unknown".`;

export async function classifyPhoto(jpeg: Buffer): Promise<Suggestion[] | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 400, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: PROMPT },
      ] }],
    });
    const use = res.content.find((b) => b.type === 'tool_use');
    if (!use || use.type !== 'tool_use') return [];
    const out: Suggestion[] = [];
    for (const [attr, raw] of Object.entries(use.input as Record<string, { value: string; confidence: number }>)) {
      if (!raw || raw.value === 'unknown') continue;
      const value: AttrValue = raw.value === 'yes' ? true : raw.value === 'no' ? false : raw.value;
      if (!isValidValue(attr, value)) continue;
      out.push({ attr, value, confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)) });
    }
    return out;
  } catch (err) {
    console.error('AI niedostępne:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 2: Trasa `POST /api/photos` w `app.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nearestFeature } from '@kbg/domain';
import { classifyPhoto } from './ai';
import { dataDir, db } from './db';

app.post('/api/photos', async (c) => {
  const author = authorOf(c);
  if (!author) return c.json({ message: 'Brak identyfikatora urządzenia' }, 401);
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size > 3_000_000) return c.json({ message: 'Wymagane zdjęcie JPEG do 3 MB' }, 400);
  const lon = Number(form.lon), lat = Number(form.lat);
  const hasPos = Number.isFinite(lon) && Number.isFinite(lat);
  let featureId = typeof form.featureId === 'string' && store.featuresById.has(form.featureId) ? form.featureId : null;
  if (!featureId && hasPos) featureId = nearestFeature(store.featuresById.values(), [lon, lat], 30)?.id ?? null;

  const id = randomUUID();
  const jpeg = Buffer.from(await file.arrayBuffer());
  writeFileSync(resolve(dataDir, 'photos', `${id}.jpg`), jpeg);
  const ai = await classifyPhoto(jpeg);
  db.prepare(`INSERT INTO photos (id, author_id, feature_id, lon, lat, ai_result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, author, featureId, hasPos ? lon : null, hasPos ? lat : null, ai ? JSON.stringify(ai) : null, new Date().toISOString());

  const kind = featureId ? (store.featuresById.get(featureId)!.kind === 'segment' ? 'segment' : 'node') : null;
  const suggestions = (ai ?? []).filter((s) => kind && ATTRS[s.attr].appliesTo.includes(kind));
  if (featureId) for (const s of suggestions) store.insertObservation({ featureId, attr: s.attr, value: s.value, source: 'ai', authorId: null, photoId: id });
  return c.json({ photoId: id, featureId, aiAvailable: ai !== null, suggestions });
});
```
Dodaj `"@anthropic-ai/sdk": "^0.60.0"` (lub bieżącą wersję wskazaną przez skill `claude-api`) do `apps/api/package.json`.

- [ ] **Step 3: Front — zdjęcie w `ReportDialog`**

- Na górze dialogu przycisk-etykieta „Zrób zdjęcie” z `<input type="file" accept="image/*" capture="environment" hidden>`.
- W obsłudze `change` jednocześnie: `navigator.geolocation.getCurrentPosition` (timeout 5 s; przy błędzie pozycja = współrzędne środka wybranej cechy) oraz zmniejszenie zdjęcia:

```ts
async function downscale(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Nie udało się przetworzyć zdjęcia'))), 'image/jpeg', 0.8));
}
```
- `FormData`: `file` (blob z nazwą `photo.jpg`), `lon`, `lat`, `featureId`. W trakcie `<p role="status">Analizuję zdjęcie…</p>`.
- Wynik w `<div aria-live="polite">`:
  - `aiAvailable === false` → „Analiza zdjęcia jest teraz niedostępna. Zdjęcie zapisane, uzupełnij dane ręcznie.” i zwykły formularz z ustawionym `photoId`;
  - brak sugestii → „Nie udało się niczego rozpoznać na zdjęciu.” i formularz ręczny;
  - sugestie → `<h3>Sugestie AI (do potwierdzenia)</h3>` i lista; każda pozycja: „Nawierzchnia: kostka granitowa (pewność AI 82%)” z przyciskami „Potwierdzam” (wysyła `postObservation` z `photoId`) i „Popraw” (przełącza formularz ręczny na ten atrybut z `photoId`).
- Po każdym potwierdzeniu `onSaved(res.states)`.

- [ ] **Step 4: Weryfikacja ręczna**

- Bez klucza: `pnpm dev:api`, wgraj dowolne zdjęcie JPEG z dysku przez dialog. Oczekiwany komunikat o niedostępnej analizie, formularz ręczny działa, zdjęcie jest na karcie odcinka z podpisem „zdjęcie niezweryfikowane”.
- Z kluczem: `ANTHROPIC_API_KEY=… pnpm dev:api`, wgraj zdjęcie bruku lub kostki. Oczekiwane sugestie z nawierzchnią; karta odcinka po zamknięciu dialogu pokazuje wartość ze źródłem „AI ze zdjęcia” i niską pewnością; po „Potwierdzam” źródła to „AI ze zdjęcia, użytkownik”, a pewność rośnie.
- Klucz nie występuje w `apps/web`: `grep -r ANTHROPIC apps/web` nie zwraca nic.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add photo reports with AI suggestions"`

---

### Task 11: PWA, przegląd dostępności, deploy

**Files:**
- Modify: `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/public/icon-192.png`, `icon-512.png`, `Dockerfile`, `.dockerignore`

- [ ] **Step 1: PWA**

W `vite.config.ts` dodaj:
```ts
import { VitePWA } from 'vite-plugin-pwa';
// w plugins:
VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Kraków bez granic', short_name: 'Bez granic', lang: 'pl', display: 'standalone',
    start_url: '/', background_color: '#ffffff', theme_color: '#1d4ed8',
    icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
  },
  workbox: {
    navigateFallbackDenylist: [/^\/api\//, /^\/photos\//],
    runtimeCaching: [
      { urlPattern: /\/api\/(features|states|profiles)$/, handler: 'NetworkFirst', options: { cacheName: 'kbg-data', networkTimeoutSeconds: 4 } },
    ],
  },
}),
```
Ikony: proste kwadraty PNG z literami „KBG” wygenerowane skryptem (np. `canvas` w przeglądarce lub ImageMagick, jeśli jest). W `state.tsx` zapisuj znacznik czasu ostatniego udanego pobrania w `localStorage` i pokazuj baner „Dane z {data, godzina} — brak połączenia”, gdy `navigator.onLine === false`.

- [ ] **Step 2: Przegląd dostępności (ręczny)**

Przejdź cztery zakładki i dialog zgłoszenia samą klawiaturą oraz z czytnikiem ekranu (NVDA lub VoiceOver), popraw na miejscu:
- każdy przycisk ma nazwę; mapa jest pomijalna; fokus nie ginie po zamknięciu karty i dialogu;
- wynik trasy i sugestie AI są ogłaszane (`aria-live`);
- stan „brak danych” brzmi inaczej niż „nie ma”;
- kontrast tekstu co najmniej 4,5:1 (DevTools → Accessibility), cele dotykowe co najmniej 44 px;
- powiększenie tekstu do 200% nie ucina treści.

- [ ] **Step 3: `Dockerfile` i `.dockerignore`**

```dockerfile
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY data ./data
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
CMD ["pnpm", "start"]
```
`.dockerignore`: `node_modules`, `**/node_modules`, `**/dist`, `var`, `.git`.

- [ ] **Step 4: Próba produkcyjna lokalnie**

Run: `pnpm build && PORT=3000 pnpm start`, otwórz `http://localhost:3000`.
Expected: aplikacja działa z jednego portu, odświeżenie strony nie daje 404, `/api/states` odpowiada.

- [ ] **Step 5: Deploy na Railway (wymaga zgody użytkownika)**

Zapytaj użytkownika o zgodę i o klucz `ANTHROPIC_API_KEY`. Wczytaj skill `use-railway`. Następnie: nowy projekt, usługa z repo (Dockerfile), wolumen zamontowany w `/data`, zmienne `ANTHROPIC_API_KEY` i `DATA_DIR=/data`, wygenerowana domena.

- [ ] **Step 6: Scenariusz pokazu na telefonie**

Na telefonie przez publiczny URL (HTTPS):
1. Profil „Wózek manualny”, mapa pokazuje cztery stany.
2. Karta przejścia: trzy stany atrybutów, źródło, data, pewność.
3. Trasa Rynek Główny → plac Wolnica, zdanie podsumowujące i kroki.
4. Zmiana profilu na „Osoba niewidoma”: inne podsumowanie, lista używalna bez mapy.
5. „Zgłoś” → aparat → sugestie AI → „Potwierdzam” → pewność i kolor się zmieniają.
6. Zgłoszenie przeszkody tymczasowej na trasie → ponowne wyznaczenie trasy ją omija.
7. Drugi telefon lub okno prywatne potwierdza zgłoszenie → znika „niepotwierdzone”.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "Add PWA manifest, Dockerfile and deploy config"`
