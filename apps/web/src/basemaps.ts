import type { StyleSpecification } from 'maplibre-gl';

export type BasemapId = 'light' | 'streets' | 'satellite';

export const ORTO_ATTRIBUTION = 'Ortofotomapa © GUGiK (Geoportal)';

/** Ortofotomapa Geoportalu (GUGiK): WMS 1.3.0, EPSG:3857 (oś x,y), kafel 256 px. Styl rastrowy nie potrzebuje glyphs ani sprite. */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    orto: {
      type: 'raster',
      tiles: ['https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Raster&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg'],
      tileSize: 256,
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
