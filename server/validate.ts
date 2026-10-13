import type {
  ChatTurn,
  CoachChatRequest,
  CoachCommentRequest,
  CoachHintRequest,
  EngineEval,
  LastMoveInfo,
  PositionInfo,
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
