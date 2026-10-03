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
