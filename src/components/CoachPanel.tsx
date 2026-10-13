import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HintLevel, MistakeCategory, PatternTag } from '../../shared/coach-types';
import { formatUsd } from '../coach/api';
import { CoachingBrief } from './CoachingBrief';

export interface CoachNote {
  id: number;
  from: 'coach' | 'you' | 'error';
  label: string; // e.g. "4. Nxe5 · Eval drop", "Hint 2/3", "You"
  text: string;
  category?: MistakeCategory | null;
  pattern?: PatternTag | null;
}

interface Props {
  notes: CoachNote[];
  status: string | null; // e.g. "Coach is thinking…"
  callsUsed: number;
  callsMax: number;
  gameCostUsd: number;
  canAsk: boolean;
  onAsk: () => void;
  nextHint: HintLevel | null; // null = no hint available now
  hintEnabled: boolean;
  onHint: () => void;
  chatEnabled: boolean;
  onSend: (question: string) => void;
  periodicOn: boolean;
  onTogglePeriodic: (on: boolean) => void;
  keyMomentsOn: boolean;
  onToggleKeyMoments: (on: boolean) => void;
}

const HINT_LABEL: Record<HintLevel, string> = { 1: 'Hint: nudge', 2: 'Hint: where to look', 3: 'Hint: show move' };

export function CoachPanel(p: Props) {
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const capped = p.callsUsed >= p.callsMax;

  // Keep the newest message in view.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.notes.length, p.status]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || !p.chatEnabled || capped) return;
    p.onSend(q);
    setDraft('');
  }

  return (
    <section className="coach" aria-label="Coach">
      <div className="coach-head">
        <h2>Coach</h2>
        <span className="coach-count" title="Coach calls and estimated API cost for this game">
          {formatUsd(p.gameCostUsd)} this game · {p.callsUsed}/{p.callsMax} calls
        </span>
      </div>
      <div className="coach-notes" ref={feedRef} aria-live="polite">
        {p.notes.length === 0 && !p.status && (
          <p className="empty">The coach speaks up when a move changes the evaluation. Ask a question or press Hint any time.</p>
        )}
        {p.notes.map((n) => (
          <article key={n.id} className={`coach-note from-${n.from}`}>
            <header>
              <span className="note-label">{n.label}</span>
              {n.category && <span className="note-cat">{n.category}</span>}
              {n.pattern && <span className="note-pattern">{n.pattern}</span>}
            </header>
            <p>{n.text}</p>
          </article>
        ))}
        {p.status && <p className="coach-busy">{p.status}</p>}
      </div>

      <form className="coach-chat" onSubmit={submit}>
        <input
          id="coach-chat-input"
          type="text"
          placeholder={capped ? 'Coach limit reached for this game' : 'Ask the coach…'}
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          disabled={capped}
          aria-label="Ask the coach a question"
        />
        <button type="submit" disabled={!p.chatEnabled || capped || !draft.trim()}>
          Send
        </button>
      </form>

      <div className="coach-actions">
        <button id="hint-button" onClick={p.onHint} disabled={!p.hintEnabled || capped || p.nextHint === null}>
          {p.nextHint ? HINT_LABEL[p.nextHint] : 'No more hints'}
        </button>
        <button id="ask-coach" onClick={p.onAsk} disabled={!p.canAsk || capped}>
          Ask coach
        </button>
      </div>
      <label className="inline">
        <input id="periodic-toggle" type="checkbox" checked={p.periodicOn} onChange={(e) => p.onTogglePeriodic(e.target.checked)} />
        Strategic note every few moves
      </label>
      <label className="inline">
        <input id="key-moments-toggle" type="checkbox" checked={p.keyMomentsOn} onChange={(e) => p.onToggleKeyMoments(e.target.checked)} />
        Comment on key moments (castling, trades, pawn breaks)
      </label>
      <CoachingBrief />
    </section>
  );
}
