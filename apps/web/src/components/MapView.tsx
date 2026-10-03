import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LonLat, Status } from '@kbg/domain';
import { useApp } from '../state';
import { LINE, STATUS_LABEL } from '../status';

const STATUSES = Object.keys(LINE) as Status[];
const SEG_LAYERS = STATUSES.map((s) => `seg-${s}`);
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

interface Props {
  hidden?: boolean;
  /** Używane od Task 8: wybór punktu na mapie w zakładce Trasa. */
  onPick?: (lngLat: LonLat) => void;
}

export function MapView({ hidden, onPick }: Props) {
  const { features, bbox, states, profile, statusFor, selectedId, select, tab, route } = useApp();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
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
      maxBounds: [[bbox.west - 0.01, bbox.south - 0.01], [bbox.east + 0.01, bbox.north + 0.01]],
    });
    mapRef.current = map;
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');

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
      map.addLayer({
        id: 'nodes', type: 'circle', source: 'features', minzoom: 15,
        filter: ['!=', ['get', 'kind'], 'segment'],
        paint: { 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
          'circle-color': ['match', ['get', 'status'], 'ok', '#1a7f37', 'difficult', '#b35900', 'blocked', '#b3261e', '#6b7280'] },
      });
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

    return () => { readyRef.current = false; map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { recolour(); }, [states, profile, features]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setFilter('selected', ['==', ['get', 'id'], selectedId ?? '']);
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
        map.fitBounds(b, { padding: 48, maxZoom: 18 });
      }
    };
    if (readyRef.current) apply(); else map.once('load', apply);
  }, [route]);

  return (
    <div className="mapwrap" style={hidden ? { visibility: 'hidden' } : undefined}>
      <a href="#main" className="skip">Pomiń mapę</a>
      <div ref={el} className="map" aria-hidden="true" />
      <ul className="legend" aria-label="Legenda mapy">
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
  );
}
