import type { AttrValue, AttributeState, Source } from './types';

export const SOURCE_WEIGHT: Record<Source, number> = { osm: 0.6, user: 0.8, ai: 0.3 };
// Obiekty OSM w obszarze dema mają medianę wieku 548 dni; przy 180 dniach mediana pewności samego OSM wynosiła 7%.
export const HALF_LIFE_DAYS: Record<Source, number> = { osm: 730, user: 180, ai: 180 };

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
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS[o.source]);
  return Math.max(0, SOURCE_WEIGHT[o.source] * o.authorReputation * decay + o.agreeWeight - o.disagreeWeight);
}

export function computeState(observations: ObsForState[], now: Date): AttributeState | null {
  const groups = new Map<string, { value: AttrValue; weight: number; sources: Set<Source>; agrees: number; last: string }>();
  let total = 0;
  const live = (o: ObsForState) => !(o.validUntil && Date.parse(o.validUntil) < now.getTime());
  // AI nie nadpisuje danych ludzi ani OSM: niepotwierdzone obserwacje AI są pomijane, gdy istnieje jakakolwiek inna.
  const hasNonAi = observations.some((o) => o.source !== 'ai' && live(o) && obsWeight(o, now) > 0);
  for (const o of observations) {
    if (!live(o)) continue;
    if (hasNonAi && o.source === 'ai' && o.agreeCount === 0) continue;
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
