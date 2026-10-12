import type { CoachTrigger, MistakeCategory } from '../../shared/coach-types';

export interface CoachNote {
  id: number;
  moveLabel: string; // e.g. "4. Nxe5"
  trigger: CoachTrigger;
  text: string;
  category: MistakeCategory | null;
  error?: boolean;
}

interface Props {
  notes: CoachNote[];
  busy: boolean;
  callsUsed: number;
  callsMax: number;
  canAsk: boolean;
  periodicOn: boolean;
  onAsk: () => void;
  onTogglePeriodic: (on: boolean) => void;
}

const TRIGGER_LABEL: Record<CoachTrigger, string> = {
  swing: 'Eval drop',
  'missed-mate': 'Missed mate',
  periodic: 'Check-in',
  ask: 'You asked',
};

export function CoachPanel({ notes, busy, callsUsed, callsMax, canAsk, periodicOn, onAsk, onTogglePeriodic }: Props) {
  const capped = callsUsed >= callsMax;
  return (
    <section className="coach" aria-label="Coach">
      <div className="coach-head">
        <h2>Coach</h2>
        <span className="coach-count" title="Coach calls this game">
          {callsUsed}/{callsMax}
        </span>
      </div>
      <div className="coach-notes" aria-live="polite">
        {notes.length === 0 && !busy && <p className="empty">The coach speaks up when a move changes the evaluation.</p>}
        {[...notes].reverse().map((n) => (
          <article key={n.id} className={`coach-note${n.error ? ' error' : ''}`}>
            <header>
              <span className="note-move">{n.moveLabel}</span>
              <span className="note-trigger">{TRIGGER_LABEL[n.trigger]}</span>
              {n.category && <span className="note-cat">{n.category}</span>}
            </header>
            <p>{n.text}</p>
          </article>
        ))}
      </div>
      {busy && <p className="coach-busy">Coach is thinking…</p>}
      <div className="coach-actions">
        <button id="ask-coach" onClick={onAsk} disabled={!canAsk || busy || capped}>
          {capped ? 'Coach limit reached' : 'Ask coach'}
        </button>
        <label className="inline">
          <input id="periodic-toggle" type="checkbox" checked={periodicOn} onChange={(e) => onTogglePeriodic(e.target.checked)} />
          Strategic note every few moves
        </label>
      </div>
    </section>
  );
}
