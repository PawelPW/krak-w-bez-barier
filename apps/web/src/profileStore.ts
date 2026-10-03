import type { Overrides } from '@kbg/domain';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* tryb prywatny */ } };

/** crypto.randomUUID istnieje tylko w bezpiecznym kontekście (HTTPS/localhost); w HTTP przez LAN trzeba go zastąpić. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // wersja 4
  b[8] = (b[8] & 0x3f) | 0x80; // wariant RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getAuthorId(): string {
  let id = get('kbg.author');
  if (!id) { id = newId(); set('kbg.author', id); }
  return id;
}
export interface ProfileChoice { id: string; overrides: Overrides }
export function loadProfileChoice(): ProfileChoice {
  try { const c = JSON.parse(get('kbg.profile') ?? ''); if (c && typeof c.id === 'string') return { id: c.id, overrides: c.overrides ?? {} }; } catch { /* brak zapisu */ }
  return { id: 'wheelchair_manual', overrides: {} };
}
export const saveProfileChoice = (c: ProfileChoice) => set('kbg.profile', JSON.stringify(c));
