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
