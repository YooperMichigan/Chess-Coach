import { useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { OPENINGS, bookStatus, openingById } from '../openings/book';

interface Props {
  openingId: string | null;
  onChange: (id: string | null) => void;
  myColor: 'white' | 'black';
  history: string[]; // SAN moves so far
  fen: string;
  followBook: boolean;
  onToggleFollow: (on: boolean) => void;
}

const moveLabel = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'} ${san}`;

/** Opening trainer: the book line so far with the idea behind each move, and what comes next. */
export function OpeningPanel({ openingId, onChange, myColor, history, fen, followBook, onToggleFollow }: Props) {
  const opening = openingById(openingId);
  const status = useMemo(
    () => (opening && opening.side === myColor ? bookStatus(opening, history, myColor) : null),
    [opening, history, myColor],
  );
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const board = useMemo(() => new Chess(fen), [fen]);
  const bookEnded = status && !status.leftAt && status.next.length === 0 && history.length > 0;
  const showPlans = status && (status.leftAt || bookEnded);
  const myTurn = status?.nextSide === myColor;

  return (
    <section className="opening" aria-label="Opening trainer">
      <div className="opening-head">
        <h2>Opening trainer</h2>
        <select id="opening-select" value={openingId ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Opening">
          <option value="">No opening</option>
          {OPENINGS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.side === 'white' ? 'White' : 'Black'})
            </option>
          ))}
        </select>
        <label className="inline opening-follow">
          <input id="follow-book" type="checkbox" checked={followBook} onChange={(e) => onToggleFollow(e.target.checked)} />
          Stockfish plays book replies
        </label>
      </div>

      {!opening && <p className="muted">Pick an opening to see the book line and the idea behind each move.</p>}
      {opening && opening.side !== myColor && (
        <p className="muted">
          The {opening.name} is played as {opening.side === 'white' ? 'White' : 'Black'}. Start a new game as{' '}
          {opening.side === 'white' ? 'White' : 'Black'} to practise it.
        </p>
      )}

      {opening && status && (
        <>
          {history.length === 0 && <p className="opening-summary">{opening.summary}</p>}

          {status.played.length > 0 && (
            <ol className="opening-moves" ref={listRef}>
              {status.played.map((m) => (
                <li key={m.ply} className={`${m.side === myColor ? 'mine' : 'theirs'}${m.inBook ? '' : ' off-book'}`}>
                  <span className="opening-move">{moveLabel(m.ply, m.san)}</span>
                  <span className="opening-why">{m.inBook ? m.why : 'Out of book.'}</span>
                </li>
              ))}
            </ol>
          )}

          {status.leftAt && (
            <p className="opening-alert">
              {status.leftAt.by === 'you' ? 'You' : 'Stockfish'} left the book with {moveLabel(status.leftAt.ply, status.leftAt.san)}
              {status.leftAt.bookMoves.length > 0 && <> (the book had {status.leftAt.bookMoves.join(' or ')})</>}.
              {status.leftAt.by === 'opponent' && ' Keep following your set-up below.'}
            </p>
          )}

          {!status.leftAt && status.next.length > 0 && (
            <div className="opening-next">
              <h3>{myTurn ? 'Your book move' : 'Book replies for Stockfish'}</h3>
              <ul>
                {status.next.map((m, i) => (
                  <li key={m.san}>
                    <strong>{moveLabel(history.length, m.san)}</strong>
                    {!myTurn && i === 0 && status.next.length > 1 && <span className="tag">main line</span>} {m.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bookEnded && <p className="opening-alert">End of the prepared line. From here, play the plans below.</p>}

          {showPlans && (
            <div className="opening-plans">
              <h3>Set-up checklist</h3>
              <ul className="checklist">
                {opening.setup.map((item) => {
                  const done = item.done(board);
                  return (
                    <li key={item.label} className={done ? 'done' : ''}>
                      <span aria-hidden="true">{done ? '✓' : '○'}</span> {item.label}
                    </li>
                  );
                })}
              </ul>
              <p>{opening.plans}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
