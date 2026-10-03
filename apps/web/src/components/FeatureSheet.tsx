import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTRS } from '@kbg/domain';
import type { Feature } from '@kbg/domain';
import { getDetail, postVerify } from '../api';
import type { ObservationView } from '../api';
import { useApp } from '../state';
import { VERDICT_LABEL, formatDate } from '../status';
import { AttrRow } from './AttrRow';

const KIND_TITLE = { crossing: 'Przejście dla pieszych', kerb: 'Krawężnik', segment: 'Odcinek bez nazwy' } as const;
const titleOf = (f: Feature) => f.name ?? KIND_TITLE[f.kind];

export function FeatureSheet() {
  const { selectedId, featuresById, select, states, profile, statusFor, evalFor, setFeatureStates } = useApp();
  const feature = selectedId ? featuresById.get(selectedId) : undefined;
  const [observations, setObservations] = useState<ObservationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback((id: string, isLive: () => boolean) => {
    getDetail(id).then(
      (d) => { if (isLive()) { setObservations(d.observations); setError(null); } },
      (e: Error) => { if (isLive()) setError(e.message); },
    );
  }, []);

  useEffect(() => {
    setObservations([]);
    setError(null);
    if (!selectedId) return;
    let live = true;
    load(selectedId, () => live);
    heading.current?.focus({ preventScroll: true });
    return () => { live = false; };
  }, [selectedId, load]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select]);

  if (!feature) return null;

  const onVerify = async (obsId: string, agree: boolean) => {
    try {
      const res = await postVerify(obsId, agree);
      setFeatureStates(feature.id, res.states);
      load(feature.id, () => true);
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
          <AttrRow key={k} attr={k} state={states[feature.id]?.[k]} observations={observations} onVerify={onVerify} />
        ))}
      </ul>
      {photos.length > 0 && (
        <div className="photos">
          <h3>Zdjęcia</h3>
          <ul>
            {photos.map((o) => (
              <li key={o.photoId}>
                <img src={`/photos/photos/${o.photoId}.jpg`} alt={`Zdjęcie odcinka: ${titleOf(feature)}`} loading="lazy" />
                <span>zdjęcie niezweryfikowane, {formatDate(o.observedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" disabled>Zgłoś zmianę</button>
      </div>
    </section>
  );
}
