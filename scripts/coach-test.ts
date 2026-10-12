// Stage 3 smoke test: sends one hardcoded blunder to the running coach server.
// Stockfish (Node build) computes the evals; the request is built with the app's own code.
// Usage: start the server (`npm run server`), then `npm run coach:test`.
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { buildCoachRequest, type PlayerMove } from '../src/coach/request.ts';
import { detectTrigger, toPlayerScore } from '../src/coach/triggers.ts';
import type { AnalysisInfo } from '../src/engine/stockfish.ts';

// The Blackburne Shilling trap: 4.Nxe5?? is met by 4...Qg5!, hitting e5 and g2.
const SETUP = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'];
const BLUNDER = 'Nxe5';
const DEPTH = 16;

// Saved before the engine loads: the stockfish Node build replaces the global fetch.
const httpFetch = globalThis.fetch;

type Engine = { processCommand(cmd: string): void; terminate(): void };
const require = createRequire(import.meta.url);
const loadEngine = require('stockfish') as (kind: string, onLine: (line: string) => void) => Engine;

const INFO_RE = /^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)\b(?! (?:lower|upper)bound).*\bpv (.+)$/;

// The Node build can only be instantiated once per process, so one engine serves both searches.
let onLine: (line: string) => void = () => {};
const engine = loadEngine('lite-single', (line) => onLine(line));
engine.processCommand('uci');

function analyze(fen: string): Promise<AnalysisInfo> {
  return new Promise((resolve) => {
    let last: AnalysisInfo | undefined;
    const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
    onLine = (line) => {
      const m = INFO_RE.exec(line);
      if (m) {
        const v = sign * Number(m[3]);
        last = { depth: Number(m[1]), score: m[2] === 'cp' ? { cp: v } : { mate: v }, pv: m[4].trim().split(' ') };
      }
      if (line.startsWith('bestmove')) resolve(last!);
    };
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${DEPTH}`);
  });
}

const game = new Chess();
for (const san of SETUP) game.move(san);
const move = game.move(BLUNDER);
const record: PlayerMove = { ply: game.history().length - 1, san: move.san, uci: move.lan, fenBefore: move.before, fenAfter: move.after };

console.log('Analyzing with Stockfish...');
const analyses = new Map([
  [record.fenBefore, await analyze(record.fenBefore)],
  [record.fenAfter, await analyze(record.fenAfter)],
]);
engine.terminate();

const before = toPlayerScore(analyses.get(record.fenBefore)!.score, 'white');
const after = toPlayerScore(analyses.get(record.fenAfter)!.score, 'white');
const trigger = detectTrigger(before, after, { thresholdCp: 80, periodicDue: false });
console.log(`Eval before ${JSON.stringify(before)}, after ${JSON.stringify(after)}, trigger: ${trigger}`);
if (!trigger) throw new Error('Expected the blunder to trigger the coach');

const body = buildCoachRequest(record, trigger, {
  history: game.history(),
  myColor: 'white',
  analysisOf: (f) => analyses.get(f),
  engineStrength: 'Elo 1500',
  playerLevel: 'not specified',
  recentPlies: 10,
  bestLineLength: 5,
});
console.log('Request:', JSON.stringify(body, null, 2));

const port = process.env.PORT ?? '3001';
const res = await httpFetch(`http://127.0.0.1:${port}/api/coach/comment`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log(`Response ${res.status}:`, await res.json());
