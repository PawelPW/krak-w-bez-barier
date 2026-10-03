import type { Feature, Status } from '@kbg/domain';

export const LINE: Record<Status, { color: string; dash?: number[]; width: number }> = {
  ok:        { color: '#1a7f37', width: 4 },
  difficult: { color: '#a34f00', width: 4, dash: [2, 1] },
  blocked:   { color: '#b3261e', width: 5, dash: [0.5, 1.2] },
  unknown:   { color: '#6b7280', width: 3, dash: [1, 2] },
};

/** Etykiety statusu: „ok” to nie zapewnienie, tylko brak znanych przeszkód. */
export const STATUS_LABEL: Record<Status, string> = {
  ok: 'bez znanych przeszkód',
  difficult: 'utrudnione',
  blocked: 'zablokowane',
  unknown: 'brak danych',
};
export const VERDICT_LABEL: Record<Status, string> = { ...STATUS_LABEL, unknown: 'za mało danych' };

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(d.toISOString())}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const KIND_TITLE = { crossing: 'Przejście dla pieszych', kerb: 'Krawężnik', segment: 'Odcinek bez nazwy' } as const;
export const featureTitle = (f: Feature): string => f.name ?? KIND_TITLE[f.kind];
