import { Chess } from 'chess.js';
import type {
  CoachCommentRequest,
  CoachTrigger,
  EngineEval,
  LastMoveInfo,
  PositionInfo,
} from '../../shared/coach-types.ts';
import type { AnalysisInfo } from '../engine/stockfish.ts';
import { pvToSan } from '../engine/format.ts';
import { numberMoves, toPlayerScore } from './triggers.ts';

/** One of the player's moves, kept so the coach can be asked about it. */
export interface PlayerMove {
  ply: number; // index in the game history
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}

export interface RequestContext {
  history: string[]; // full SAN history of the game so far
  myColor: 'white' | 'black';
  analysisOf: (fen: string) => AnalysisInfo | undefined;
  engineStrength: string;
  playerLevel: string;
  recentPlies: number;
  bestLineLength: number;
}

/** Engine move in SAN, or null if missing or not legal in `fen`. */
function uciToSan(fen: string, uci: string | undefined): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

function playerEval(a: AnalysisInfo | undefined, color: 'white' | 'black'): EngineEval | null {
  return a ? { score: toPlayerScore(a.score, color), depth: a.depth } : null;
}

/** Last `recentPlies` half-moves of `history`, numbered. */
function recent(history: string[], recentPlies: number): string {
  const start = Math.max(0, history.length - recentPlies);
  return numberMoves(history.slice(start), start);
}

/** Builds the coach request from Stockfish data only. Missing data is sent as null or empty. */
export function buildCoachRequest(m: PlayerMove, trigger: CoachTrigger, ctx: RequestContext): CoachCommentRequest {
  const before = ctx.analysisOf(m.fenBefore);
  const after = ctx.analysisOf(m.fenAfter);
  const last = buildLastMoveInfo(m, ctx);
  return {
    trigger,
    fen: m.fenAfter,
    myColor: ctx.myColor,
    recentMoves: recent(ctx.history.slice(0, m.ply + 1), ctx.recentPlies),
    myMove: m.san,
    engineTopMove: last.engineTopMove,
    wasTopChoice: last.wasTopChoice,
    evalBefore: last.evalBefore,
    evalAfter: last.evalAfter,
    bestLineBefore: before ? pvToSan(m.fenBefore, before.pv, ctx.bestLineLength) : '',
    bestLineAfter: after ? pvToSan(m.fenAfter, after.pv, ctx.bestLineLength) : '',
    engineStrength: ctx.engineStrength,
    playerLevel: ctx.playerLevel,
  };
}

/** Stockfish's view of the player's move: evals before and after, and the engine's preference. */
export function buildLastMoveInfo(m: PlayerMove, ctx: RequestContext): LastMoveInfo {
  const before = ctx.analysisOf(m.fenBefore);
  return {
    san: m.san,
    evalBefore: playerEval(before, ctx.myColor),
    evalAfter: playerEval(ctx.analysisOf(m.fenAfter), ctx.myColor),
    engineTopMove: uciToSan(m.fenBefore, before?.pv[0]),
    wasTopChoice: before?.pv[0] === m.uci,
  };
}

/** The current position with Stockfish's evaluation and best line, for chat and hints. */
export function buildPositionInfo(
  fen: string,
  toMove: 'player' | 'engine',
  gameResult: string | null,
  ctx: RequestContext,
): PositionInfo {
  const a = gameResult ? undefined : ctx.analysisOf(fen);
  return {
    fen,
    myColor: ctx.myColor,
    recentMoves: recent(ctx.history, ctx.recentPlies),
    toMove,
    gameResult,
    eval: playerEval(a, ctx.myColor),
    bestMove: uciToSan(fen, a?.pv[0]),
    bestLine: a ? pvToSan(fen, a.pv, ctx.bestLineLength) : '',
    engineStrength: ctx.engineStrength,
    playerLevel: ctx.playerLevel,
  };
}
