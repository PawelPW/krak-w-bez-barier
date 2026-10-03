import { ATTRS, formatValue } from './attributes';
import type { AttrValue, FeatureKind, StatesByAttr } from './types';

export interface Rule {
  attr: string;
  eq?: AttrValue;
  gt?: number;
  lt?: number;
  in?: AttrValue[];
  unless?: string;
  cost?: number;          // tylko reguły miękkie
}
export interface Profile {
  id: string;
  label: string;
  hard: Rule[];
  soft: Rule[];
  unknown_cost: number;
}
export interface Reason {
  kind: 'hard' | 'soft' | 'unknown';
  attr: string;
  value?: AttrValue;
  text: string;
  cost?: number;
}
export interface Evaluation { blocked: boolean; costMultiplier: number; reasons: Reason[] }
export type Status = 'ok' | 'difficult' | 'blocked' | 'unknown';
export type Values = Record<string, AttrValue | undefined>;
/** Nadpisania progów: klucz `${'hard'|'soft'}:${attr}:${'gt'|'lt'}` → nowy próg. */
export type Overrides = Record<string, number>;

export const DIFFICULT_COST = 2;

function matches(rule: Rule, v: AttrValue): boolean {
  if (rule.eq !== undefined) return v === rule.eq;
  if (rule.gt !== undefined) return typeof v === 'number' && v > rule.gt;
  if (rule.lt !== undefined) return typeof v === 'number' && v < rule.lt;
  if (rule.in !== undefined) return rule.in.includes(v);
  return false;
}

function explain(rule: Rule, v: AttrValue): string {
  const def = ATTRS[rule.attr];
  const unit = def.unit ? ` ${def.unit}` : '';
  if (rule.gt !== undefined) return `${def.label}: ${v}${unit}, twój limit ${rule.gt}${unit}`;
  if (rule.lt !== undefined) return `${def.label}: ${v}${unit}, twoje minimum ${rule.lt}${unit}`;
  return `${def.label}: ${formatValue(rule.attr, v)}`;
}

export function evaluate(profile: Profile, values: Values, kind: FeatureKind): Evaluation {
  const applies = kind === 'segment' ? 'segment' : 'node';
  const reasons: Reason[] = [];
  const unknown = new Set<string>();
  let blocked = false;
  let costMultiplier = 1;

  const check = (rule: Rule, hard: boolean) => {
    const def = ATTRS[rule.attr];
    if (!def || !def.appliesTo.includes(applies)) return;
    const v = values[rule.attr];
    if (v === undefined) {
      if (!def.unknownIsNeutral) unknown.add(rule.attr);
      return;
    }
    if (!matches(rule, v)) return;
    if (rule.unless && values[rule.unless] === true) return;
    if (hard) blocked = true;
    else costMultiplier *= rule.cost ?? 1;
    const reason: Reason = { kind: hard ? 'hard' : 'soft', attr: rule.attr, value: v, text: explain(rule, v) };
    if (!hard) reason.cost = rule.cost ?? 1;
    reasons.push(reason);
  };
  for (const r of profile.hard) check(r, true);
  for (const r of profile.soft) check(r, false);
  for (const attr of unknown) {
    costMultiplier *= profile.unknown_cost;
    reasons.push({ kind: 'unknown', attr, text: `${ATTRS[attr].label}: brak danych` });
  }
  return { blocked, costMultiplier, reasons };
}

export function statusOf(ev: Evaluation): Status {
  if (ev.blocked) return 'blocked';
  if (ev.reasons.some((r) => r.kind === 'soft' && (r.cost ?? 1) >= DIFFICULT_COST)) return 'difficult';
  if (ev.reasons.some((r) => r.kind === 'unknown')) return 'unknown';
  return 'ok';
}

export function valuesFromStates(states: StatesByAttr | undefined): Values {
  const out: Values = {};
  if (states) for (const [attr, s] of Object.entries(states)) out[attr] = s.value;
  return out;
}

export function overrideKey(tier: 'hard' | 'soft', rule: Rule): string | null {
  if (rule.gt !== undefined) return `${tier}:${rule.attr}:gt`;
  if (rule.lt !== undefined) return `${tier}:${rule.attr}:lt`;
  return null;
}

export function mergeOverrides(profile: Profile, overrides: Overrides): Profile {
  const apply = (tier: 'hard' | 'soft') => (rule: Rule): Rule => {
    const key = overrideKey(tier, rule);
    if (!key || overrides[key] === undefined) return rule;
    return rule.gt !== undefined ? { ...rule, gt: overrides[key] } : { ...rule, lt: overrides[key] };
  };
  return { ...profile, hard: profile.hard.map(apply('hard')), soft: profile.soft.map(apply('soft')) };
}
