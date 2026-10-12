import type { Score } from '../engine/stockfish';
import { formatScore, whiteBarPercent } from '../engine/format';

interface Props {
  score: Score | null;
  resultLabel?: string | null; // shown instead of the score once the game is over
  orientation: 'white' | 'black';
}

export function EvalBar({ score, resultLabel, orientation }: Props) {
  const white = score ? whiteBarPercent(score) : 50;
  const label = resultLabel ?? (score ? formatScore(score) : '…');
  const whiteAhead = white >= 50;
  return (
    <div className={`eval-bar${orientation === 'black' ? ' flipped' : ''}`} title={`Evaluation ${label}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
