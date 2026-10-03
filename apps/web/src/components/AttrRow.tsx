import { ATTRS, formatValue } from '@kbg/domain';
import type { AttributeState, Source } from '@kbg/domain';
import type { ObservationView } from '../api';
import { formatDate } from '../status';

const SOURCE_LABEL: Record<Source, string> = { osm: 'OpenStreetMap', user: 'użytkownik', ai: 'AI ze zdjęcia' };

interface Props {
  attr: string;
  state?: AttributeState;
  observations: ObservationView[];
  onVerify(obsId: string, agree: boolean): void;
}

const newest = (list: ObservationView[]) => [...list].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

export function AttrRow({ attr, state, observations, onVerify }: Props) {
  const def = ATTRS[attr];
  const mine = observations.filter((o) => o.attr === attr);
  const current = state ? newest(mine.filter((o) => !o.expired && o.value === state.value)) : undefined;
  const expired = newest(mine.filter((o) => o.expired));
  const canVote = current && !current.mine && current.myVote === null;

  let kind: 'present' | 'absent' | 'unknown' = 'unknown';
  let text = 'brak danych';
  let icon = '?';
  if (state) {
    text = formatValue(attr, state.value);
    const isNo = def.type === 'bool' && state.value === false;
    kind = isNo ? 'absent' : 'present';
    icon = isNo ? '✕' : '✓';
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
      {canVote && (
        <div className="attr-actions">
          <button type="button" className="btn" aria-label={`Potwierdzam: ${voteName}`} onClick={() => onVerify(current.id, true)}>Potwierdzam</button>
          <button type="button" className="btn" aria-label={`Nieprawda: ${voteName}`} onClick={() => onVerify(current.id, false)}>Nieprawda</button>
        </div>
      )}
      {expired && <p className="attr-warn">Zgłoszenie wygasło {formatDate(expired.validUntil ?? expired.observedAt)}. Czy nadal aktualne?</p>}
    </li>
  );
}
