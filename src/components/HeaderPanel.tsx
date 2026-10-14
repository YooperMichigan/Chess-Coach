import { useEffect, useRef, useState } from 'react';
import type { RatingSummary } from '../../shared/rating';
import { PROVISIONAL_GAMES, START_RATING } from '../../shared/rating';
import { THEMES } from '../themes';

interface Props {
  themeId: string;
  onThemeChange: (id: string) => void;
  rating: RatingSummary | null;
}

const OUTCOME = { win: 'W', loss: 'L', draw: 'D' } as const;

function Change({ value }: { value: number }) {
  if (value === 0) return <span className="rating-change">±0</span>;
  return (
    <span className={`rating-change ${value > 0 ? 'up' : 'down'}`}>
      {value > 0 ? '▲' : '▼'}
      {Math.abs(value)}
    </span>
  );
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/** Top-right panel, as wide as the right column: theme picker, rating, and the last 10 games. */
export function HeaderPanel({ themeId, onThemeChange, rating }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the games list on a click outside it, or on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const games = rating?.games ?? 0;
  const help =
    `Estimated from your finished games against Stockfish, using each strength setting's approximate rating ` +
    `(Skill Level settings are estimates). Starts at ${START_RATING}; larger changes for the first ${PROVISIONAL_GAMES} games. ` +
    `On Stockfish's scale, not an official FIDE or online rating.`;

  return (
    <div className="header-panel" ref={ref}>
      <label className="theme-pick">
        <span>Theme</span>
        <select id="theme-select" value={themeId} onChange={(e) => onThemeChange(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rating-block" title={help}>
        <div className="rating-line">
          <span className="rating-label">Rating</span>
          <span className="rating-value">{rating?.rating ?? START_RATING}</span>
          {rating?.lastChange != null && <Change value={rating.lastChange} />}
        </div>
        <button
          id="games-toggle"
          className="games-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          disabled={games === 0}
        >
          {games === 0 ? 'no games yet' : `${games} game${games === 1 ? '' : 's'}`} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      </div>

      {open && rating && (
        <div className="games-list" role="dialog" aria-label="Last games">
          <div className="games-list-head">
            <strong>Last {rating.recent.length} games</strong>
            {rating.provisional && <span className="games-provisional">provisional until {PROVISIONAL_GAMES} games</span>}
          </div>
          <ol>
            {rating.recent.map((g, i) => (
              <li key={g.gameId ?? i}>
                <span className={`outcome ${g.outcome}`}>{OUTCOME[g.outcome]}</span>
                <Change value={g.change} />
                <span className="games-after">{g.ratingAfter}</span>
                <span className="games-meta">
                  vs {g.engineLabel ?? 'Stockfish'} · {g.myColor === 'white' ? 'White' : 'Black'}
                  {g.playedAt ? ` · ${shortDate(g.playedAt)}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
