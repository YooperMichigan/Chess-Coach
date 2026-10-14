import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import type { GameReview, PlayerScore } from '../../shared/coach-types';
import { formatScore } from '../engine/format';
import { formatUsd } from '../coach/api';

export type ReviewState =
  | { kind: 'idle' }
  | { kind: 'analyzing'; done: number; total: number }
  | { kind: 'asking' }
  | { kind: 'done'; review: GameReview }
  | { kind: 'error'; message: string };

const MY_MOVE_COLOR = 'rgba(192, 57, 43, 0.85)';
const BEST_MOVE_COLOR = 'rgba(46, 139, 87, 0.85)';

function evalText(s: PlayerScore | null): string {
  return s ? formatScore(s) : '?';
}

/** The finished review: one card per critical moment, then the summary and what to work on. */
export function ReviewPanel({
  state,
  orientation,
  boardOptions,
}: {
  state: ReviewState;
  orientation: 'white' | 'black';
  boardOptions?: ChessboardOptions; // theme colours for the small boards
}) {
  if (state.kind === 'idle') return null;
  return (
    <section className="review" id="review" aria-label="Game review">
      <h2>Game review</h2>
      {state.kind === 'analyzing' && (
        <p className="review-status">
          Stockfish is checking every move… {state.done}/{state.total} positions
        </p>
      )}
      {state.kind === 'asking' && <p className="review-status">Opus is writing the review…</p>}
      {state.kind === 'error' && <p className="review-error">{state.message}</p>}
      {state.kind === 'done' && (
        <>
          <p className="review-summary">{state.review.summary}</p>
          {state.review.moments.length === 0 ? (
            <p className="review-status">Stockfish found no significant mistakes in your moves this game.</p>
          ) : (
            <ol className="review-moments">
              {state.review.moments.map((m, i) => {
                const arrows = [{ startSquare: m.myMoveUci.slice(0, 2), endSquare: m.myMoveUci.slice(2, 4), color: MY_MOVE_COLOR }];
                if (m.bestMoveUci && m.bestMoveUci !== m.myMoveUci) {
                  arrows.push({ startSquare: m.bestMoveUci.slice(0, 2), endSquare: m.bestMoveUci.slice(2, 4), color: BEST_MOVE_COLOR });
                }
                const dots = m.fen.split(' ')[1] === 'w' ? '.' : '...';
                return (
                  <li key={m.ply} className="review-moment">
                    <div className="review-board">
                      <Chessboard
                        options={{
                          ...boardOptions,
                          id: `review-${i}`,
                          position: m.fen,
                          boardOrientation: orientation,
                          allowDragging: false,
                          allowDrawingArrows: false,
                          showAnimations: false,
                          arrows,
                        }}
                      />
                    </div>
                    <div className="review-text">
                      <header>
                        <span className="note-label">
                          {m.moveNumber}
                          {dots} {m.myMove}
                        </span>
                        <span className="review-eval">
                          {evalText(m.evalBefore)} → {evalText(m.evalAfter)}
                        </span>
                        {m.category && <span className="note-cat">{m.category}</span>}
                        {m.pattern && <span className="note-pattern">{m.pattern}</span>}
                      </header>
                      <p>{m.explanation}</p>
                      {m.bestMove && m.bestMove !== m.myMove && (
                        <p className="review-best">
                          <span className="swatch best" /> Stockfish preferred <strong>{m.bestMove}</strong>
                          {m.bestLine && <span className="review-line"> ({m.bestLine})</span>}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="review-wrap">
            <h3>Recurring weaknesses</h3>
            <p>{state.review.recurring}</p>
            <h3>Focus for your next game</h3>
            <p>{state.review.focus}</p>
            <p className="review-cost">
              {state.review.costUsd > 0 ? `Review cost: ${formatUsd(state.review.costUsd)}` : 'Saved review (no new cost).'}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
