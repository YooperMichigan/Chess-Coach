import type { CoachCommentRequest, EngineEval } from '../shared/coach-types.ts';

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
