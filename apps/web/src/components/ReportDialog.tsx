import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { ATTRS, formatValue, isValidValue } from '@kbg/domain';
import type { AttrValue, StatesByAttr } from '@kbg/domain';
import { getDetail, postObservation, postPhoto } from '../api';
import type { PhotoResult, Suggestion } from '../api';
import { useApp } from '../state';
import { featureTitle } from '../status';

interface Props {
  featureId: string;
  onClose(): void;
  onSaved(states: StatesByAttr): void;
}

export function ReportDialog({ featureId, onClose, onSaved }: Props) {
  const { featuresById } = useApp();
  const feature = featuresById.get(featureId);
  const ref = useRef<HTMLDialogElement | null>(null);
  // Opener zapamiętany przy pierwszym renderze (przed showModal); fokus wraca do niego po zamknięciu.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const dialogRef = (node: HTMLDialogElement | null) => {
    ref.current = node;
    if (node && !node.open) node.showModal();
  };

  if (!feature) return null;
  return (
    <dialog ref={dialogRef} className="report" aria-labelledby="report-title"
      onClose={() => { opener?.focus(); onClose(); }}>
      <div className="report-body">
        <h2 id="report-title">Zgłoś zmianę</h2>
        <p className="report-sub">{featureTitle(feature)}</p>
        <PhotoSection featureId={featureId} kind={feature.kind} onSaved={onSaved} />
        <button type="button" className="btn btn-block" onClick={() => ref.current?.close()}>Gotowe</button>
      </div>
    </dialog>
  );
}

const PHOTO_MAX_PX = 1280;
const GEO_TIMEOUT_MS = 5000;
const GEO_WAIT_AFTER_PHOTO_MS = 1500;
const MSG_PROCESS = 'Nie udało się przetworzyć zdjęcia. Spróbuj zrobić je ponownie.';

async function downscale(file: File, max = PHOTO_MAX_PX): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(MSG_PROCESS))), 'image/jpeg', 0.8));
}

/** Pozycja urządzenia albo null (brak zgody, błąd, 5 s). Uruchamiana przy wyborze pliku; wysyłka czeka na nią najwyżej GEO_WAIT_AFTER_PHOTO_MS. */
function currentPosition(): Promise<{ lon: number; lat: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = window.setTimeout(() => resolve(null), GEO_TIMEOUT_MS);
    const done = (v: { lon: number; lat: number } | null) => { window.clearTimeout(timer); resolve(v); };
    navigator.geolocation.getCurrentPosition(
      (p) => done({ lon: p.coords.longitude, lat: p.coords.latitude }),
      () => done(null),
      { timeout: GEO_TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}

type Position = { lon: number; lat: number } | null;
function raceTimeout(p: Promise<Position>, ms: number): Promise<Position> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(null), ms);
    p.then((v) => { window.clearTimeout(t); resolve(v); });
  });
}

interface SectionProps {
  featureId: string;
  kind: 'segment' | 'crossing' | 'kerb';
  onSaved(states: StatesByAttr): void;
}

const known = (s: Suggestion) => Object.hasOwn(ATTRS, s.attr);
const suggestionName = (s: Suggestion) => `${ATTRS[s.attr].label} ${formatValue(s.attr, s.value)}`;

