import { STOCKFISH_WORKER_URL, type EngineStrength } from '../config';

/** Engine score from White's point of view. `mate` is moves to mate (+ White mates, - Black mates). */
export type Score = { cp: number } | { mate: number };

export interface AnalysisInfo {
  depth: number;
  score: Score;
  pv: string[]; // UCI moves
}

const INFO_RE = /^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)\b(?! (?:lower|upper)bound).*\bpv (.+)$/;

/**
 * Thin UCI wrapper around the Stockfish WASM Web Worker.
 * Only one search runs at a time; callers await each request.
 */
export class StockfishEngine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  // Every public operation is chained onto this queue so UCI commands never interleave.
  private queue: Promise<unknown>;
  private searching = false;
  // Bumped by stopSearch(); queued searches started under an older value are skipped.
  private searchGen = 0;

  constructor() {
    this.worker = new Worker(STOCKFISH_WORKER_URL);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      for (const l of this.listeners) l(line);
    };
    this.worker.onerror = (e) => console.error('[stockfish] worker error', e);
    this.queue = this.handshake();
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  private async handshake() {
    const uciok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await uciok;
    await this.isReady();
  }

  private async isReady() {
    const ok = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  setStrength(s: EngineStrength): Promise<void> {
    return this.enqueue(async () => {
      if (s.kind === 'elo') {
        this.send('setoption name Skill Level value 20');
        this.send('setoption name UCI_LimitStrength value true');
        this.send(`setoption name UCI_Elo value ${s.elo}`);
      } else {
        this.send('setoption name UCI_LimitStrength value false');
        this.send(`setoption name Skill Level value ${s.level}`);
      }
      await this.isReady();
    });
  }

  /** Ends the running search now and cancels any searches still waiting in the queue. */
  stopSearch() {
    this.searchGen++;
    if (this.searching) this.send('stop');
  }

  /** Abort any running search and reset engine state for a new game. */
  newGame(): Promise<void> {
    this.stopSearch();
    return this.enqueue(async () => {
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  /** Returns the engine's chosen move in UCI notation (e.g. "e2e4", "e7e8q"). */
  getMove(fen: string, movetimeMs: number): Promise<string | null> {
    return this.enqueue(async () => {
      this.searching = true;
      const result = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetimeMs}`);
      const line = await result;
      this.searching = false;
      const move = line.split(' ')[1];
      return !move || move === '(none)' ? null : move;
    });
  }

  /**
   * Full-depth analysis of `fen`. Calls `onInfo` as each depth completes, scores normalized
   * to White's view. Resolves when the search ends; returns false if it was cancelled first.
   */
  analyze(fen: string, depth: number, onInfo: (info: AnalysisInfo) => void): Promise<boolean> {
    const gen = this.searchGen;
    return this.enqueue(async () => {
      if (gen !== this.searchGen) return false;
      const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
      const listener = (line: string) => {
        if (gen !== this.searchGen) return;
        const m = INFO_RE.exec(line);
        if (!m) return;
        const v = sign * Number(m[3]);
        onInfo({
          depth: Number(m[1]),
          score: m[2] === 'cp' ? { cp: v } : { mate: v },
          pv: m[4].trim().split(' '),
        });
      };
      this.listeners.add(listener);
      this.searching = true;
      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      await done;
      this.searching = false;
      this.listeners.delete(listener);
      return gen === this.searchGen;
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
