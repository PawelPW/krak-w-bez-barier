import type { AttrValue } from './types';

export type AppliesTo = 'segment' | 'node';
export interface AttrDef {
  label: string;
  type: 'bool' | 'number' | 'enum';
  unit?: string;
  options?: Record<string, string>;        // enum: wartość → etykieta PL
  appliesTo: AppliesTo[];
  barrier: (v: AttrValue) => boolean;      // czy wartość oznacza barierę
  unknownIsNeutral?: boolean;              // brak danych nie podnosi kosztu
  reportable?: boolean;                    // widoczny w formularzu zgłoszenia
}

const SURFACES: Record<string, string> = {
  asphalt: 'asfalt', concrete: 'beton', paving_stones: 'kostka betonowa',
  sett: 'kostka granitowa', cobblestone: 'bruk', unhewn_cobblestone: 'kocie łby',
  'concrete:plates': 'płyty betonowe', gravel: 'żwir', fine_gravel: 'szuter',
  compacted: 'utwardzona', ground: 'ziemia', grass: 'trawa', sand: 'piasek',
  pebblestone: 'otoczaki', wood: 'drewno', metal: 'metal',
};
export const ROUGH_SURFACES = ['sett', 'cobblestone', 'unhewn_cobblestone', 'gravel', 'pebblestone', 'ground', 'grass', 'sand'];
const SMOOTHNESS: Record<string, string> = {
  excellent: 'doskonała', good: 'dobra', intermediate: 'średnia',
  bad: 'zła', very_bad: 'bardzo zła', horrible: 'fatalna',
};
const yes = (v: AttrValue) => v === true;
const no = (v: AttrValue) => v === false;

// unknownIsNeutral: atrybut prawie nieobecny w OSM; brak danych widać na karcie, ale nie podnosi kosztu ani nie zmienia statusu.
export const ATTRS: Record<string, AttrDef> = {
  surface: { label: 'Nawierzchnia', type: 'enum', options: SURFACES, appliesTo: ['segment'], barrier: (v) => ROUGH_SURFACES.includes(String(v)), reportable: true },
  smoothness: { label: 'Gładkość', type: 'enum', options: SMOOTHNESS, appliesTo: ['segment'], barrier: (v) => ['bad', 'very_bad', 'horrible'].includes(String(v)), unknownIsNeutral: true, reportable: true },
  width_cm: { label: 'Szerokość', type: 'number', unit: 'cm', appliesTo: ['segment'], barrier: (v) => Number(v) < 90, unknownIsNeutral: true, reportable: true },
  incline_pct: { label: 'Nachylenie', type: 'number', unit: '%', appliesTo: ['segment'], barrier: (v) => Number(v) > 6, unknownIsNeutral: true, reportable: true },
  kerb_height_cm: { label: 'Wysokość krawężnika', type: 'number', unit: 'cm', appliesTo: ['node'], barrier: (v) => Number(v) > 3, reportable: true },
  steps: { label: 'Schody', type: 'bool', appliesTo: ['segment'], barrier: yes, reportable: true },
  ramp: { label: 'Podjazd', type: 'bool', appliesTo: ['segment'], barrier: no, reportable: true },
  handrail: { label: 'Poręcz', type: 'bool', appliesTo: ['segment'], barrier: no, reportable: true },
  tactile_paving: { label: 'Pola uwagi', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  guidance_line: { label: 'Linia prowadząca', type: 'bool', appliesTo: ['segment'], barrier: no, unknownIsNeutral: true, reportable: true },
  signal_sound: { label: 'Sygnał dźwiękowy', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  signal_vibration: { label: 'Sygnał wibracyjny', type: 'bool', appliesTo: ['node'], barrier: no, reportable: true },
  lit: { label: 'Oświetlenie', type: 'bool', appliesTo: ['segment', 'node'], barrier: no, reportable: true },
  bench: { label: 'Ławka', type: 'bool', appliesTo: ['segment'], barrier: no, unknownIsNeutral: true, reportable: true },
  cycleway: { label: 'Droga rowerowa', type: 'bool', appliesTo: ['segment'], barrier: () => false },
  open_area: { label: 'Otwarty plac', type: 'bool', appliesTo: ['segment'], barrier: yes },
  temporary_obstacle: { label: 'Przeszkoda tymczasowa', type: 'bool', appliesTo: ['segment', 'node'], barrier: yes, unknownIsNeutral: true, reportable: true },
};

export function isBarrier(attr: string, value: AttrValue): boolean {
  return ATTRS[attr]?.barrier(value) ?? false;
}

export function formatValue(attr: string, value: AttrValue): string {
  const def = ATTRS[attr];
  if (!def) return String(value);
  if (def.type === 'bool') return value ? 'jest' : 'nie ma';
  if (def.type === 'number') return `${value} ${def.unit ?? ''}`.trim();
  return def.options?.[String(value)] ?? String(value);
}

export function isValidValue(attr: string, value: unknown): value is AttrValue {
  const def = ATTRS[attr];
  if (!def) return false;
  if (def.type === 'bool') return typeof value === 'boolean';
  if (def.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10000;
  return typeof value === 'string' && value in (def.options ?? {});
}
