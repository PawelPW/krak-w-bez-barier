export type AttrValue = string | number | boolean;
export type Source = 'osm' | 'user' | 'ai';
export type FeatureKind = 'segment' | 'crossing' | 'kerb';
export type LonLat = [number, number];

export interface Feature {
  id: string;                 // "way/123#4" | "node/456"
  kind: FeatureKind;
  osmType: 'way' | 'node';
  osmId: number;
  name?: string;
  coords: LonLat[];           // segment: polilinia; węzeł: jeden punkt
  lengthM: number;            // 0 dla węzłów
  from?: string;              // id węzła OSM (segment)
  to?: string;
  nodeId?: string;            // id węzła OSM (crossing, kerb)
  osmTimestamp: string;       // ISO, data ostatniej edycji obiektu
  attrs: Record<string, AttrValue>; // tylko atrybuty obecne w OSM
}

export interface Snapshot {
  generatedAt: string;
  bbox: { south: number; west: number; north: number; east: number };
  features: Feature[];
}

export interface AttributeState {
  value: AttrValue;
  confidence: number;         // 0..1
  lastConfirmed: string;      // ISO
  sources: Source[];
  unconfirmed: boolean;
}

export type StatesByAttr = Record<string, AttributeState>;
export type StatesByFeature = Record<string, StatesByAttr>;
