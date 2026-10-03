import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { nearestFeature } from '@kbg/domain';
import type { LonLat, Status } from '@kbg/domain';
import { useApp } from '../state';
import { LINE, STATUS_LABEL } from '../status';
import { BASEMAPS, basemapById } from '../basemaps';
import type { BasemapId } from '../basemaps';

const STATUSES = Object.keys(LINE) as Status[];
const SEG_LAYERS = STATUSES.map((s) => `seg-${s}`);
/** Tyle błędów kafli satelity przed pierwszym udanym kafem oznacza, że podkładu nie da się pokazać. */
const SAT_TILE_ERRORS = 4;
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

interface Props {
  hidden?: boolean;
  /** Wybór punktu na mapie w zakładce Trasa. */
  onPick?: (lngLat: LonLat) => void;
}

export function MapView({ hidden, onPick }: Props) {
  const { basemap, setBasemap, features, bbox, states, profile, statusFor, selectedId, select, tab, route, routeFrom, routeTo, setMapCenter, setUserPos, getMapCenter, userPos, setReportFor } = useApp();
  const markers = useRef<{ from: maplibregl.Marker | null; to: maplibregl.Marker | null }>({ from: null, to: null });
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  /** Podkład, który się jeszcze wczytuje (do czasu style.load albo pierwszego kafla satelity). */
  const pendingRef = useRef<{ id: BasemapId; token: number; styleLoaded: boolean; tileErrors: number } | null>({ id: basemap, token: 0, styleLoaded: false, tileErrors: 0 });
  const revertedRef = useRef(false);
  const firstStyleRef = useRef(true);
  const tokenRef = useRef(0);
  const [basemapMsg, setBasemapMsg] = useState('');
  const settle = (id: BasemapId) => {
    pendingRef.current = null;
    const first = firstStyleRef.current;
    firstStyleRef.current = false;
    if (revertedRef.current) { revertedRef.current = false; return; } // po powrocie zostaje komunikat o błędzie
    if (first) return; // start aplikacji nie jest zmianą podkładu
    setBasemapMsg(`Podkład mapy: ${basemapById(id).label}`);
  };
  // Komunikat o udanej zmianie podkładu znika po chwili (nie zabiera miejsca nad mapą); błąd zostaje.
  useEffect(() => {
    if (!basemapMsg.startsWith('Podkład')) return;
    const t = setTimeout(() => setBasemapMsg(''), 4000);
    return () => clearTimeout(t);
  }, [basemapMsg]);
  const appliedRef = useRef<BasemapId>(basemap);
  const geoRef = useRef<maplibregl.GeolocateControl | null>(null);
  const selRef = useRef<string | null>(selectedId);
  selRef.current = selectedId;
  const [geoMsg, setGeoMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const live = useRef({ tab, select, onPick });
  live.current = { tab, select, onPick };

  // Geometria jest statyczna: kolekcja budowana raz, później zmienia się tylko właściwość `status`.
  const collection = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: features.map((f) => ({
      type: 'Feature' as const,
      properties: { id: f.id, kind: f.kind, status: 'unknown' as Status },
      geometry: f.kind === 'segment'
        ? { type: 'LineString' as const, coordinates: f.coords }
        : { type: 'Point' as const, coordinates: f.coords[0] },
    })),
  }), [features]);

  const pushData = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    // Podczas przeładowania stylu źródła chwilowo nie ma; style.load nałoży aktualne dane (kolekcja jest mutowana na bieżąco).
    (map.getSource('features') as GeoJSONSource | undefined)?.setData(collection);
  };
  const recolour = () => {
    features.forEach((f, i) => { collection.features[i].properties.status = statusFor(f); });
    pushData();
  };
  const recolourRef = useRef(recolour);
  recolourRef.current = recolour;
  const pushRoute = () => {
    const map = mapRef.current;
    (map?.getSource('route') as GeoJSONSource | undefined)?.setData(
      route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } } : EMPTY,
    );
  };
  const pushRouteRef = useRef(pushRoute);
  pushRouteRef.current = pushRoute;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: basemapById(basemap).style,
      center: [19.940, 50.057],
      zoom: 15,
      keyboard: false,
      maxBounds: [[bbox.west - 0.01, bbox.south - 0.01], [bbox.east + 0.01, bbox.north + 0.01]],
    });
    mapRef.current = map;
    const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false });
    geoRef.current = geo;
    map.addControl(geo, 'top-right');
    geo.on('geolocate', (e: GeolocationPosition) => { setGeoMsg(''); setUserPos([e.coords.longitude, e.coords.latitude]); });
    map.on('moveend', () => { const c = map.getCenter(); setMapCenter([c.lng, c.lat]); });
    geo.on('error', (e: GeolocationPositionError) => setGeoMsg(e.code === 1 ? 'Brak zgody na lokalizację.' : 'Nie udało się ustalić lokalizacji.'));
    // Mapa jest aria-hidden: nic w jej wnętrzu nie może być osiągalne klawiaturą.
    const untab = () => {
      const root = el.current;
      if (!root) return;
      root.querySelectorAll<HTMLElement>('.maplibregl-canvas, .maplibregl-canvas-container, .maplibregl-ctrl button, a, summary, [tabindex="0"]')
        .forEach((n) => { if (n.getAttribute('tabindex') !== '-1') n.setAttribute('tabindex', '-1'); });
    };
    untab();
    map.on('idle', untab);

    // Własne źródła i warstwy znikają przy każdym setStyle, więc nakładamy je po każdym style.load (idempotentnie).
    const addOverlay = () => {
      if (!map.getSource('features')) map.addSource('features', { type: 'geojson', data: EMPTY });
      if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY });
      const casingOpacity = basemapRef.current === 'satellite' ? 0.9 : 0.7;
      // Najpierw wszystkie obwódki, potem wszystkie linie: obwódka jednego statusu nie może przykrywać linii innego.
      const segFilter = (status: string) => ['all', ['==', ['get', 'kind'], 'segment'], ['==', ['get', 'status'], status]] as never;
      for (const [status, s] of Object.entries(LINE)) {
        // Biała obwódka (zawsze ciągła, żeby kreskowanie zostało czytelne na zdjęciach).
        if (!map.getLayer(`seg-casing-${status}`)) {
          map.addLayer({
            id: `seg-casing-${status}`, type: 'line', source: 'features', filter: segFilter(status),
            layout: { 'line-cap': 'butt' },
            paint: { 'line-color': '#ffffff', 'line-width': s.width + 3, 'line-opacity': casingOpacity },
          });
        }
      }
      for (const [status, s] of Object.entries(LINE)) {
        if (!map.getLayer(`seg-${status}`)) {
          map.addLayer({
            id: `seg-${status}`, type: 'line', source: 'features', filter: segFilter(status),
            layout: { 'line-cap': 'butt' },
            paint: { 'line-color': s.color, 'line-width': s.width, ...(s.dash ? { 'line-dasharray': s.dash } : {}) },
          });
        }
      }
      const sel = ['==', ['get', 'id'], selRef.current ?? ''] as never;
      if (!map.getLayer('selected')) {
        map.addLayer({
          id: 'selected', type: 'line', source: 'features', filter: sel,
          layout: { 'line-cap': 'round' }, paint: { 'line-color': '#111827', 'line-width': 2, 'line-gap-width': 6, 'line-opacity': 0.9 },
        });
      }
      // Węzły rozróżnialne nie tylko kolorem: ok = pełne z białą obwódką, difficult = puste kółko (gruba pomarańczowa obwódka),
      // blocked = pełne z grubą ciemnoczerwoną obwódką, unknown = półprzezroczyste szare.
      const st = (ok: unknown, difficult: unknown, blocked: unknown, unknown_: unknown) =>
        ['match', ['get', 'status'], 'ok', ok, 'difficult', difficult, 'blocked', blocked, unknown_] as never;
      if (!map.getLayer('nodes')) {
        map.addLayer({
          id: 'nodes', type: 'circle', source: 'features', minzoom: 15,
          filter: ['!=', ['get', 'kind'], 'segment'],
          paint: {
            'circle-radius': 6,
            'circle-stroke-width': st(3, 3, 3, 3),
            'circle-stroke-color': st('#ffffff', '#a34f00', '#5f1410', '#ffffff'),
            'circle-color': st('#1a7f37', '#ffffff', '#b3261e', 'rgba(107,114,128,0.6)'),
          },
        });
      }
      if (!map.getLayer('selected-node')) {
        map.addLayer({
          id: 'selected-node', type: 'circle', source: 'features', minzoom: 15, filter: sel,
          paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': '#111827' },
        });
      }
      if (!map.getLayer('route-casing')) map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
      if (!map.getLayer('route')) map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1d4ed8', 'line-width': 7 } });
      readyRef.current = true;
      recolourRef.current();
      pushRouteRef.current();
    };
    map.on('style.load', () => {
      addOverlay();
      const p = pendingRef.current;
      if (p) p.styleLoaded = true;
      if (p && p.id !== 'satellite') settle(p.id); // satelita: za udany uznajemy dopiero pierwszy kafel
    });
    map.on('data', (e) => {
      const p = pendingRef.current;
      if (p && p.id === 'satellite' && (e as { sourceId?: string }).sourceId === 'orto' && (e as { tile?: unknown }).tile) settle(p.id);
    });
    // Podkład się nie wczytał (styl nie przyszedł albo satelita nie dostał żadnego kafla): jednorazowy powrót do „Jasnej”.
    map.on('error', (e) => {
      const p = pendingRef.current;
      if (!p) return;
      const sid = (e as { sourceId?: string }).sourceId;
      // Błędy kafli innego źródła niż docelowy podkład (spóźnione żądania poprzedniego stylu) są ignorowane.
      // Geoportal potrafi sporadycznie zwrócić 404 dla pojedynczego kafla, więc satelita wraca do „Jasnej”
      // dopiero po kilku błędach kafli bez żadnego udanego. Styl URL: błąd bez źródła przed style.load = nie pobrano stylu.
      let fatal = false;
      if (p.id === 'satellite') {
        if (sid === 'orto') { p.tileErrors++; fatal = p.tileErrors >= SAT_TILE_ERRORS; }
      } else if (!sid && !p.styleLoaded) {
        fatal = true;
      }
      if (!fatal) return;
      pendingRef.current = null;
      if (p.id === 'light') return;
      revertedRef.current = true;
      setBasemapMsg('Nie udało się wczytać podkładu. Wracam do mapy jasnej.');
      setBasemap('light', { persist: false }); // zapisany wybór użytkownika zostaje
    });

    map.on('click', (e) => {
      const { tab: t, select: sel, onPick: pick } = live.current;
      if (t === 'route') { pick?.([e.lngLat.lng, e.lngLat.lat]); return; }
      const box: [[number, number], [number, number]] = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
      const hits = (layers: string[]): MapGeoJSONFeature[] => map.queryRenderedFeatures(box, { layers: layers.filter((l) => map.getLayer(l)) });
      const hit = hits(['nodes'])[0] ?? hits(SEG_LAYERS)[0];
      sel(hit ? String(hit.properties.id) : null);
    });

    return () => { readyRef.current = false; markers.current = { from: null, to: null }; map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { recolour(); }, [states, profile, features]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const f: ['==', ['get', string], string] = ['==', ['get', 'id'], selectedId ?? ''];
    if (map.getLayer('selected')) map.setFilter('selected', f);
    if (map.getLayer('selected-node')) map.setFilter('selected-node', f);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pushRoute(); // gdy styl się przeładowuje, trasę nałoży style.load
    if (route && route.coords.length > 1) {
      const b = new maplibregl.LngLatBounds(route.coords[0], route.coords[0]);
      for (const c of route.coords) b.extend(c);
      map.fitBounds(b, { padding: { top: 48, left: 32, right: 32, bottom: Math.round(map.getContainer().clientHeight * 0.5) + 16 }, maxZoom: 18 });
    }
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zmiana podkładu: diff wyłączony, bo własne warstwy dodajemy sami po style.load; kamera zostaje bez zmian.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedRef.current === basemap) return;
    appliedRef.current = basemap;
    readyRef.current = false;
    pendingRef.current = { id: basemap, token: ++tokenRef.current, styleLoaded: false, tileErrors: 0 };
    if (!revertedRef.current) setBasemapMsg(''); // po awaryjnym powrocie zostaje komunikat o błędzie
    map.setStyle(basemapById(basemap).style, { diff: false });
  }, [basemap]);

  // Znaczniki startu (S, zielony) i celu (C, czerwony); litera, nie tylko kolor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [key, pt, letter] of [['from', routeFrom, 'S'], ['to', routeTo, 'C']] as const) {
      const cur = markers.current[key];
      if (!pt) { cur?.remove(); markers.current[key] = null; continue; }
      if (cur) { cur.setLngLat(pt); continue; }
      const node = document.createElement('div');
      node.className = `pin pin-${key}`;
      node.textContent = letter;
      markers.current[key] = new maplibregl.Marker({ element: node }).setLngLat(pt).addTo(map);
    }
  }, [routeFrom, routeTo]);

  useEffect(() => setReportMsg(''), [selectedId, tab]);

  // Zgłoszenie dla zaznaczonej cechy albo najbliższej w promieniu 30 m od pozycji użytkownika / środka mapy.
  const report = () => {
    setReportMsg('');
    if (selectedId) { setReportFor(selectedId); return; }
    const f = nearestFeature(features, userPos ?? getMapCenter(), 30);
    if (f) setReportFor(f.id);
    else setReportMsg('Dotknij odcinka lub przejścia na mapie, którego dotyczy zgłoszenie.');
  };

  return (
    <div className="mapwrap" style={hidden ? { visibility: 'hidden' } : undefined}>
      <a href="#main" className="skip">Pomiń mapę</a>
      <div className="mapbar">
        <button type="button" className="btn" onClick={() => { setGeoMsg(''); geoRef.current?.trigger(); }}>Pokaż moją lokalizację</button>
        {tab === 'map' && <button type="button" className="btn" onClick={report}>Zgłoś</button>}
        <fieldset className="basemaps">
          <legend className="sr-only">Podkład mapy</legend>
          {BASEMAPS.map((b) => (
            <label key={b.id} className="seg">
              <input type="radio" name="basemap" value={b.id} checked={basemap === b.id} onChange={() => setBasemap(b.id)} />
              <span>{b.label}</span>
            </label>
          ))}
        </fieldset>
        <p role="status" className="geomsg"><span>{geoMsg}</span><span>{reportMsg}</span><span className={basemapMsg.startsWith('Nie') ? undefined : 'sr-only'}>{basemapMsg}</span></p>
      </div>
      <div ref={el} className="map" aria-hidden="true" />
      <div role="region" aria-label="Legenda mapy">
      <ul className="legend">
        {STATUSES.map((s) => (
          <li key={s}>
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true" focusable="false">
              <line x1="1" y1="5" x2="33" y2="5" stroke={LINE[s].color} strokeWidth={LINE[s].width}
                strokeDasharray={LINE[s].dash?.map((d) => d * LINE[s].width).join(' ')} />
            </svg>
            <span>{STATUS_LABEL[s]}</span>
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
