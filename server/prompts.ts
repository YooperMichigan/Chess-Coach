import type { CoachCommentRequest, EngineEval } from '../shared/coach-types.ts';

export const MISTAKE_CATEGORIES = [
  'tactical-oversight',
  'opening',
  'positional',
  'endgame',
  'time',
  'blunder-check',
] as const;

export const COACH_SYSTEM = `You are a chess coach sitting next to a student who is playing a game against the Stockfish engine. You speak to the student directly, as "you".

All chess facts come from Stockfish and are given to you in each message: evaluations, best moves and lines. Use only that data for any claim about evaluations or moves. Do not calculate variations yourself, do not invent lines, and do not judge a position beyond what the data supports. If a needed piece of engine data is missing, say so plainly instead of guessing.

How to coach:
- Be brief: 1-3 sentences.
- Coach, don't solve. Prefer a nudge or a question that points at the idea ("What does your opponent's last move attack?"). Do not name the engine's best move or the winning continuation.
- Be direct. No praise, flattery or filler. If the move was a mistake, say so plainly and name the underlying idea: a missed tactic, a weakened square, king safety, piece activity, pawn structure, and so on.
- Evaluations are from the student's point of view, in pawns: +1.00 means the student is a pawn better. "M3" means the student can force mate in 3; "-M3" means the opponent can.
- If nothing is worth saying (for example, a routine periodic check-in in a quiet position), return an empty comment.

Set "category" to the mistake type when the student's move was a significant mistake: tactical-oversight, opening, positional, endgame, time, or blunder-check (a move played without checking the opponent's forcing replies). Otherwise set it to "none".`;

export const COMMENT_SCHEMA = {
  type: 'object',
  properties: {
    comment: { type: 'string' },
    category: { type: 'string', enum: [...MISTAKE_CATEGORIES, 'none'] },
  },
  required: ['comment', 'category'],
  additionalProperties: false,
};

const TRIGGER_TEXT: Record<CoachCommentRequest['trigger'], string> = {
  swing: 'the evaluation swung against the student by more than the alert threshold',
  'missed-mate': 'the student had a forced mate and the move did not keep it',
  periodic: 'routine check-in every few moves; comment only if there is a useful strategic point',
  ask: 'the student pressed "Ask coach"',
};

function formatEval(e: EngineEval | null): string {
  if (!e) return 'missing (engine data not available)';
  const s = e.score;
  const v = 'mate' in s ? `${s.mate < 0 ? '-' : ''}M${Math.abs(s.mate)}` : `${s.cp >= 0 ? '+' : ''}${(s.cp / 100).toFixed(2)}`;
  return `${v} (depth ${e.depth})`;
}

export function buildCommentPrompt(r: CoachCommentRequest): string {
  const top = r.engineTopMove
    ? r.wasTopChoice
      ? 'yes'
      : `no (do not reveal the engine's move: ${r.engineTopMove})`
    : 'unknown (engine data missing)';
  return [
    `Why you are being asked: ${TRIGGER_TEXT[r.trigger]}.`,
    `Student plays: ${r.myColor}. Student level: ${r.playerLevel}. Engine opponent strength: ${r.engineStrength}.`,
    `Recent moves: ${r.recentMoves || '(none)'}`,
    `Student's last move: ${r.myMove}`,
    `Was it the engine's top choice? ${top}`,
    `Evaluation before the move: ${formatEval(r.evalBefore)}`,
    `Evaluation after the move: ${formatEval(r.evalAfter)}`,
    `Engine best line before the move: ${r.bestLineBefore || 'missing'}`,
    `Engine best line after the move (opponent's best play): ${r.bestLineAfter || 'missing'}`,
    `Position now (FEN): ${r.fen}`,
  ].join('\n');
}
