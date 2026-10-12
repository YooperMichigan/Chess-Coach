import { STOCKFISH_WORKER_URL, type EngineStrength } from '../config';

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

  /** Abort any running search and reset engine state for a new game. */
  newGame(): Promise<void> {
    // Sent immediately (not queued) so an in-flight search ends now.
    if (this.searching) this.send('stop');
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

  terminate() {
    this.worker.terminate();
  }
}
