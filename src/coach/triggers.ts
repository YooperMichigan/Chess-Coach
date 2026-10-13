import { Chess } from 'chess.js';
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
  opts: { thresholdCp: number; periodicDue: boolean; keyMoment?: boolean },
): CoachTrigger | null {
  if (before && after) {
    const hadMate = 'mate' in before && before.mate > 0;
    const keptMate = 'mate' in after && after.mate > 0;
    if (hadMate && !keptMate) return 'missed-mate';
    if (comparableCp(before) - comparableCp(after) > opts.thresholdCp) return 'swing';
  }
  if (opts.keyMoment) return 'key-moment';
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

const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/**
 * A structure-defining moment in the player's move, read from the board only (no evaluation):
 * castling, capturing a minor or major piece (a trade), or a pawn break (a pawn capture, or a
 * pawn move that comes into contact with an enemy pawn). Returns a short description, or null.
 */
export function detectKeyMoment(fenBefore: string, uci: string): string | null {
  const board = new Chess(fenBefore);
  let move;
  try {
    move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  if (move.isKingsideCastle()) return 'you castled kingside';
  if (move.isQueensideCastle()) return 'you castled queenside';
  if (move.captured && 'nbrq'.includes(move.captured)) {
    return `you captured a ${PIECE_NAMES[move.captured]} with your ${PIECE_NAMES[move.piece]} (${move.san}): a trade changes the structure and the plans`;
  }
  if (move.piece === 'p') {
    if (move.captured === 'p') return `pawn break: you exchanged pawns with ${move.san}, opening lines`;
    // Contact with an enemy pawn: the pawn now attacks one diagonally, or is attacked by one.
    const file = move.to.charCodeAt(0);
    const rank = Number(move.to[1]);
    const dir = move.color === 'w' ? 1 : -1;
    const enemyPawnAt = (f: number, r: number) => {
      if (f < 97 || f > 104 || r < 1 || r > 8) return false;
      const p = board.get(`${String.fromCharCode(f)}${r}` as Parameters<Chess['get']>[0]);
      return p?.type === 'p' && p.color !== move.color;
    };
    const contact =
      enemyPawnAt(file - 1, rank + dir) || enemyPawnAt(file + 1, rank + dir) ||
      enemyPawnAt(file - 1, rank - dir) || enemyPawnAt(file + 1, rank - dir);
    if (contact) return `pawn break: ${move.san} puts your pawn in contact with an enemy pawn`;
  }
  return null;
}
