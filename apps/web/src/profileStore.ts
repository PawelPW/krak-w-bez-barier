import type { Overrides } from '@kbg/domain';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* tryb prywatny */ } };

export function getAuthorId(): string {
  let id = get('kbg.author');
  if (!id) { id = crypto.randomUUID(); set('kbg.author', id); }
  return id;
}
export interface ProfileChoice { id: string; overrides: Overrides }
export function loadProfileChoice(): ProfileChoice {
  try { const c = JSON.parse(get('kbg.profile') ?? ''); if (c && typeof c.id === 'string') return { id: c.id, overrides: c.overrides ?? {} }; } catch { /* brak zapisu */ }
  return { id: 'wheelchair_manual', overrides: {} };
}
export const saveProfileChoice = (c: ProfileChoice) => set('kbg.profile', JSON.stringify(c));
