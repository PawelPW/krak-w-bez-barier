import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGraph, clampReputation, computeState, reputationDelta, valuesFromStates } from '@kbg/domain';
import type { AttrValue, Feature, ObsForState, Snapshot, Source, StatesByAttr, StatesByFeature } from '@kbg/domain';
import { dataDir, db, repoRoot } from './db';

export { dataDir, db };
export const snapshot: Snapshot = JSON.parse(readFileSync(resolve(repoRoot, 'data/krakow.json'), 'utf8'));
export const featuresById = new Map<string, Feature>(snapshot.features.map((f) => [f.id, f]));
export const graph = buildGraph(snapshot.features);
export const states: StatesByFeature = {};
export const valuesOf = (featureId: string) => valuesFromStates(states[featureId]);

const qObs = db.prepare(`
SELECT o.id, o.author_id, o.value, o.source, o.observed_at, o.valid_until, COALESCE(a.reputation, 1) AS rep,
  (SELECT COALESCE(SUM(va.reputation), 0) FROM verifications v JOIN authors va ON va.id = v.author_id WHERE v.observation_id = o.id AND v.agree = 1) AS agree_w,
  (SELECT COALESCE(SUM(va.reputation), 0) FROM verifications v JOIN authors va ON va.id = v.author_id WHERE v.observation_id = o.id AND v.agree = 0) AS disagree_w,
  (SELECT COUNT(*) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 1) AS agree_n,
  (SELECT MAX(v.created_at) FROM verifications v WHERE v.observation_id = o.id AND v.agree = 1) AS last_agree
FROM observations o LEFT JOIN authors a ON a.id = o.author_id
WHERE o.feature_id = ? AND o.attr = ?`);
const upState = db.prepare(`INSERT OR REPLACE INTO attribute_states (feature_id, attr, value, confidence, last_confirmed, sources, unconfirmed) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const delState = db.prepare(`DELETE FROM attribute_states WHERE feature_id = ? AND attr = ?`);

export function recompute(featureId: string, attr: string, now = new Date()): void {
  const all = qObs.all(featureId, attr) as any[];
  // Liczy się tylko najnowsze zgłoszenie każdego autora oraz najnowsza obserwacja AI; starsze zostają w historii.
  const latest = new Map<string, any>();
  for (const r of all) {
    const key = r.source === 'user' ? `user:${r.author_id}` : r.source === 'ai' ? 'ai' : `osm:${r.id}`;
    const cur = latest.get(key);
    if (!cur || r.observed_at > cur.observed_at) latest.set(key, r);
  }
  const rows = [...latest.values()];
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
  const o = db.prepare(`SELECT feature_id, attr, value, author_id, source, photo_id, observed_at FROM observations WHERE id = ?`).get(observationId) as any;
  if (!o) return { ok: false, status: 404, message: 'Nie ma takiego zgłoszenia' };
  if (o.author_id === authorId) return { ok: false, status: 403, message: 'Nie można potwierdzać własnych zgłoszeń' };
  if (o.source === 'ai' && o.photo_id) {
    const ph = db.prepare(`SELECT author_id FROM photos WHERE id = ?`).get(o.photo_id) as any;
    if (ph && ph.author_id === authorId) return { ok: false, status: 403, message: 'Nie można potwierdzać sugestii z własnego zdjęcia' };
  }
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
      (SELECT v.agree FROM verifications v WHERE v.observation_id = o.id AND v.author_id = ?) AS my_vote,
      (SELECT p.author_id FROM photos p WHERE p.id = o.photo_id) AS photo_author
    FROM observations o WHERE o.feature_id = ? ORDER BY o.observed_at DESC`).all(authorId, featureId) as any[];
  return {
    states: (states[featureId] ?? {}) as StatesByAttr,
    observations: rows.map((r) => ({
      id: r.id, attr: r.attr, value: JSON.parse(r.value) as AttrValue, source: r.source as Source,
      observedAt: r.observed_at, validUntil: r.valid_until, expired: !!r.valid_until && r.valid_until < now,
      photoId: r.photo_id, agree: r.agree, disagree: r.disagree,
      mine: !!authorId && (r.author_id === authorId || (r.source === 'ai' && r.photo_author === authorId)), myVote: r.my_vote === null ? null : r.my_vote === 1,
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
  }
  // Stany zawsze przeliczamy od zera: wygasłe zgłoszenia i przerwane zasiewy nie zostawiają śladu.
  const pairs = db.prepare(`SELECT DISTINCT feature_id, attr FROM observations`).all() as any[];
  db.exec('BEGIN');
  db.exec('DELETE FROM attribute_states');
  for (const k of Object.keys(states)) delete states[k];
  for (const r of pairs) recompute(r.feature_id, r.attr);
  db.exec('COMMIT');
  // Wygasanie zgłoszeń tymczasowych: co minutę przelicz atrybuty, których obserwacje właśnie wygasły.
  let last = new Date().toISOString();
  setInterval(() => {
    const now = new Date().toISOString();
    const rows = db.prepare(`SELECT DISTINCT feature_id, attr FROM observations WHERE valid_until > ? AND valid_until <= ?`).all(last, now) as any[];
    for (const r of rows) recompute(r.feature_id, r.attr);
    last = now;
  }, 60_000).unref();
}
