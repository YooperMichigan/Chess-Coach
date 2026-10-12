import { Chess } from 'chess.js';
import type { CoachCommentRequest, CoachTrigger } from '../../shared/coach-types.ts';
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

/** Builds the coach request from Stockfish data only. Missing data is sent as null or empty. */
export function buildCoachRequest(m: PlayerMove, trigger: CoachTrigger, ctx: RequestContext): CoachCommentRequest {
  const before = ctx.analysisOf(m.fenBefore);
  const after = ctx.analysisOf(m.fenAfter);
  const topUci = before?.pv[0] ?? null;
  let engineTopMove: string | null = null;
  if (topUci) {
    try {
      engineTopMove = new Chess(m.fenBefore).move({ from: topUci.slice(0, 2), to: topUci.slice(2, 4), promotion: topUci[4] }).san;
    } catch {
      engineTopMove = null;
    }
  }
  const history = ctx.history.slice(0, m.ply + 1);
  const start = Math.max(0, history.length - ctx.recentPlies);
  return {
    trigger,
    fen: m.fenAfter,
    myColor: ctx.myColor,
    recentMoves: numberMoves(history.slice(start), start),
    myMove: m.san,
    engineTopMove,
    wasTopChoice: topUci === m.uci,
    evalBefore: before ? { score: toPlayerScore(before.score, ctx.myColor), depth: before.depth } : null,
    evalAfter: after ? { score: toPlayerScore(after.score, ctx.myColor), depth: after.depth } : null,
    bestLineBefore: before ? pvToSan(m.fenBefore, before.pv, ctx.bestLineLength) : '',
    bestLineAfter: after ? pvToSan(m.fenAfter, after.pv, ctx.bestLineLength) : '',
    engineStrength: ctx.engineStrength,
    playerLevel: ctx.playerLevel,
  };
}
