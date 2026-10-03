import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { nearestFeature } from '@kbg/domain';
import type { LonLat, Status } from '@kbg/domain';
import { useApp } from '../state';
import { LINE, STATUS_LABEL } from '../status';

const STATUSES = Object.keys(LINE) as Status[];
const SEG_LAYERS = STATUSES.map((s) => `seg-${s}`);
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

interface Props {
  hidden?: boolean;
  /** Wybór punktu na mapie w zakładce Trasa. */
  onPick?: (lngLat: LonLat) => void;
}

export function MapView({ hidden, onPick }: Props) {
  const { features, bbox, states, profile, statusFor, selectedId, select, tab, route, routeFrom, routeTo, setMapCenter, setUserPos, getMapCenter, userPos, setReportFor } = useApp();
  const markers = useRef<{ from: maplibregl.Marker | null; to: maplibregl.Marker | null }>({ from: null, to: null });
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
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
    (map.getSource('features') as GeoJSONSource | undefined)?.setData(collection);
  };
  const recolour = () => {
    features.forEach((f, i) => { collection.features[i].properties.status = statusFor(f); });
    pushData();
  };
  const recolourRef = useRef(recolour);
  recolourRef.current = recolour;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: 'https://tiles.openfreemap.org/styles/positron',
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

    map.on('load', () => {
      map.addSource('features', { type: 'geojson', data: EMPTY });
      map.addSource('route', { type: 'geojson', data: EMPTY });
      for (const [status, s] of Object.entries(LINE)) {
        map.addLayer({
          id: `seg-${status}`, type: 'line', source: 'features',
          filter: ['all', ['==', ['get', 'kind'], 'segment'], ['==', ['get', 'status'], status]],
          layout: { 'line-cap': 'butt' },
          paint: { 'line-color': s.color, 'line-width': s.width, ...(s.dash ? { 'line-dasharray': s.dash } : {}) },
        });
      }
      map.addLayer({
        id: 'selected', type: 'line', source: 'features', filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': '#111827', 'line-width': 2, 'line-gap-width': 6, 'line-opacity': 0.9 },
      });
      // Węzły rozróżnialne nie tylko kolorem: ok = pełne z białą obwódką, difficult = puste kółko (gruba pomarańczowa obwódka),
      // blocked = pełne z grubą ciemnoczerwoną obwódką, unknown = półprzezroczyste szare.
      const st = (ok: unknown, difficult: unknown, blocked: unknown, unknown_: unknown) =>
        ['match', ['get', 'status'], 'ok', ok, 'difficult', difficult, 'blocked', blocked, unknown_] as never;
      map.addLayer({
        id: 'nodes', type: 'circle', source: 'features', minzoom: 15,
        filter: ['!=', ['get', 'kind'], 'segment'],
        paint: {
          'circle-radius': 6,
          'circle-stroke-width': st(2, 3, 3, 2),
          'circle-stroke-color': st('#ffffff', '#a34f00', '#5f1410', '#ffffff'),
          'circle-color': st('#1a7f37', '#ffffff', '#b3261e', 'rgba(107,114,128,0.6)'),
        },
      });
      map.addLayer({
        id: 'selected-node', type: 'circle', source: 'features', minzoom: 15,
        filter: ['==', ['get', 'id'], selRef.current ?? ''],
        paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3, 'circle-stroke-color': '#111827' },
      });
      map.setFilter('selected', ['==', ['get', 'id'], selRef.current ?? '']);
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1d4ed8', 'line-width': 7 } });
      readyRef.current = true;
      recolourRef.current();
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
    map.setFilter('selected', f);
    map.setFilter('selected-node', f);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      (map.getSource('route') as GeoJSONSource | undefined)?.setData(
        route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } } : EMPTY,
      );
      if (route && route.coords.length > 1) {
        const b = new maplibregl.LngLatBounds(route.coords[0], route.coords[0]);
        for (const c of route.coords) b.extend(c);
        map.fitBounds(b, { padding: { top: 48, left: 32, right: 32, bottom: Math.round(map.getContainer().clientHeight * 0.5) + 16 }, maxZoom: 18 });
      }
    };
    if (readyRef.current) apply(); else map.once('load', apply);
  }, [route]);

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
        <p role="status" className="geomsg"><span>{geoMsg}</span><span>{reportMsg}</span></p>
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
