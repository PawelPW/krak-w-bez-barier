import type { StyleSpecification } from 'maplibre-gl';

export type BasemapId = 'light' | 'streets' | 'satellite';

export const ORTO_ATTRIBUTION = 'Ortofotomapa © GUGiK (Geoportal)';

/** Ortofotomapa Geoportalu (GUGiK): WMTS (KVP), zestaw EPSG:3857 = standardowy układ XYZ, kafel 256 px. Styl rastrowy nie potrzebuje glyphs ani sprite. */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    orto: {
      type: 'raster',
      tiles: ['https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: ORTO_ATTRIBUTION,
    },
  },
  layers: [{ id: 'orto', type: 'raster', source: 'orto' }],
};

export const BASEMAPS: { id: BasemapId; label: string; style: string | StyleSpecification }[] = [
  { id: 'light', label: 'Jasna', style: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'streets', label: 'Ulice', style: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'satellite', label: 'Satelita', style: SATELLITE_STYLE },
];

export const basemapById = (id: BasemapId) => BASEMAPS.find((b) => b.id === id)!;
export const isBasemapId = (v: unknown): v is BasemapId => BASEMAPS.some((b) => b.id === v);
