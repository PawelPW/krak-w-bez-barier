import type { Status } from '@kbg/domain';

export const LINE: Record<Status, { color: string; dash?: number[]; width: number }> = {
  ok:        { color: '#1a7f37', width: 4 },
  difficult: { color: '#b35900', width: 4, dash: [2, 1] },
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
