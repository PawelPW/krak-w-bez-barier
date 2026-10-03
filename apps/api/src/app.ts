import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { ATTRS, PROFILES, isValidValue, nearestFeature, planRoute } from '@kbg/domain';
import type { LonLat, Profile } from '@kbg/domain';
import { classifyPhoto } from './ai';
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
const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const isRule = (r: any) => r && typeof r.attr === 'string' && Object.hasOwn(ATTRS, r.attr) &&
  (r.unless === undefined || (typeof r.unless === 'string' && Object.hasOwn(ATTRS, r.unless))) &&
  (r.gt === undefined || (typeof r.gt === 'number' && Number.isFinite(r.gt))) &&
  (r.lt === undefined || (typeof r.lt === 'number' && Number.isFinite(r.lt))) &&
  (r.eq === undefined || isScalar(r.eq)) &&
  (r.in === undefined || (Array.isArray(r.in) && r.in.length <= 50 && r.in.every(isScalar)));
const isProfile = (p: any): p is Profile =>
  p && Array.isArray(p.hard) && Array.isArray(p.soft) && p.hard.length < 50 && p.soft.length < 50 &&
  p.hard.every(isRule) && p.soft.every((r: any) => isRule(r) && typeof r.cost === 'number' && r.cost > 0 && r.cost <= 100) &&
  typeof p.unknown_cost === 'number' && p.unknown_cost >= 1 && p.unknown_cost <= 10;

const snapshotJson = JSON.stringify(store.snapshot);
app.get('/api/features', (c) => c.body(snapshotJson, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }));
app.get('/api/states', (c) => c.json(store.states));
app.get('/api/profiles', (c) => c.json(PROFILES));

app.get('/api/features/:id', (c) => {
  const id = c.req.param('id');
  if (!store.featuresById.has(id)) return c.json({ message: 'Nie ma takiego miejsca' }, 404);
  return c.json(store.featureDetail(id, authorOf(c)));
});

app.post('/api/observations', async (c) => {
  const author = authorOf(c);
  if (!author) return c.json({ message: 'Brak identyfikatora urządzenia' }, 401);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object') return c.json({ message: 'Nieprawidłowe zapytanie' }, 400);
  if (!store.featuresById.has(b.featureId)) return c.json({ message: 'Nieznane miejsce' }, 400);
  if (!isValidValue(b.attr, b.value)) return c.json({ message: 'Nieprawidłowa wartość atrybutu' }, 400);
  if (b.validUntil != null && (typeof b.validUntil !== 'string' || Number.isNaN(Date.parse(b.validUntil)))) return c.json({ message: 'Nieprawidłowa data ważności' }, 400);
  const validUntil = b.validUntil != null ? new Date(b.validUntil).toISOString() : null;
  const id = store.insertObservation({ featureId: b.featureId, attr: b.attr, value: b.value, source: 'user', authorId: author, validUntil, photoId: typeof b.photoId === 'string' ? b.photoId : null });
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
  try {
    return c.json(planRoute(store.graph, store.featuresById, store.valuesOf, b.profile, b.from, b.to));
  } catch (err) {
    console.error('route error:', (err as Error).message);
    return c.json({ message: 'Nie udało się wyznaczyć trasy' }, 500);
  }
});

const MAX_PHOTO_BYTES = 3_000_000;
const PHOTOS_PER_HOUR = 20;
const coord = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// Zdjęcie nie jest rozmywane (znane ograniczenie dema). AI tylko sugeruje; decyzję podejmuje człowiek.
app.post('/api/photos', async (c) => {
  const author = authorOf(c);
  if (!author) return c.json({ message: 'Brak identyfikatora urządzenia' }, 401);
  const form = await c.req.parseBody().catch(() => null);
  if (!form) return c.json({ message: 'Nieprawidłowe zapytanie' }, 400);
  const file = form.file;
  if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size > MAX_PHOTO_BYTES) return c.json({ message: 'Wymagane zdjęcie JPEG do 3 MB' }, 400);
  const jpeg = Buffer.from(await file.arrayBuffer());
  if (jpeg.length > MAX_PHOTO_BYTES || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return c.json({ message: 'Wymagane zdjęcie JPEG do 3 MB' }, 400);

  const rawLon = form.lon, rawLat = form.lat;
  const lon = coord(rawLon, -180, 180), lat = coord(rawLat, -90, 90);
  if ((rawLon !== undefined || rawLat !== undefined) && (lon === null || lat === null)) return c.json({ message: 'Nieprawidłowa pozycja' }, 400);
  const hasPos = lon !== null && lat !== null;
  let featureId: string | null = null;
  if (form.featureId !== undefined && form.featureId !== '') {
    if (typeof form.featureId !== 'string' || !store.featuresById.has(form.featureId)) return c.json({ message: 'Nieznane miejsce' }, 400);
    featureId = form.featureId;
  } else if (hasPos) {
    featureId = nearestFeature(store.featuresById.values(), [lon, lat], 30)?.id ?? null;
  }

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const recent = (store.db.prepare(`SELECT COUNT(*) AS n FROM photos WHERE author_id = ? AND created_at > ?`).get(author, since) as { n: number }).n;
  if (recent >= PHOTOS_PER_HOUR) return c.json({ message: 'Limit zdjęć na godzinę został wyczerpany. Spróbuj później.' }, 429);

  const id = randomUUID();
  writeFileSync(resolve(store.dataDir, 'photos', `${id}.jpg`), jpeg);
  // Wiersz zapisujemy przed wywołaniem AI, żeby równoległe wysyłki liczyły się do limitu.
  store.db.prepare(`INSERT INTO photos (id, author_id, feature_id, lon, lat, ai_result, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
    .run(id, author, featureId, hasPos ? lon : null, hasPos ? lat : null, new Date().toISOString());
  const ai = await classifyPhoto(jpeg);
  if (ai) store.db.prepare(`UPDATE photos SET ai_result = ? WHERE id = ?`).run(JSON.stringify(ai), id);

  const feature = featureId ? store.featuresById.get(featureId)! : null;
  const kind = feature ? (feature.kind === 'segment' ? 'segment' : 'node') : null;
  const suggestions = (ai ?? []).filter((s) => kind && ATTRS[s.attr].appliesTo.includes(kind));
  if (featureId) for (const s of suggestions) store.insertObservation({ featureId, attr: s.attr, value: s.value, source: 'ai', authorId: null, photoId: id });
  return c.json({ photoId: id, featureId, aiAvailable: ai !== null, suggestions });
});
