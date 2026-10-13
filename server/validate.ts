import type {
  ChatTurn,
  CoachChatRequest,
  CoachCommentRequest,
  CoachHintRequest,
  EngineEval,
  LastMoveInfo,
  MistakeCategory,
  MistakeRecord,
  PlayerScore,
  CriticalMoment,
  PositionInfo,
  ReviewRequest,
  SaveGameRequest,
} from '../shared/coach-types.ts';

// The client is local and trusted, but bad input should fail clearly rather than reach the API.
const TRIGGERS = ['swing', 'missed-mate', 'periodic', 'ask'];

function str(v: unknown, max: number, name: string): string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid ${name}`);
  return v;
}

function evalOrNull(v: unknown, name: string): EngineEval | null {
  if (v === null) return null;
  const e = v as EngineEval;
  const s = e?.score as Record<string, unknown> | undefined;
  const ok =
    typeof e?.depth === 'number' &&
    s !== undefined &&
    (typeof s.cp === 'number' || typeof s.mate === 'number');
  if (!ok) throw new Error(`Invalid ${name}`);
  return e;
}

export function parseCommentRequest(body: unknown): CoachCommentRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!TRIGGERS.includes(b.trigger as string)) throw new Error('Invalid trigger');
  if (b.myColor !== 'white' && b.myColor !== 'black') throw new Error('Invalid myColor');
  return {
    trigger: b.trigger as CoachCommentRequest['trigger'],
    fen: str(b.fen, 100, 'fen'),
    myColor: b.myColor,
    recentMoves: str(b.recentMoves, 300, 'recentMoves'),
    myMove: str(b.myMove, 10, 'myMove'),
    engineTopMove: b.engineTopMove === null ? null : str(b.engineTopMove, 10, 'engineTopMove'),
    wasTopChoice: Boolean(b.wasTopChoice),
    evalBefore: evalOrNull(b.evalBefore, 'evalBefore'),
    evalAfter: evalOrNull(b.evalAfter, 'evalAfter'),
    bestLineBefore: str(b.bestLineBefore, 200, 'bestLineBefore'),
    bestLineAfter: str(b.bestLineAfter, 200, 'bestLineAfter'),
    engineStrength: str(b.engineStrength, 40, 'engineStrength'),
    playerLevel: str(b.playerLevel, 60, 'playerLevel'),
  };
}

function color(v: unknown): 'white' | 'black' {
  if (v !== 'white' && v !== 'black') throw new Error('Invalid myColor');
  return v;
}

function nullableStr(v: unknown, max: number, name: string): string | null {
  return v === null ? null : str(v, max, name);
}

function parsePosition(v: unknown): PositionInfo {
  const p = (v ?? {}) as Record<string, unknown>;
  if (p.toMove !== 'player' && p.toMove !== 'engine') throw new Error('Invalid toMove');
  return {
    fen: str(p.fen, 100, 'fen'),
    myColor: color(p.myColor),
    recentMoves: str(p.recentMoves, 300, 'recentMoves'),
    toMove: p.toMove,
    gameResult: nullableStr(p.gameResult, 80, 'gameResult'),
    eval: evalOrNull(p.eval, 'eval'),
    bestMove: nullableStr(p.bestMove, 10, 'bestMove'),
    bestLine: str(p.bestLine, 200, 'bestLine'),
    engineStrength: str(p.engineStrength, 40, 'engineStrength'),
    playerLevel: str(p.playerLevel, 60, 'playerLevel'),
  };
}

function parseLastMove(v: unknown): LastMoveInfo | null {
  if (v === null) return null;
  const m = (v ?? {}) as Record<string, unknown>;
  return {
    san: str(m.san, 10, 'lastMove.san'),
    evalBefore: evalOrNull(m.evalBefore, 'lastMove.evalBefore'),
    evalAfter: evalOrNull(m.evalAfter, 'lastMove.evalAfter'),
    engineTopMove: nullableStr(m.engineTopMove, 10, 'lastMove.engineTopMove'),
    wasTopChoice: Boolean(m.wasTopChoice),
  };
}

export function parseChatRequest(body: unknown): CoachChatRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const question = str(b.question, 500, 'question').trim();
  if (!question) throw new Error('Empty question');
  if (!Array.isArray(b.history) || b.history.length > 20) throw new Error('Invalid history');
  const history: ChatTurn[] = b.history.map((t: Record<string, unknown>) => {
    if (t?.role !== 'user' && t?.role !== 'assistant') throw new Error('Invalid history role');
    return { role: t.role, text: str(t.text, 1500, 'history text') };
  });
  return { question, history, position: parsePosition(b.position), lastMove: parseLastMove(b.lastMove) };
}

export function parseHintRequest(body: unknown): CoachHintRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.level !== 1 && b.level !== 2 && b.level !== 3) throw new Error('Invalid level');
  if (!Array.isArray(b.previousHints) || b.previousHints.length > 2) throw new Error('Invalid previousHints');
  const position = parsePosition(b.position);
  if (position.toMove !== 'player' || position.gameResult) throw new Error('Hints are only for your own move');
  return {
    level: b.level,
    position,
    previousHints: b.previousHints.map((h: unknown) => str(h, 600, 'previous hint')),
  };
}

const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];
const CATEGORIES = ['tactical-oversight', 'opening', 'positional', 'endgame', 'time', 'blunder-check'];

function scoreOrNull(v: unknown, name: string): PlayerScore | null {
  if (v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s?.cp === 'number') return { cp: s.cp };
  if (typeof s?.mate === 'number') return { mate: s.mate };
  throw new Error(`Invalid ${name}`);
}

function parseMistake(v: unknown): MistakeRecord {
  const m = (v ?? {}) as Record<string, unknown>;
  if (typeof m.moveNumber !== 'number' || m.moveNumber < 1) throw new Error('Invalid mistake moveNumber');
  if (m.category !== null && !CATEGORIES.includes(m.category as string)) throw new Error('Invalid mistake category');
  return {
    moveNumber: Math.floor(m.moveNumber),
    fen: str(m.fen, 100, 'mistake fen'),
    myMove: str(m.myMove, 10, 'mistake myMove'),
    bestMove: nullableStr(m.bestMove, 10, 'mistake bestMove'),
    evalBefore: scoreOrNull(m.evalBefore, 'mistake evalBefore'),
    evalAfter: scoreOrNull(m.evalAfter, 'mistake evalAfter'),
    category: m.category as MistakeCategory | null,
    coachNote: nullableStr(m.coachNote, 1500, 'mistake coachNote'),
  };
}

export function parseSaveGameRequest(body: unknown): SaveGameRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!RESULTS.includes(b.result as string)) throw new Error('Invalid result');
  if (b.engineElo !== null && (typeof b.engineElo !== 'number' || b.engineElo < 0 || b.engineElo > 4000)) {
    throw new Error('Invalid engineElo');
  }
  if (!Array.isArray(b.mistakes) || b.mistakes.length > 300) throw new Error('Invalid mistakes');
  return {
    pgn: str(b.pgn, 20_000, 'pgn'),
    result: b.result as SaveGameRequest['result'],
    engineElo: b.engineElo as number | null,
    engineLabel: str(b.engineLabel, 40, 'engineLabel'),
    myColor: color(b.myColor),
    mistakes: b.mistakes.map(parseMistake),
    coachCostUsd: typeof b.coachCostUsd === 'number' && b.coachCostUsd >= 0 && b.coachCostUsd < 100 ? b.coachCostUsd : 0,
  };
}

function parseMoment(v: unknown): CriticalMoment {
  const m = (v ?? {}) as Record<string, unknown>;
  if (typeof m.ply !== 'number' || typeof m.moveNumber !== 'number') throw new Error('Invalid moment');
  return {
    ply: Math.floor(m.ply),
    moveNumber: Math.floor(m.moveNumber),
    fen: str(m.fen, 100, 'moment fen'),
    myMove: str(m.myMove, 10, 'moment myMove'),
    myMoveUci: str(m.myMoveUci, 6, 'moment myMoveUci'),
    bestMove: nullableStr(m.bestMove, 10, 'moment bestMove'),
    bestMoveUci: nullableStr(m.bestMoveUci, 6, 'moment bestMoveUci'),
    bestLine: str(m.bestLine, 200, 'moment bestLine'),
    replyLine: str(m.replyLine, 200, 'moment replyLine'),
    evalBefore: scoreOrNull(m.evalBefore, 'moment evalBefore'),
    evalAfter: scoreOrNull(m.evalAfter, 'moment evalAfter'),
  };
}

export function parseReviewRequest(body: unknown): ReviewRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.gameId !== 'number' || !Number.isInteger(b.gameId)) throw new Error('Invalid gameId');
  if (!RESULTS.includes(b.result as string)) throw new Error('Invalid result');
  if (!Array.isArray(b.moments) || b.moments.length > 5) throw new Error('Invalid moments');
  return {
    gameId: b.gameId,
    pgn: str(b.pgn, 20_000, 'pgn'),
    myColor: color(b.myColor),
    result: b.result as ReviewRequest['result'],
    engineStrength: str(b.engineStrength, 40, 'engineStrength'),
    playerLevel: str(b.playerLevel, 60, 'playerLevel'),
    moments: b.moments.map(parseMoment),
  };
}
