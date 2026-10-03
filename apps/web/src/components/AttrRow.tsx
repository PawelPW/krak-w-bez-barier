import { useRef, useState } from 'react';
import { ATTRS, formatValue } from '@kbg/domain';
import type { AttributeState, Source } from '@kbg/domain';
import type { ObservationView } from '../api';
import { formatDate } from '../status';

const SOURCE_LABEL: Record<Source, string> = { osm: 'OpenStreetMap', user: 'użytkownik', ai: 'AI ze zdjęcia' };

interface Props {
  attr: string;
  state?: AttributeState;
  observations: ObservationView[];
  onVerify(obsId: string, agree: boolean): Promise<void> | void;
  /** Wygasłe zgłoszenie: `still` = nadal aktualne (ta sama wartość) albo już nieaktualne (wartość przeciwna). */
  onRenew(obs: ObservationView, still: boolean): void;
}

const newest = (list: ObservationView[]) => [...list].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

/** Przyciski głosowania; zajęte do końca żądania, żeby podwójne dotknięcie nie wysłało dwóch głosów. */
function VoteButtons({ obsId, name, onVerify }: { obsId: string; name: string; onVerify: Props['onVerify'] }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const vote = async (agree: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await onVerify(obsId, agree); }
    finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="attr-actions">
      <button type="button" className="btn" disabled={busy} aria-label={`Potwierdzam: ${name}`} onClick={() => vote(true)}>Potwierdzam</button>
      <button type="button" className="btn" disabled={busy} aria-label={`Nieprawda: ${name}`} onClick={() => vote(false)}>Nieprawda</button>
    </div>
  );
}

export function AttrRow({ attr, state, observations, onVerify, onRenew }: Props) {
  const def = ATTRS[attr];
  const mine = observations.filter((o) => o.attr === attr);
  const current = state ? newest(mine.filter((o) => !o.expired && !o.superseded && o.value === state.value)) : undefined;
  const expired = newest(mine.filter((o) => o.expired));
  const canVote = current && !current.mine && current.myVote === null;
  // Konkurencyjne zgłoszenia: inne wartości niż aktualny stan, najnowsze na (źródło, wartość, „moje”), max 3.
  const rivals: ObservationView[] = [];
  if (state) {
    const seen = new Set<string>();
    for (const o of [...mine].sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
      if (o.expired || o.superseded || o.value === state.value) continue;
      const key = `${o.source}|${o.mine}|${JSON.stringify(o.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rivals.push(o);
      if (rivals.length === 3) break;
    }
  }

  let kind: 'known' | 'unknown' = 'unknown';
  let text = 'brak danych';
  let icon = '?';
  if (state) {
    text = formatValue(attr, state.value);
    kind = 'known';
    icon = '●'; // znana wartość: neutralny znak, bez sugestii „dobrze/źle”; o tym mówi werdykt profilu
  }
  const pct = state ? Math.round(state.confidence * 100) : 0;
  const voteName = state ? `${def.label} ${text}` : def.label;

  return (
    <li className={`attr attr-${kind}`}>
      <div className="attr-head">
        <span className="attr-label">{def.label}</span>
        <span className={`attr-state state-${kind}`}>
          <span className="state-icon" aria-hidden="true">{icon}</span>{text}
        </span>
      </div>
      {state && (
        <div className="attr-meta">
          <span>Źródło: {state.sources.map((s) => SOURCE_LABEL[s]).join(', ')}</span>
          <span>Ostatnie potwierdzenie: {formatDate(state.lastConfirmed)}</span>
          <span className="conf">
            <meter min={0} max={1} value={state.confidence} aria-label={`Pewność ${def.label}`} />
            <span>pewność {pct}%</span>
          </span>
        </div>
      )}
      {state?.unconfirmed && (
        <p className="attr-warn"><span className="badge">niepotwierdzone</span> To nie jest zapewnienie dostępności.</p>
      )}
      {canVote && <VoteButtons obsId={current.id} name={voteName} onVerify={onVerify} />}
      {rivals.length > 0 && (
        <ul className="attr-rivals">
          {rivals.map((o) => {
            const val = formatValue(attr, o.value);
            return (
              <li key={o.id}>
                <p>Zgłoszono inaczej: {val} ({SOURCE_LABEL[o.source]}, {formatDate(o.observedAt)})</p>
                {o.mine ? <p className="rival-wait">Twoje zgłoszenie — czeka na potwierdzenie</p>
                  : o.myVote === null && <VoteButtons obsId={o.id} name={`${def.label} ${val}`} onVerify={onVerify} />}
              </li>
            );
          })}
        </ul>
      )}
      {expired && !mine.some((o) => !o.expired) && (
        <>
          <p className="attr-warn">Zgłoszenie wygasło {formatDate(expired.validUntil ?? expired.observedAt)}. Czy nadal aktualne?</p>
          <div className="attr-actions">
            <button type="button" className="btn" aria-label={`Nadal aktualne: ${def.label} ${formatValue(attr, expired.value)}`} onClick={() => onRenew(expired, true)}>Nadal aktualne</button>
            {def.type === 'bool' && <button type="button" className="btn" aria-label={`Już nieaktualne: ${def.label} ${formatValue(attr, expired.value)}`} onClick={() => onRenew(expired, false)}>Już nieaktualne</button>}
          </div>
        </>
      )}
    </li>
  );
}
