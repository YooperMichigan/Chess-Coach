import { Chess } from 'chess.js';
import type { CriticalMoment, PlayerScore } from '../../shared/coach-types.ts';
import type { AnalysisInfo } from '../engine/stockfish.ts';
import { pvToSan } from '../engine/format.ts';
import { toPlayerScore } from '../coach/triggers.ts';

export interface PassOptions {
  pgnMoves: string[]; // the game's SAN history
  myColor: 'white' | 'black';
  depth: number; // minimum depth; cached analyses at least this deep are reused
  cached: (fen: string) => AnalysisInfo | undefined;
  analyze: (fen: string) => Promise<AnalysisInfo | null>; // null = cancelled
  onProgress?: (done: number, total: number) => void;
  bestLineLength: number;
}

interface Candidate extends CriticalMoment {
  drop: number; // winning chances lost, 0-2 (see winningChances)
}

/**
 * The player's winning chances from -1 (lost) to +1 (won), using the curve Lichess uses for
 * move classification. Ranking by this instead of raw centipawns means a 10-pawn swing in an
 * already-lost position counts for little, while hanging a queen in a level game counts a lot.
 */
export function winningChances(s: PlayerScore): number {
  if ('mate' in s) return s.mate > 0 ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, s.cp));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

/** Score after a move that ended the game: no engine search is possible there. */
function terminalScore(fen: string, myColor: 'white' | 'black'): PlayerScore | null {
  const g = new Chess(fen);
  if (g.isCheckmate()) {
    // The side to move is mated; if that is the player's opponent, the player delivered mate.
    const playerMated = g.turn() === myColor[0];
    return { mate: playerMated ? -1 : 1 };
  }
  if (g.isDraw()) return { cp: 0 };
  return null;
}

function uciToSan(fen: string, uci: string | undefined): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

/**
 * Stockfish pass over every one of the player's moves. Returns every move with its eval drop,
 * or null if the pass was cancelled (for example by starting a new game).
 */
export async function analyzePlayerMoves(o: PassOptions): Promise<Candidate[] | null> {
  const replay = new Chess();
  const moves = o.pgnMoves.map((san) => replay.move(san));
  const mine = moves.map((m, ply) => ({ m, ply })).filter(({ m }) => m.color === o.myColor[0]);

  // Every position needed, deduplicated, in game order.
  const fens: string[] = [];
  for (const { m } of mine) for (const f of [m.before, m.after]) if (!fens.includes(f)) fens.push(f);

  const results = new Map<string, AnalysisInfo>();
  let done = 0;
  for (const fen of fens) {
    o.onProgress?.(done, fens.length);
    if (new Chess(fen).isGameOver()) {
      done++;
      continue;
    }
    const hit = o.cached(fen);
    if (hit && hit.depth >= o.depth) {
      results.set(fen, hit);
    } else {
      const fresh = await o.analyze(fen);
      if (!fresh) return null;
      results.set(fen, fresh);
    }
    done++;
  }
  o.onProgress?.(fens.length, fens.length);

  return mine.map(({ m, ply }) => {
    const before = results.get(m.before);
    const after = results.get(m.after);
    const evalBefore = before ? toPlayerScore(before.score, o.myColor) : null;
    const evalAfter = after ? toPlayerScore(after.score, o.myColor) : terminalScore(m.after, o.myColor);
    const drop = evalBefore && evalAfter ? winningChances(evalBefore) - winningChances(evalAfter) : 0;
    return {
      ply,
      moveNumber: Math.floor(ply / 2) + 1,
      fen: m.before,
      myMove: m.san,
      myMoveUci: m.lan,
      bestMove: uciToSan(m.before, before?.pv[0]),
      bestMoveUci: before?.pv[0] ?? null,
      bestLine: before ? pvToSan(m.before, before.pv, o.bestLineLength) : '',
      replyLine: after ? pvToSan(m.after, after.pv, o.bestLineLength) : '',
      evalBefore,
      evalAfter,
      drop,
    };
  });
}

/**
 * The 3-5 largest swings: up to `max` moves that lost at least `minDrop` winning chances
 * (0.2 = a mistake on Lichess's scale), topped up to `min` with inaccuracies (at least
 * `floorDrop`) when the game had few mistakes. Returned largest first, without `drop`.
 */
export function pickCriticalMoments(
  candidates: Candidate[],
  opts = { min: 3, max: 5, minDrop: 0.2, floorDrop: 0.1 },
): CriticalMoment[] {
  const sorted = [...candidates].sort((a, b) => b.drop - a.drop);
  const picked = sorted.filter((c) => c.drop >= opts.minDrop).slice(0, opts.max);
  for (const c of sorted) {
    if (picked.length >= opts.min) break;
    if (!picked.includes(c) && c.drop >= opts.floorDrop) picked.push(c);
  }
  return picked.map(({ drop: _drop, ...moment }) => moment);
}
