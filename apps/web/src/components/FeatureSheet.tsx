import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTRS } from '@kbg/domain';
import { getDetail, postObservation, postVerify } from '../api';
import type { ObservationView } from '../api';
import { useApp } from '../state';
import { VERDICT_LABEL, featureTitle, formatDate } from '../status';
import { AttrRow } from './AttrRow';

const titleOf = featureTitle;

export function FeatureSheet() {
  const { selectedId, featuresById, select, states, profile, statusFor, evalFor, setFeatureStates, reportFor, setReportFor } = useApp();
  const feature = selectedId ? featuresById.get(selectedId) : undefined;
  const [detail, setDetail] = useState<{ id: string; list: ObservationView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selRef = useRef<string | null>(selectedId);
  selRef.current = selectedId;
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Obserwacje innej cechy nigdy nie są pokazywane (żadnych migających przycisków głosowania).
  const observations = detail && detail.id === selectedId ? detail.list : [];

  const load = useCallback((id: string) => {
    getDetail(id).then(
      (d) => { if (selRef.current === id) { setDetail({ id, list: d.observations }); setError(null); } },
      (e: Error) => { if (selRef.current === id) setError(e.message); },
    );
  }, []);

  useEffect(() => {
    setError(null);
    if (!selectedId) {
      if (wasOpen.current) {
        wasOpen.current = false;
        const o = opener.current;
        opener.current = null;
        const ok = o && document.contains(o) && !o.closest('[aria-hidden="true"]');
        (ok ? o : document.getElementById('main'))?.focus();
      }
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    load(selectedId);
    heading.current?.focus({ preventScroll: true });
  }, [selectedId, load]);

  // Stany cechy zmieniły się (zgłoszenie, głos, odnowienie): odśwież listę obserwacji.
  const st = selectedId ? states[selectedId] : undefined;
  const seen = useRef<{ id: string; st: unknown } | null>(null);
  useEffect(() => {
    if (!selectedId) { seen.current = null; return; }
    const prev = seen.current;
    seen.current = { id: selectedId, st };
    if (prev && prev.id === selectedId && prev.st !== st) load(selectedId);
  }, [selectedId, st, load]);

  useEffect(() => {
    if (!selectedId || reportFor) return; // Escape w dialogu zamyka tylko dialog
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select, reportFor]);

  if (!feature) return null;

  const onVerify = async (obsId: string, agree: boolean): Promise<void> => {
    try {
      const res = await postVerify(obsId, agree);
      setFeatureStates(feature.id, res.states);
    } catch (e) { setError((e as Error).message); }
  };

  const onRenew = async (obs: ObservationView, still: boolean) => {
    try {
      setError(null);
      const value = still ? obs.value : !obs.value;
      const validUntil = still ? new Date(Date.now() + 7 * 86_400_000).toISOString() : undefined;
      const res = await postObservation({ featureId: feature.id, attr: obs.attr, value, validUntil });
      setFeatureStates(feature.id, res.states);
    } catch (e) { setError((e as Error).message); }
  };

  const status = statusFor(feature);
  const reasons = evalFor(feature).reasons;
  const applies = feature.kind === 'segment' ? 'segment' : 'node';
  const attrs = Object.keys(ATTRS).filter((k) => ATTRS[k].appliesTo.includes(applies));
  const photos = observations.filter((o) => o.photoId).filter((o, i, a) => a.findIndex((x) => x.photoId === o.photoId) === i);

  return (
    <section className="sheet" role="dialog" aria-modal="false" aria-labelledby="sheet-title">
      <div className="sheet-top">
        <h2 id="sheet-title" tabIndex={-1} ref={heading}>{titleOf(feature)}</h2>
        <button type="button" className="btn" onClick={() => select(null)}>Zamknij</button>
      </div>
      <div className="sheet-body">
      <p className={`verdict verdict-${status}`}>Dla profilu {profile.label}: {VERDICT_LABEL[status]}</p>
      {reasons.length > 0 && <ul className="reasons">{reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>}
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="attrs">
        {attrs.map((k) => (
          <AttrRow key={k} attr={k} state={states[feature.id]?.[k]} observations={observations} onVerify={onVerify} onRenew={onRenew} />
        ))}
      </ul>
      {photos.length > 0 && (
        <div className="photos">
          <h3>Zdjęcia</h3>
          <ul>
            {photos.map((o) => (
              <li key={o.photoId}>
                <img src={`/photos/${o.photoId}.jpg`} alt={`Zdjęcie odcinka: ${titleOf(feature)}`} loading="lazy" />
                <span>zdjęcie niezweryfikowane, {formatDate(o.observedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => setReportFor(feature.id)}>Zgłoś zmianę</button>
      </div>
    </section>
  );
}
