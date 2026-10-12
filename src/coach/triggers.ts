import type { CoachTrigger, PlayerScore } from '../../shared/coach-types.ts';
import type { Score } from '../engine/stockfish.ts';

/** Converts a White-view engine score to the player's point of view. */
export function toPlayerScore(score: Score, color: 'white' | 'black'): PlayerScore {
  const sign = color === 'white' ? 1 : -1;
  return 'mate' in score ? { mate: sign * score.mate } : { cp: sign * score.cp };
}

/** Centipawn-like number for comparing scores. Mates sort beyond any material edge. */
export function comparableCp(s: PlayerScore): number {
  if ('cp' in s) return s.cp;
  return Math.sign(s.mate) * (10_000 - Math.abs(s.mate));
}

/** Decides whether the player's last move deserves an automatic coach comment. */
export function detectTrigger(
  before: PlayerScore | null,
  after: PlayerScore | null,
  opts: { thresholdCp: number; periodicDue: boolean },
): CoachTrigger | null {
  if (before && after) {
    const hadMate = 'mate' in before && before.mate > 0;
    const keptMate = 'mate' in after && after.mate > 0;
    if (hadMate && !keptMate) return 'missed-mate';
    if (comparableCp(before) - comparableCp(after) > opts.thresholdCp) return 'swing';
  }
  return opts.periodicDue ? 'periodic' : null;
}

/** "4. Nxe5" style numbering for a slice of SAN history starting at ply index `startPly`. */
export function numberMoves(history: string[], startPly: number): string {
  const parts: string[] = [];
  history.forEach((san, i) => {
    const ply = startPly + i;
    const moveNo = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${moveNo}. ${san}`);
    else parts.push(i === 0 ? `${moveNo}... ${san}` : san);
  });
  return parts.join(' ');
}
