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
