import type { Score } from '../engine/stockfish';
import { formatScore, whiteBarPercent } from '../engine/format';

interface Props {
  score: Score | null;
  resultLabel?: string | null; // shown instead of the score once the game is over
  orientation: 'white' | 'black';
  hidden?: boolean; // engine display set to Hidden: show a neutral bar
}

export function EvalBar({ score, resultLabel, orientation, hidden = false }: Props) {
  if (hidden && !resultLabel) score = null;
  const white = score ? whiteBarPercent(score) : 50;
  const label = resultLabel ?? (hidden ? '' : score ? formatScore(score) : '…');
  const whiteAhead = white >= 50;
  return (
    <div
      className={`eval-bar${orientation === 'black' ? ' flipped' : ''}${hidden && !resultLabel ? ' eval-hidden' : ''}`}
      title={hidden && !resultLabel ? 'Evaluation hidden' : `Evaluation ${label}`}
    >
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
