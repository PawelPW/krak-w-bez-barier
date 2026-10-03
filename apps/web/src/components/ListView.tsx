import { useMemo, useState } from 'react';
import { distanceToFeatureM } from '@kbg/domain';
import type { Feature, LonLat, Status } from '@kbg/domain';
import { useApp } from '../state';

type KindFilter = 'all' | 'crossing' | 'segment';
const LIMIT = 60;
const KIND_LABEL = { crossing: 'Przejście dla pieszych', kerb: 'Krawężnik', segment: 'Odcinek' } as const;
const titleOf = (f: Feature) => f.name ? `${KIND_LABEL[f.kind]}: ${f.name}` : f.kind === 'segment' ? 'Odcinek bez nazwy' : KIND_LABEL[f.kind];
const PHRASE: Record<Status, string> = {
  blocked: 'Zablokowane dla Twojego profilu',
  difficult: 'Utrudnione dla Twojego profilu',
  unknown: 'Za mało danych dla Twojego profilu',
  ok: 'Bez znanych przeszkód dla Twojego profilu',
};

export function ListView() {
  const { features, userPos, setUserPos, getMapCenter, statusFor, evalFor, select } = useApp();
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  // Środek mapy czytany raz przy pokazaniu listy (mapa jest wtedy ukryta, więc się nie zmienia).
  const [center] = useState<LonLat>(getMapCenter);
  const ref: LonLat = userPos ?? center;
  const [geoMsg, setGeoMsg] = useState('');
  const locate = () => {
    setGeoMsg('');
    const fail = (m: string) => setGeoMsg(m);
    if (!navigator.geolocation) { fail('Nie udało się ustalić pozycji. Sortuję od środka mapy.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoMsg(''); setUserPos([pos.coords.longitude, pos.coords.latitude]); },
      (err) => fail(err.code === err.PERMISSION_DENIED ? 'Brak zgody na lokalizację. Sortuję od środka mapy.' : 'Nie udało się ustalić pozycji. Sortuję od środka mapy.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

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
      <button type="button" className="btn" onClick={locate}>Użyj mojej pozycji</button>
      <p role="status" className="sort-note">{geoMsg || (userPos ? 'Sortowanie według odległości od Twojej pozycji.' : 'Sortowanie według odległości od środka mapy.')}</p>
      <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Tylko problemy dla mojego profilu</label>
      <fieldset className="radios">
        <legend>Rodzaj</legend>
        {([['all', 'Wszystkie'], ['crossing', 'Przejścia'], ['segment', 'Odcinki']] as const).map(([v, l]) => (
          <label key={v}><input type="radio" name="kind" checked={kind === v} onChange={() => setKind(v)} /> {l}</label>
        ))}
      </fieldset>
      <p role="status" className="count">Pozycji na liście: {items.length}{items.length >= LIMIT ? ' (najbliższe)' : ''}</p>
      <ul className="places" role="list">
        {items.map(({ f, dist, status }) => {
          const reasons = evalFor(f).reasons.map((r) => r.text);
          return (
            <li key={f.id}>
              <button type="button" className={`place place-${status}`} onClick={() => select(f.id)}>
                <span className="place-title">{titleOf(f)}, {Math.round(dist)} m.</span>{' '}
                <span className="place-status">{PHRASE[status]}{reasons.length ? ':' : '.'}</span>
                {reasons.length > 0 && <span className="place-reasons"> {reasons.join('. ')}.</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
