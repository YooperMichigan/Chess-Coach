import { Chess } from 'chess.js';
import type { Score } from './stockfish.ts';

/** "+0.34", "-1.20", "M3" (White mates), "-M2" (Black mates). */
export function formatScore(score: Score): string {
  if ('mate' in score) return `${score.mate < 0 ? '-' : ''}M${Math.abs(score.mate)}`;
  const pawns = score.cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

/** White's share of the eval bar, 0-100. Uses a logistic curve so small edges stay visible. */
export function whiteBarPercent(score: Score): number {
  if ('mate' in score) return score.mate > 0 ? 100 : score.mate < 0 ? 0 : 50;
  return 100 / (1 + Math.exp(-0.004 * score.cp));
}

/**
 * Converts a UCI principal variation to numbered SAN, e.g. "12... Nc6 13. Bb5 a6".
 * chess.js validates each move; the line stops at the first move it rejects.
 */
export function pvToSan(fen: string, pv: string[], maxMoves: number): string {
  const board = new Chess(fen);
  const parts: string[] = [];
  for (const uci of pv.slice(0, maxMoves)) {
    const moveNo = board.moveNumber();
    const white = board.turn() === 'w';
    let san: string;
    try {
      san = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      break;
    }
    if (white) parts.push(`${moveNo}. ${san}`);
    else parts.push(parts.length === 0 ? `${moveNo}... ${san}` : san);
  }
  return parts.join(' ');
}
