import type { Score } from '../engine/stockfish';
import { formatScore } from '../engine/format';

interface Props {
  score: Score | null;
  depth: number;
  line: string;
  gameOver: string | null;
}

export function EngineLine({ score, depth, line, gameOver }: Props) {
  return (
    <div className="engine-line">
      <div className="engine-head">
        <span className="label">Stockfish</span>
        <span className="engine-score">{gameOver ? '—' : score ? formatScore(score) : '…'}</span>
        {!gameOver && depth > 0 && <span className="engine-depth">depth {depth}</span>}
      </div>
      <p className="engine-pv">{gameOver ?? (line || 'Analyzing…')}</p>
    </div>
  );
}
