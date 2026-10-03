import { useEffect, useMemo, useRef, useState } from 'react';
import { nearestFeature } from '@kbg/domain';
import type { LonLat } from '@kbg/domain';
import { useApp } from '../state';

// Nazwy szukane w migawce; Rynek Główny i plac Wolnica mają zapasowe współrzędne.
const WANTED: { name: string; label: string; fallback?: LonLat }[] = [
  { name: 'Rynek Główny', label: 'Rynek Główny', fallback: [19.9373, 50.0617] },
  { name: 'plac Wolnica', label: 'Plac Wolnica', fallback: [19.9445, 50.0516] },
  { name: 'Floriańska', label: 'ulica Floriańska' },
  { name: 'Grodzka', label: 'ulica Grodzka' },
  { name: 'Szeroka', label: 'ulica Szeroka' },
  { name: 'Józefa', label: 'ulica Józefa' },
];

type Which = 'from' | 'to';

export function RouteView() {
  const { features, route, routeBusy: busy, routeMessage: message, routeNotice, computeRoute, routeFrom, routeTo, setRouteFrom, setRouteTo, pickTarget, setPickTarget, setUserPos, select } = useApp();
  const [geoMsg, setGeoMsg] = useState('');
  // Wybrane „znane miejsce” per pole (indeks w `places` jako tekst, '' = placeholder).
  const [placeSel, setPlaceSel] = useState<Record<Which, string>>({ from: '', to: '' });
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

  const set = (w: Which, p: LonLat | null) => { (w === 'from' ? setRouteFrom : setRouteTo)(p); };

  const locate = () => {
    setGeoMsg('');
    if (!navigator.geolocation) { setGeoMsg('Nie udało się ustalić pozycji. Wskaż start na mapie.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p: LonLat = [pos.coords.longitude, pos.coords.latitude]; setUserPos(p); set('from', p); },
      (err) => setGeoMsg(err.code === err.PERMISSION_DENIED ? 'Brak zgody na lokalizację. Wskaż start na mapie.' : 'Nie udało się ustalić pozycji. Wskaż start na mapie.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const go = () => { if (routeFrom && routeTo) computeRoute(); };

  if (pickTarget) {
    return (
      <div className="panel-scroll pick-banner">
        <p role="status">Dotknij mapy, aby wskazać {pickTarget === 'from' ? 'start' : 'cel'}.</p>
        <button type="button" className="btn" onClick={() => setPickTarget(null)}>Anuluj</button>
      </div>
    );
  }

  const field = (w: Which, title: string, text: string, value: LonLat | null) => {
    // Wybór obowiązuje tylko dopóki punkt jest nadal tym miejscem (inaczej: ustawiony z mapy lub „Moja pozycja”).
    const sel = placeSel[w];
    const at = sel === '' ? undefined : places[Number(sel)]?.at;
    const chosen = at && value && at[0] === value[0] && at[1] === value[1] ? sel : '';
    return (
    <fieldset className="point">
      <legend>{title}</legend>
      <p className="point-text">{text}</p>
      <div className="point-actions">
        <button type="button" className="btn" onClick={() => setPickTarget(w)}>Wskaż na mapie</button>
        {w === 'from' && <button type="button" className="btn" onClick={locate}>Moja pozycja</button>}
      </div>
      <label className="select-label">Wybierz znane miejsce
        <select aria-label={`${title}: wybierz znane miejsce`} value={chosen}
          onChange={(e) => {
            const v = e.target.value;
            const p = v === '' ? undefined : places[Number(v)];
            if (!p) return;
            set(w, p.at);
            setPlaceSel((s) => ({ ...s, [w]: v }));
          }}>
          <option value="">Wybierz…</option>
          {places.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      </label>
    </fieldset>
    );
  };

  return (
    <div className="panel-scroll">
      <h1>Trasa</h1>
      <p>Aplikacja służy do planowania trasy, nie do prowadzenia. GPS w wąskich ulicach myli się o 5–15 m i nie rozróżnia stron ulicy.</p>
      {field('from', 'Start', fromText, routeFrom)}
      {geoMsg && <p role="alert" className="error">{geoMsg}</p>}
      {field('to', 'Cel', toText, routeTo)}
      <button type="button" className="btn btn-primary btn-block" disabled={!routeFrom || !routeTo || busy} onClick={go}>{busy ? 'Wyznaczanie…' : 'Wyznacz trasę'}</button>
      <p role="status" className="route-busy">{busy ? 'Wyznaczanie trasy…' : ''}</p>
      <div className="route-result">
        <div aria-live="polite" className="route-live">
          {routeNotice && <p>{routeNotice}</p>}
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
            </>
          )}
        </div>
        {route && (
          <>
            <h2>Nawierzchnie</h2>
            <ul>{Object.entries(route.summary.surfaces).map(([k, m]) => <li key={k}>{k}: {Math.round(m)} m</li>)}</ul>
            <h2>Krok po kroku</h2>
            <ol className="steps" role="list">
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
