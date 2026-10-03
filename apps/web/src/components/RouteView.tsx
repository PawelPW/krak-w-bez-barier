import { useEffect, useMemo, useRef, useState } from 'react';
import { nearestFeature } from '@kbg/domain';
import type { LonLat } from '@kbg/domain';
import { postRoute } from '../api';
import { useApp } from '../state';

// Nazwy szukane w migawce; Rynek Główny i plac Wolnica mają zapasowe współrzędne.
const WANTED: { name: string; label: string; fallback?: LonLat }[] = [
  { name: 'Rynek Główny', label: 'Rynek Główny', fallback: [19.9373, 50.0617] },
  { name: 'plac Wolnica', label: 'Plac Wolnica', fallback: [19.9445, 50.0516] },
  { name: 'plac Nowy', label: 'Plac Nowy' },
  { name: 'Planty', label: 'Planty' },
  { name: 'Floriańska', label: 'ulica Floriańska' },
  { name: 'Grodzka', label: 'ulica Grodzka' },
  { name: 'Szeroka', label: 'ulica Szeroka' },
  { name: 'Józefa', label: 'ulica Józefa' },
];

type Which = 'from' | 'to';

export function RouteView() {
  const { features, profile, route, setRoute, routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, setPickTarget, setUserPos, select } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'alert' | 'info'; text: string } | null>(null);
  const [geoMsg, setGeoMsg] = useState('');
  const sentenceRef = useRef<HTMLParagraphElement>(null);
  // Wynik pojawia się pod formularzem w niskim panelu: przewiń, żeby zdanie było widoczne.
  useEffect(() => { if (route) sentenceRef.current?.scrollIntoView({ block: 'start' }); }, [route]);

  const places = useMemo(() => {
    const byName = new Map<string, LonLat>();
    for (const f of features) if (f.name && f.coords.length && !byName.has(f.name)) byName.set(f.name, f.coords[0]);
    const out: { label: string; at: LonLat }[] = [];
    for (const w of WANTED) {
      const at = byName.get(w.name) ?? w.fallback;
      if (at) out.push({ label: w.label, at });
    }
    return out;
  }, [features]);

  const describe = useMemo(() => (p: LonLat | null) => {
    if (!p) return 'nie wybrano';
    const name = nearestFeature(features, p, 60, 'segment')?.name;
    return name ? `przy: ${name}` : `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
  }, [features]);
  const fromText = useMemo(() => describe(routeFrom), [describe, routeFrom]);
  const toText = useMemo(() => describe(routeTo), [describe, routeTo]);

  const set = (w: Which, p: LonLat | null) => { setMessage(null); (w === 'from' ? setRouteFrom : setRouteTo)(p); };

  const locate = () => {
    setGeoMsg('');
    if (!navigator.geolocation) { setGeoMsg('Brak zgody na lokalizację. Wskaż start na mapie.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p: LonLat = [pos.coords.longitude, pos.coords.latitude]; setUserPos(p); set('from', p); },
      () => setGeoMsg('Brak zgody na lokalizację. Wskaż start na mapie.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const go = async () => {
    if (!routeFrom || !routeTo) return;
    setBusy(true); setMessage(null); setRoute(null);
    try {
      const res = await postRoute(routeFrom, routeTo, profile);
      if ('error' in res) {
        setMessage({ kind: 'info', text: res.error === 'out_of_area' ? 'Ten punkt jest poza obszarem dema (Stare Miasto i Kazimierz).' : 'Nie znaleziono połączenia między tymi punktami.' });
      } else if (res.coords.length === 0 || res.summary.lengthM === 0) {
        setMessage({ kind: 'info', text: 'Start i cel to to samo miejsce. Wskaż dwa różne punkty.' });
      } else {
        setRoute(res);
      }
    } catch (e) {
      setMessage({ kind: 'alert', text: (e as Error).message });
    } finally { setBusy(false); }
  };

  if (pickTarget) {
    return (
      <div className="panel-scroll pick-banner">
        <p role="status">Dotknij mapy, aby wskazać {pickTarget === 'from' ? 'start' : 'cel'}.</p>
        <button type="button" className="btn" onClick={() => setPickTarget(null)}>Anuluj</button>
      </div>
    );
  }

  const field = (w: Which, title: string, text: string, value: LonLat | null) => (
    <fieldset className="point">
      <legend>{title}</legend>
      <p className="point-text">{text}</p>
      <div className="point-actions">
        <button type="button" className="btn" onClick={() => setPickTarget(w)}>Wskaż na mapie</button>
        {w === 'from' && <button type="button" className="btn" onClick={locate}>Moja pozycja</button>}
      </div>
      <label className="select-label">Wybierz znane miejsce
        <select value="" onChange={(e) => { const p = places[Number(e.target.value)]; if (p) set(w, p.at); }}>
          <option value="">{value ? 'Zmień miejsce…' : 'Wybierz…'}</option>
          {places.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      </label>
    </fieldset>
  );

  return (
    <div className="panel-scroll">
      <h1>Trasa</h1>
      <p>Aplikacja służy do planowania trasy, nie do prowadzenia. GPS w wąskich ulicach myli się o 5–15 m i nie rozróżnia stron ulicy.</p>
      {field('from', 'Start', fromText, routeFrom)}
      {geoMsg && <p role="alert" className="error">{geoMsg}</p>}
      {field('to', 'Cel', toText, routeTo)}
      <button type="button" className="btn btn-primary btn-block" disabled={!routeFrom || !routeTo || busy} onClick={go}>{busy ? 'Wyznaczanie…' : 'Wyznacz trasę'}</button>
      <div aria-live="polite" className="route-result">
        {message && (message.kind === 'alert' ? <p role="alert" className="error">{message.text}</p> : <p>{message.text}</p>)}
        {route && (
          <>
            {route.violatesHardRules && (
              <>
                <p role="alert" className="error">Nie ma trasy spełniającej Twoje wymagania. Ta trasa łamie je w tych miejscach:</p>
                <ul>{route.violated.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
              </>
            )}
            <p className="sentence" ref={sentenceRef}>{route.sentence}</p>
            <h2>Nawierzchnie</h2>
            <ul>{Object.entries(route.summary.surfaces).map(([k, m]) => <li key={k}>{k}: {Math.round(m)} m</li>)}</ul>
            <h2>Krok po kroku</h2>
            <ol className="steps">
              {route.steps.map((s, i) => (
                <li key={i}><button type="button" className="step" onClick={() => select(s.featureId)}>{s.text}</button></li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
