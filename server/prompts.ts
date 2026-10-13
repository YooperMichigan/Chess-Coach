import type {
  CoachChatRequest,
  CoachCommentRequest,
  CoachHintRequest,
  EngineEval,
  MistakeSummary,
  PlayerScore,
  PositionInfo,
  ReviewRequest,
} from '../shared/coach-types.ts';

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

// Shared ground rules for every coach call: Stockfish supplies the chess, Claude explains it.
const GROUND_RULES = `All chess facts come from Stockfish and are given to you in each message: evaluations, best moves and lines. Use only that data for any claim about evaluations or moves. Do not calculate variations yourself, do not invent lines, and do not judge a position beyond what the data supports. If a needed piece of engine data is missing, say so plainly instead of guessing.

Evaluations are from the student's point of view, in pawns: +1.00 means the student is a pawn better. "M3" means the student can force mate in 3; "-M3" means the opponent can.

Be direct. No praise, flattery or filler.`;

export const CHAT_SYSTEM = `You are a chess coach sitting next to a student who is playing a game against the Stockfish engine. The student is asking you a question during the game. Speak to them directly, as "you".

${GROUND_RULES}

How to answer:
- Answer the question asked, in 1-4 sentences. Use plain language.
- Coach, don't solve. Unless the student asks directly for the best move, do not name it or the winning continuation; point them at the idea instead. If they do ask directly, give the engine's move and a one-line reason.
- You cannot change the game, move pieces, or take back moves. If asked to, say so.
- If the question is not about this game or chess improvement, briefly steer back to the game.`;

export const HINT_SYSTEM = `You are a chess coach giving a student a graded hint during a game against the Stockfish engine. Speak to them directly, as "you".

${GROUND_RULES}

The student asks for hints one level at a time for the same position:
- Level 1, nudge: one general idea or question. Do not name any piece, square or move.
- Level 2, target: say which piece or area of the board to look at, and why it matters. Do not give the move itself.
- Level 3, move: give the engine's best move in standard notation, with a one-line reason.

Write one or two short sentences. Build on the earlier hints for this position rather than repeating them.`;

function formatPosition(p: PositionInfo): string[] {
  const toMove = p.gameResult
    ? `Game over: ${p.gameResult}`
    : p.toMove === 'player'
      ? 'Student to move.'
      : 'Engine to move (the student is waiting for its reply).';
  return [
    `Student plays: ${p.myColor}. Student level: ${p.playerLevel}. Engine opponent strength: ${p.engineStrength}.`,
    `Recent moves: ${p.recentMoves || '(none yet)'}`,
    toMove,
    `Current evaluation: ${formatEval(p.eval)}`,
    `Engine best move for the side to move: ${p.bestMove ?? 'missing'}`,
    `Engine best line: ${p.bestLine || 'missing'}`,
    `Position (FEN): ${p.fen}`,
  ];
}

export function buildChatPrompt(r: CoachChatRequest): string {
  const lines = ['Current game state:', ...formatPosition(r.position)];
  if (r.lastMove) {
    const m = r.lastMove;
    const top = m.engineTopMove ? (m.wasTopChoice ? 'yes' : `no (engine preferred ${m.engineTopMove})`) : 'unknown';
    lines.push(
      `Student's last move: ${m.san}. Engine's top choice? ${top}.`,
      `Evaluation before it: ${formatEval(m.evalBefore)}. After it: ${formatEval(m.evalAfter)}.`,
    );
  }
  lines.push('', `Student's question: ${r.question}`);
  return lines.join('\n');
}

export function buildHintPrompt(r: CoachHintRequest): string {
  const lines = [`Give a level ${r.level} hint.`, ...formatPosition(r.position)];
  if (r.previousHints.length) {
    lines.push('Hints already given for this position:', ...r.previousHints.map((h, i) => `  Level ${i + 1}: ${h}`));
  }
  return lines.join('\n');
}

export const REVIEW_SYSTEM = `You are a chess coach reviewing a finished game with your student, who played against the Stockfish engine. Speak to them directly, as "you".

${GROUND_RULES}

This is the post-game review, so you may name the engine's best moves and lines. Still use only the lines given; do not extend them or analyse further yourself.

For each critical moment (the student's largest evaluation swings, found by Stockfish):
- Explain in plain language, in 2-4 sentences, what went wrong and the idea behind the engine's preferred move: a missed tactic, a weakened square, king safety, piece activity, pawn structure, and so on.
- Tag it with one category: tactical-oversight, opening, positional, endgame, time, or blunder-check (a move played without checking the opponent's forcing replies). Use "none" only if the swing was not really the student's mistake.

Then write:
- summary: 2-3 sentences on how this game went.
- recurring: the student's recurring weaknesses, using this game together with the category counts from their recent games. Be specific and honest; if there is not enough history yet, say so.
- focus: one concrete habit to practise in the next game.`;

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          explanation: { type: 'string' },
          category: { type: 'string', enum: [...MISTAKE_CATEGORIES, 'none'] },
        },
        required: ['index', 'explanation', 'category'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
    recurring: { type: 'string' },
    focus: { type: 'string' },
  },
  required: ['moments', 'summary', 'recurring', 'focus'],
  additionalProperties: false,
};

function formatScore(s: PlayerScore | null): string {
  return formatEval(s ? { score: s, depth: 0 } : null).replace(/ \(depth 0\)$/, '');
}

export function buildReviewPrompt(r: ReviewRequest, history: MistakeSummary): string {
  const lines = [
    `Student played: ${r.myColor}. Result: ${r.result}. Student level: ${r.playerLevel}. Engine opponent strength: ${r.engineStrength}.`,
    '',
    'Game (PGN):',
    r.pgn,
    '',
  ];
  if (r.moments.length === 0) {
    lines.push('Stockfish found no significant evaluation swings in the student\'s moves this game.');
  } else {
    lines.push(`Critical moments (${r.moments.length}), largest swing first:`);
    r.moments.forEach((m, i) => {
      lines.push(
        '',
        `Moment ${i}: move ${m.moveNumber}, the student played ${m.myMove}.`,
        `  Position before the move (FEN): ${m.fen}`,
        `  Evaluation before: ${formatScore(m.evalBefore)}. After: ${formatScore(m.evalAfter)}.`,
        `  Stockfish's best move: ${m.bestMove ?? 'missing'}. Best line: ${m.bestLine || 'missing'}`,
        `  Stockfish's line after the student's move: ${m.replyLine || 'missing'}`,
      );
    });
  }
  lines.push('', `Mistake categories over the student's last ${history.lastN} saved games (including this one):`);
  if (history.categories.length === 0) lines.push('  none tagged yet');
  for (const c of history.categories) lines.push(`  ${c.category}: ${c.count}`);
  if (history.uncategorized) lines.push(`  untagged mistakes: ${history.uncategorized}`);
  lines.push('', `Return one entry in "moments" for each critical moment, using its index.`);
  return lines.join('\n');
}
