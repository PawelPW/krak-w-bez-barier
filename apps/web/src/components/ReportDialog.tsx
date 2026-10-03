import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ATTRS, isValidValue } from '@kbg/domain';
import type { AttrValue, StatesByAttr } from '@kbg/domain';
import { postObservation } from '../api';
import type { PhotoResult } from '../api';
import { useApp } from '../state';
import { featureTitle } from '../status';

interface Props {
  featureId: string;
  onClose(): void;
  onSaved(states: StatesByAttr): void;
  /** Task 10: zdjęcie z podpowiedziami AI; jego `photoId` trafia do zgłoszenia. */
  initialPhoto?: PhotoResult;
}

export function ReportDialog({ featureId, onClose, onSaved, initialPhoto }: Props) {
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
        {/* Miejsce na sekcję zdjęcia (Task 10), nad formularzem ręcznym. */}
        <ManualForm featureId={featureId} kind={feature.kind} photoId={initialPhoto?.photoId} onSaved={onSaved} />
        <button type="button" className="btn btn-block" onClick={() => ref.current?.close()}>Gotowe</button>
      </div>
    </dialog>
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
  onSaved(states: StatesByAttr): void;
}

export function ManualForm({ featureId, kind, presetAttr, photoId, onSaved }: FormProps) {
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
      const res = await postObservation({ featureId, attr, value, validUntil, photoId: photoId ?? undefined });
      onSaved(res.states);
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
