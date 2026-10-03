import { useMemo, useState } from 'react';
import { distanceToFeatureM } from '@kbg/domain';
import type { Feature, LonLat, Status } from '@kbg/domain';
import { useApp } from '../state';
import { STATUS_LABEL } from '../status';

type KindFilter = 'all' | 'crossing' | 'segment';
const LIMIT = 60;
const KIND_TITLE = { crossing: 'Przejście dla pieszych', kerb: 'Krawężnik', segment: 'Odcinek bez nazwy' } as const;
const PHRASE: Record<Status, string> = {
  blocked: 'Zablokowane dla Twojego profilu',
  difficult: 'Utrudnione dla Twojego profilu',
  unknown: 'Za mało danych dla Twojego profilu',
  ok: 'Bez znanych przeszkód dla Twojego profilu',
};

export function ListView() {
  const { features, userPos, mapCenter, statusFor, evalFor, select } = useApp();
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const ref: LonLat = userPos ?? mapCenter;

  // Odległości liczone raz na zmianę punktu odniesienia; potem tylko lazy filtrowanie po statusie.
  const sorted = useMemo(() => {
    const d = features.map((f) => distanceToFeatureM(f, ref));
    const idx = features.map((_, i) => i).sort((a, b) => d[a] - d[b]);
    return { d, idx };
  }, [features, ref]);

  const items = useMemo(() => {
    const out: { f: Feature; dist: number; status: Status }[] = [];
    const seen = new Set<string>();
    for (const i of sorted.idx) {
      const f = features[i];
      if (kind === 'crossing' && f.kind !== 'crossing') continue;
      if (kind === 'segment' && f.kind !== 'segment') continue;
      const status = statusFor(f);
      if (onlyProblems && status !== 'blocked' && status !== 'difficult') continue;
      if (f.kind === 'segment') { // segmenty tej samej drogi o tym samym statusie → jedna pozycja (najbliższy)
        const key = `${f.osmId}|${status}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push({ f, dist: sorted.d[i], status });
      if (out.length >= LIMIT) break;
    }
    return out;
  }, [features, sorted, statusFor, kind, onlyProblems]);

  return (
    <>
      <h1>Miejsca w pobliżu</h1>
      <p>{userPos ? 'Sortowanie według odległości od Twojej pozycji.' : 'Sortowanie według odległości od środka mapy (brak zgody na lokalizację).'}</p>
      <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Tylko problemy dla mojego profilu</label>
      <fieldset className="radios">
        <legend>Rodzaj</legend>
        {([['all', 'Wszystkie'], ['crossing', 'Przejścia'], ['segment', 'Odcinki']] as const).map(([v, l]) => (
          <label key={v}><input type="radio" name="kind" checked={kind === v} onChange={() => setKind(v)} /> {l}</label>
        ))}
      </fieldset>
      <p role="status" className="count">Pozycji na liście: {items.length}{items.length >= LIMIT ? ' (najbliższe)' : ''}</p>
      <ul className="places">
        {items.map(({ f, dist, status }) => {
          const reasons = evalFor(f).reasons.map((r) => r.text);
          return (
            <li key={f.id}>
              <button type="button" className={`place place-${status}`} onClick={() => select(f.id)}>
                <span className="place-title">{f.name ?? KIND_TITLE[f.kind]}, {Math.round(dist)} m.</span>{' '}
                <span className="place-status">{PHRASE[status]}{reasons.length ? ':' : '.'}</span>
                {reasons.length > 0 && <span className="place-reasons"> {reasons.join('. ')}.</span>}
                <span className="sr-only"> Status: {STATUS_LABEL[status]}.</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
