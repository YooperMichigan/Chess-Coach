import { useEffect, useState } from 'react';
import type { MistakeSummary, UsageSummary } from '../../shared/coach-types';
import { fetchMistakeSummary, fetchUsage, formatUsd } from '../coach/api';

interface Props {
  lastN: number;
  refreshKey: number; // bump to reload after a game is saved or a coach call is made
  saveNote: string | null; // e.g. "Game saved." or an error
}

/** Saved-game count and the most common mistake types over your last N games. */
export function HistoryPanel({ lastN, refreshKey, saveNote }: Props) {
  const [summary, setSummary] = useState<MistakeSummary | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMistakeSummary(lastN), fetchUsage()])
      .then(([s, u]) => {
        if (cancelled) return;
        setSummary(s);
        setUsage(u);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [lastN, refreshKey]);

  return (
    <section className="history" aria-label="Your history">
      <div className="history-head">
        <h2>Your history</h2>
        {summary && (
          <span className="history-count">
            {summary.gamesSaved} game{summary.gamesSaved === 1 ? '' : 's'} saved
          </span>
        )}
      </div>
      {usage && (
        <p className="spend" title={`${usage.calls} coach call${usage.calls === 1 ? '' : 's'} recorded. Estimated from token counts; check the Claude Console for billed amounts.`}>
          Spent in app: <strong>{formatUsd(usage.totalUsd)}</strong> total · {formatUsd(usage.monthUsd)} this month
        </p>
      )}
      {saveNote && <p className="save-note">{saveNote}</p>}
      {error && <p className="history-error">{error}</p>}
      {summary && summary.gamesSaved === 0 && <p className="empty">Finished games are saved here automatically.</p>}
      {summary && summary.gamesSaved > 0 && (
        <>
          <p className="history-sub">
            Most common mistakes, last {summary.lastN} game{summary.lastN === 1 ? '' : 's'}:
          </p>
          {summary.categories.length === 0 ? (
            <p className="empty">No tagged mistakes yet.</p>
          ) : (
            <ul className="history-cats">
              {summary.categories.map((c) => (
                <li key={c.category}>
                  <span className="note-cat">{c.category}</span>
                  <span className="cat-count">×{c.count}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.patterns.length > 0 && (
            <>
              <p className="history-sub">Patterns behind them:</p>
              <ul className="history-cats">
                {summary.patterns.map((p) => (
                  <li key={p.pattern}>
                    <span className="note-pattern">{p.pattern}</span>
                    <span className="cat-count">×{p.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {summary.uncategorized > 0 && (
            <p className="history-sub">
              Plus {summary.uncategorized} mistake{summary.uncategorized === 1 ? '' : 's'} the coach didn't tag.
            </p>
          )}
        </>
      )}
    </section>
  );
}
