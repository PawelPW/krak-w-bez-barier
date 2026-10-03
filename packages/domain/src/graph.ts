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
