import { ROUGH_SURFACES } from './attributes';
import type { Profile } from './rules';

const BAD_SMOOTH = ['bad', 'very_bad', 'horrible'];

export const PROFILES: Profile[] = [
  { id: 'wheelchair_manual', label: 'Wózek manualny', unknown_cost: 1.5,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 3 },
      { attr: 'width_cm', lt: 90 },
      { attr: 'temporary_obstacle', eq: true },
    ],
    soft: [
      { attr: 'incline_pct', gt: 6, cost: 5 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 4 },
      { attr: 'smoothness', in: BAD_SMOOTH, cost: 3 },
    ] },
  { id: 'wheelchair_electric', label: 'Wózek elektryczny', unknown_cost: 1.3,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 6 },
      { attr: 'width_cm', lt: 80 },
      { attr: 'temporary_obstacle', eq: true },
    ],
    soft: [
      { attr: 'incline_pct', gt: 10, cost: 3 },
      { attr: 'surface', in: ['cobblestone', 'unhewn_cobblestone', 'sand', 'grass'], cost: 2 },
    ] },
  { id: 'blind', label: 'Osoba niewidoma / słabowidząca', unknown_cost: 1.2,
    hard: [],
    soft: [
      { attr: 'tactile_paving', eq: false, cost: 2 },
      { attr: 'signal_sound', eq: false, cost: 2 },
      { attr: 'open_area', eq: true, cost: 3 },
      { attr: 'guidance_line', eq: true, cost: 0.8 },
      { attr: 'temporary_obstacle', eq: true, cost: 5 },
    ] },
  { id: 'senior', label: 'Senior / chodzik', unknown_cost: 1.2,
    hard: [],
    soft: [
      { attr: 'steps', eq: true, unless: 'handrail', cost: 4 },
      { attr: 'incline_pct', gt: 5, cost: 3 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 4 },
    ] },
  { id: 'stroller', label: 'Wózek dziecięcy', unknown_cost: 1.2,
    hard: [
      { attr: 'steps', eq: true, unless: 'ramp' },
      { attr: 'kerb_height_cm', gt: 10 },
    ],
    soft: [
      { attr: 'kerb_height_cm', gt: 3, cost: 2 },
      { attr: 'surface', in: ROUGH_SURFACES, cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 5 },
    ] },
  { id: 'skates', label: 'Rolki', unknown_cost: 1.5,
    hard: [{ attr: 'steps', eq: true }],
    soft: [
      { attr: 'surface', in: [...ROUGH_SURFACES, 'paving_stones'], cost: 6 },
      { attr: 'smoothness', in: ['intermediate', ...BAD_SMOOTH], cost: 3 },
      { attr: 'temporary_obstacle', eq: true, cost: 4 },
    ] },
  { id: 'bike', label: 'Rower', unknown_cost: 1.1,
    hard: [],
    soft: [
      { attr: 'steps', eq: true, cost: 10 },
      { attr: 'cycleway', eq: false, cost: 1.5 },
      { attr: 'surface', in: ['cobblestone', 'unhewn_cobblestone', 'sett', 'gravel', 'sand'], cost: 2 },
      { attr: 'temporary_obstacle', eq: true, cost: 3 },
    ] },
];

export const profileById = (id: string): Profile => PROFILES.find((p) => p.id === id) ?? PROFILES[0];