function PhotoSection({ featureId, kind, onSaved }: SectionProps) {
  const { setFeatureStates } = useApp();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [itemError, setItemError] = useState<string | null>(null);
  // Poprawka podpowiedzi: formularz ręczny ustawiony na atrybut, z numerem do remontowania (key).
  const [fix, setFix] = useState<{ attr: string; n: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [corrected, setCorrected] = useState<ReadonlySet<string>>(new Set());
  // Dokąd przenieść fokus po następnym renderze (cel istnieje dopiero po zmianie stanu).
  const [focusTo, setFocusTo] = useState<{ where: 'suggest' | 'form' | 'pick'; n: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const suggestHeading = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const previewRef = useRef<string | null>(null);
  const items = useRef<Map<string, HTMLLIElement>>(new Map());
  const [focusAttr, setFocusAttr] = useState<string | null>(null);

  useEffect(() => () => { seq.current++; if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  useEffect(() => {
    if (focusAttr) { items.current.get(focusAttr)?.focus(); setFocusAttr(null); }
  }, [focusAttr]);
  useEffect(() => {
    if (!focusTo) return;
    if (focusTo.where === 'suggest') suggestHeading.current?.focus();
    else if (focusTo.where === 'form') sectionRef.current?.querySelector<HTMLElement>('.report-form select, .report-form input')?.focus();
    else document.getElementById('photo-input')?.focus();
  }, [focusTo]);
  const moveFocus = (where: 'suggest' | 'form' | 'pick') => setFocusTo((f) => ({ where, n: (f?.n ?? 0) + 1 }));

  const setPreviewUrl = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // to samo zdjęcie można wybrać ponownie
    if (!file) return;
    if (busyRef.current) return; // pole nie jest wyłączane (fokus), więc ponowny wybór blokujemy tutaj
    busyRef.current = true;
    const mine = ++seq.current;
    // Nowe zdjęcie kasuje powiązanie ze starym: sugestie, poprawki i photoId.
    setResult(null); setFix(null); setConfirmed(new Set()); setCorrected(new Set()); setItemError(null); setError(null);
    setBusy(true); setStatus('Analizuję zdjęcie…');
    try {
      const posPromise = currentPosition(); // pozycja szuka się równolegle z przetwarzaniem zdjęcia
      const blob = await downscale(file).catch(() => { throw new Error(MSG_PROCESS); });
      const pos = await raceTimeout(posPromise, GEO_WAIT_AFTER_PHOTO_MS);
      if (seq.current !== mine) return;
      setPreviewUrl(URL.createObjectURL(blob));
      const form = new FormData();
      form.append('file', blob, 'photo.jpg');
      form.append('featureId', featureId);
      if (pos) { form.append('lon', String(pos.lon)); form.append('lat', String(pos.lat)); }
      const res = await postPhoto(form);
      if (seq.current !== mine) return;
      const sugg = res.suggestions.filter(known);
      setResult({ ...res, suggestions: sugg });
      if (!res.aiAvailable) setStatus('Analiza zdjęcia jest teraz niedostępna. Zdjęcie zapisane, uzupełnij dane ręcznie.');
      else if (sugg.length === 0) setStatus('Nie udało się niczego rozpoznać na zdjęciu. Uzupełnij dane ręcznie.');
      else setStatus(`Analiza zakończona. Liczba sugestii AI do potwierdzenia: ${sugg.length}.`);
      moveFocus(res.aiAvailable && sugg.length > 0 ? 'suggest' : 'form');
      if (res.suggestions.length > 0) {
        // Serwer zapisał już obserwacje ze źródłem „ai”: odśwież stany cechy.
        getDetail(featureId).then((d) => setFeatureStates(featureId, d.states), () => { /* odświeży się przy następnej akcji */ });
      }
    } catch (err) {
      if (seq.current !== mine) return;
      setStatus('');
      setError((err as Error).message || MSG_PROCESS);
      moveFocus('pick');
    } finally {
      if (seq.current === mine) { busyRef.current = false; setBusy(false); }
    }
  };

  const confirm = async (s: Suggestion) => {
    if (!result) return;
    setPending(s.attr); setItemError(null);
    try {
      const res = await postObservation({ featureId, attr: s.attr, value: s.value, photoId: result.photoId });
      onSaved(res.states);
      setConfirmed((prev) => new Set(prev).add(s.attr));
      setFocusAttr(s.attr);
    } catch (err) { setItemError((err as Error).message); }
    finally { setPending(null); }
  };

  const hasSuggestions = !!result && result.aiAvailable && result.suggestions.length > 0;
  // photoId trafia do formularza tylko wtedy, gdy dotyczy zdjęcia: po nieudanej analizie albo przy poprawce podpowiedzi.
  const formPhotoId = result ? (hasSuggestions ? (fix ? result.photoId : null) : result.photoId) : null;

  return (
    <section className="photo" aria-labelledby="photo-title" ref={sectionRef}>
      <h3 id="photo-title" className="sr-only">Zdjęcie miejsca</h3>
      <div className="photo-pick-row">
        <input id="photo-input" className="photo-input" type="file" accept="image/*" capture="environment" onChange={onFile} />
        <label htmlFor="photo-input" className="btn photo-pick" aria-disabled={busy}>{preview || result ? 'Zrób inne zdjęcie' : 'Zrób zdjęcie'}</label>
        {preview && <img className="photo-thumb" src={preview} alt="Twoje zdjęcie miejsca" />}
      </div>
      <p role="status" aria-live="polite" className="photo-status">{status}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {hasSuggestions && result && (
        <div className="suggest">
          <h3 tabIndex={-1} ref={suggestHeading}>Sugestie AI (do potwierdzenia)</h3>
          <p className="suggest-note">To propozycje modelu, zapisane jako niepotwierdzone sugestie AI. Jako Twoje zgłoszenie liczy się tylko to, co potwierdzisz lub poprawisz.</p>
          <ul className="suggest-list">
            {result.suggestions.map((s) => {
              const text = `${ATTRS[s.attr].label}: ${formatValue(s.attr, s.value)} (pewność AI ${Math.round(s.confidence * 100)}%)`;
              const done = confirmed.has(s.attr);
              const fixed = corrected.has(s.attr);
              return (
                <li key={s.attr} className="suggest-item" tabIndex={-1} ref={(n) => { if (n) items.current.set(s.attr, n); else items.current.delete(s.attr); }}>
                  <span>{text}</span>
                  {done ? <span className="suggest-done">Potwierdzone</span> : fixed ? <span className="suggest-done">Poprawione</span> : (
                    <span className="attr-actions">
                      <button type="button" className="btn" disabled={pending !== null} aria-label={`Potwierdzam: ${suggestionName(s)}`} onClick={() => confirm(s)}>Potwierdzam</button>
                      <button type="button" className="btn" aria-label={`Popraw: ${suggestionName(s)}`} onClick={() => { setFix((f) => ({ attr: s.attr, n: (f?.n ?? 0) + 1 })); moveFocus('form'); }}>Popraw</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {itemError && <p role="alert" className="error">{itemError}</p>}
        </div>
      )}
      {hasSuggestions && <h3>{fix ? `Popraw: ${ATTRS[fix.attr].label}` : 'Zgłoś ręcznie'}</h3>}
      <ManualForm key={fix?.n ?? 0} featureId={featureId} kind={kind} presetAttr={fix?.attr} photoId={formPhotoId}
        photoOnlyFor={fix?.attr} onSaved={(s, a) => { onSaved(s); if (fix && a === fix.attr) setCorrected((prev) => new Set(prev).add(fix.attr)); }} />
    </section>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dateInput(d); };

interface FormProps {
  featureId: string;
  kind: 'segment' | 'crossing' | 'kerb';
  /** Ustawia z góry wybrany atrybut (np. z podpowiedzi AI). */
  presetAttr?: string;
  photoId?: string | null;
  /** Gdy ustawione, `photoId` dołącza się tylko do zgłoszenia tego atrybutu (poprawka podpowiedzi AI). */
  photoOnlyFor?: string;
  onSaved(states: StatesByAttr, attr: string): void;
}

export function ManualForm({ featureId, kind, presetAttr, photoId, photoOnlyFor, onSaved }: FormProps) {
  const applies = kind === 'segment' ? 'segment' : 'node';
  const attrs = Object.keys(ATTRS).filter((k) => ATTRS[k].reportable && ATTRS[k].appliesTo.includes(applies));
  const [attr, setAttr] = useState(presetAttr && attrs.includes(presetAttr) ? presetAttr : '');
  const [raw, setRaw] = useState('');
  const [until, setUntil] = useState(() => inDays(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const def = attr ? ATTRS[attr] : undefined;
  const today = dateInput(new Date());

  const change = (fn: () => void) => { fn(); setError(null); setDone(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!def) { setError('Wybierz, co chcesz zgłosić.'); return; }
    let value: AttrValue;
    if (def.type === 'bool') {
      if (raw !== 'true' && raw !== 'false') { setError('Wybierz wartość: jest albo nie ma.'); return; }
      value = raw === 'true';
    } else if (def.type === 'number') {
      if (raw.trim() === '') { setError(`Wpisz wartość${def.unit ? ` w ${def.unit}` : ''}.`); return; }
      value = Number(raw.replace(',', '.'));
    } else {
      if (raw === '') { setError('Wybierz wartość z listy.'); return; }
      value = raw;
    }
    if (!isValidValue(attr, value)) { setError(`Podaj poprawną wartość${def.unit ? ` (${def.unit}, od 0 do 9999)` : ''}.`); return; }
    let validUntil: string | undefined;
    if (attr === 'temporary_obstacle') {
      if (!until || until < today) { setError('Wybierz datę ważności nie wcześniejszą niż dzisiaj.'); return; }
      validUntil = new Date(`${until}T23:59:59`).toISOString();
    }
    setBusy(true); setError(null); setDone('');
    try {
      const res = await postObservation({ featureId, attr, value, validUntil, photoId: photoId && (!photoOnlyFor || photoOnlyFor === attr) ? photoId : undefined });
      onSaved(res.states, attr);
      setDone('Dziękujemy. Zgłoszenie jest oznaczone jako niepotwierdzone, dopóki nie potwierdzi go inna osoba.');
      setRaw('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form className="report-form" onSubmit={submit} noValidate>
      <label className="field">Co chcesz zgłosić?
        <select value={attr} onChange={(e) => change(() => { setAttr(e.target.value); setRaw(''); })}>
          <option value="">Wybierz…</option>
          {attrs.map((k) => <option key={k} value={k}>{ATTRS[k].label}</option>)}
        </select>
      </label>
      {def?.type === 'bool' && (
        <fieldset className="radios">
          <legend>{def.label}</legend>
          {([['true', 'jest'], ['false', 'nie ma']] as const).map(([v, l]) => (
            <label key={v}><input type="radio" name="report-bool" value={v} checked={raw === v} onChange={() => change(() => setRaw(v))} /> {l}</label>
          ))}
        </fieldset>
      )}
      {def?.type === 'number' && (
        <label className="field">{def.label}{def.unit ? ` (${def.unit})` : ''}
          <input type="number" inputMode="numeric" min={0} step="any" value={raw} onChange={(e) => change(() => setRaw(e.target.value))} />
        </label>
      )}
      {def?.type === 'enum' && (
        <label className="field">{def.label}
          <select value={raw} onChange={(e) => change(() => setRaw(e.target.value))}>
            <option value="">Wybierz…</option>
            {Object.entries(def.options ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      )}
      {attr === 'temporary_obstacle' && (
        <label className="field">Ważne do
          <input type="date" min={today} value={until} onChange={(e) => change(() => setUntil(e.target.value))} />
        </label>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <p role="status" className="report-done">{done}</p>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz'}</button>
    </form>
  );
}
