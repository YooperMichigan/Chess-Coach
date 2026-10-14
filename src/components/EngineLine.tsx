import type { Score } from '../engine/stockfish';
import { formatScore } from '../engine/format';

/** How much of Stockfish's analysis to show during play. Everything is shown once the game ends. */
export type EngineView = 'full' | 'eval' | 'hidden';

interface Props {
  score: Score | null;
  depth: number;
  line: string;
  gameOver: string | null;
  view: EngineView;
  onViewChange: (view: EngineView) => void;
}

export function EngineLine({ score, depth, line, gameOver, view, onViewChange }: Props) {
  // During play, respect the chosen view; after the game everything is visible for review.
  const showEval = gameOver !== null || view !== 'hidden';
  const showLine = gameOver !== null || view === 'full';
  return (
    <div className="engine-line">
      <div className="engine-head">
        <span className="label">Stockfish</span>
        <span className="engine-score">{gameOver ? '—' : !showEval ? 'hidden' : score ? formatScore(score) : '…'}</span>
        {/* Always rendered so the view selector stays right-aligned. */}
        <span className="engine-depth">{!gameOver && showEval && depth > 0 ? `depth ${depth}` : ''}</span>
        <select
          id="engine-view"
          className="engine-view"
          value={view}
          onChange={(e) => onViewChange(e.target.value as EngineView)}
          aria-label="Engine display"
          title="How much of Stockfish's analysis to show while you play. Everything is shown when the game ends."
        >
          <option value="full">Line &amp; eval</option>
          <option value="eval">Eval only</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      <p className={`engine-pv${showLine ? '' : ' muted'}`}>
        {gameOver ?? (showLine ? line || 'Analyzing…' : view === 'eval' ? 'Best line hidden while you play.' : 'Analysis hidden while you play.')}
      </p>
    </div>
  );
}
