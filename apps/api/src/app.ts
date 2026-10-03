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
