import { useEffect, useRef, useState } from 'react';
import { PROFILES, overrideKey, profileById } from '@kbg/domain';
import type { Rule } from '@kbg/domain';
import { useApp } from '../state';

const RANGE: Record<string, { min: number; max: number; step: number; unit: string }> = {
  kerb_height_cm: { min: 0, max: 15, step: 1, unit: 'cm' },
  width_cm: { min: 60, max: 150, step: 5, unit: 'cm' },
  incline_pct: { min: 0, max: 15, step: 1, unit: '%' },
};

function sliderLabel(attr: string, tier: 'hard' | 'soft', both: boolean): string {
  if (attr === 'kerb_height_cm') return tier === 'soft' ? 'Najwyższy krawężnik, który mi przeszkadza' : both ? 'Najwyższy krawężnik, który mnie zatrzyma' : 'Najwyższy krawężnik, który pokonam';
  if (attr === 'width_cm') return 'Najwęższe przejście, przez które przejadę';
  return tier === 'hard' ? 'Największe nachylenie, którego nie pokonam' : 'Największe nachylenie, które jest dla mnie wygodne';
}

function Slider({ id, label, unit, min, max, step, value, onCommit }: { id: string; label: string; unit: string; min: number; max: number; step: number; value: number; onCommit(v: number): void }) {
  const [v, setV] = useState(value);
  const timer = useRef<number>();
  useEffect(() => setV(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="slider">
      <label htmlFor={id}>{label}: <strong>{v} {unit}</strong></label>
      <input id={id} type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onCommit(n), 200); // mapa przekolorowuje się po krótkiej pauzie
        }} />
    </div>
  );
}

export function ProfileView() {
  const { choice, setChoice } = useApp();
  const base = profileById(choice.id);
  const rows: { tier: 'hard' | 'soft'; rule: Rule; key: string; both: boolean }[] = [];
  for (const tier of ['hard', 'soft'] as const) {
    for (const rule of base[tier]) {
      const key = overrideKey(tier, rule);
      if (!key || !RANGE[rule.attr]) continue;
      const both = base.hard.concat(base.soft).filter((r) => r.attr === rule.attr && (r.gt !== undefined || r.lt !== undefined)).length > 1;
      rows.push({ tier, rule, key, both });
    }
  }
  return (
    <>
      <h1>Twój profil</h1>
      <fieldset className="radios">
        <legend>Jak się poruszasz?</legend>
        {PROFILES.map((p) => (
          <label key={p.id}>
            <input type="radio" name="profile" checked={choice.id === p.id} onChange={() => setChoice({ id: p.id, overrides: {} })} /> {p.label}
          </label>
        ))}
      </fieldset>
      {rows.length > 0 && (
        <section aria-labelledby="thr">
          <h2 id="thr">Twoje progi</h2>
          {rows.map(({ tier, rule, key, both }) => {
            const r = RANGE[rule.attr];
            const def = rule.gt ?? rule.lt ?? 0;
            return (
              <Slider key={`${choice.id}:${key}`} id={`thr-${key.replace(/:/g, '-')}`} label={sliderLabel(rule.attr, tier, both)} unit={r.unit}
                min={r.min} max={r.max} step={r.step} value={choice.overrides[key] ?? def}
                onCommit={(n) => setChoice({ id: choice.id, overrides: { ...choice.overrides, [key]: n } })} />
            );
          })}
          <button type="button" className="btn" onClick={() => setChoice({ id: choice.id, overrides: {} })}>Przywróć domyślne progi</button>
        </section>
      )}
      <p>Profil jest zapisany tylko na tym urządzeniu. Wysyłamy go wyłącznie przy wyznaczaniu trasy i nie zapisujemy na serwerze.</p>
    </>
  );
}
