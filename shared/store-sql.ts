// The game database: one schema and one set of queries, shared by the Mac server
// (better-sqlite3) and the iPad app (@capacitor-community/sqlite). Each side supplies a
// small SqlDriver; everything above it is identical.
import type {
  GameReview,
  MistakeCategory,
  MistakeSummary,
  PatternTag,
  PlayerScore,
  SaveGameRequest,
  SavedGameState,
  UsageSummary,
} from './coach-types.ts';
import { ENGINE_RATINGS, computeRating, type RatedGame, type RatingSummary } from './rating.ts';

export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Runs one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** Runs one statement; returns the new row id for inserts. */
  run(sql: string, params?: SqlValue[]): Promise<{ lastId: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export const COACHING_BRIEF_KEY = 'coachingBrief';
const CURRENT_GAME_KEY = 'currentGame';

// Evals are stored as integer centipawns from the player's point of view. Forced mates are
// stored as +/-(10000 - moves to mate), so M3 = 9997 and -M3 = -9997.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY,
    played_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    pgn          TEXT    NOT NULL,
    result       TEXT    NOT NULL CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
    engine_elo   INTEGER,
    engine_label TEXT    NOT NULL,
    my_color     TEXT    NOT NULL CHECK (my_color IN ('white', 'black'))
  );
  CREATE TABLE IF NOT EXISTS mistakes (
    id          INTEGER PRIMARY KEY,
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    move_number INTEGER NOT NULL,
    fen         TEXT    NOT NULL,
    my_move     TEXT    NOT NULL,
    best_move   TEXT,
    eval_before INTEGER,
    eval_after  INTEGER,
    category    TEXT,
    coach_note  TEXT
  );
  CREATE INDEX IF NOT EXISTS mistakes_game ON mistakes(game_id);
  -- Small key/value store for app settings such as the coaching brief.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- One row per Claude API call, for the in-app cost display.
  CREATE TABLE IF NOT EXISTS api_usage (
    id            INTEGER PRIMARY KEY,
    at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    route         TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd      REAL    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_played_at ON games(played_at);
`;

export function scoreToCp(s: PlayerScore | null): number | null {
  if (!s) return null;
  if ('cp' in s) return Math.round(s.cp);
  return Math.sign(s.mate) * (10_000 - Math.abs(s.mate));
}

const INSERT_GAME = `INSERT INTO games (pgn, result, engine_elo, engine_label, my_color, coach_cost_usd) VALUES (?, ?, ?, ?, ?, ?)`;
const INSERT_MISTAKE = `INSERT INTO mistakes (game_id, move_number, fen, my_move, best_move, eval_before, eval_after, category, pattern, coach_note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const RECENT_GAME_IDS = `SELECT id FROM games ORDER BY played_at DESC, id DESC LIMIT ?`;

export interface RecentGame {
  id: number;
  playedAt: string;
  result: string;
  engineLabel: string;
  myColor: 'white' | 'black';
  coachCostUsd: number;
  mistakes: number;
}

/** Saved games, mistakes, settings and API usage on top of any SQLite driver. */
export class SqlGameStore {
  private db: SqlDriver;
  private ready: Promise<void>;
  // Every operation runs one at a time, so a transaction never interleaves with another call.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(db: SqlDriver) {
    this.db = db;
    this.ready = this.migrate();
    this.queue = this.ready;
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async transaction<T>(op: () => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const out = await op();
      await this.db.exec('COMMIT');
      return out;
    } catch (err) {
      await this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private async migrate() {
    await this.db.exec(SCHEMA);
    // Databases created before these columns existed get them added here.
    const gameColumns = await this.db.all<{ name: string }>(`PRAGMA table_info(games)`);
    if (!gameColumns.some((c) => c.name === 'coach_cost_usd')) {
      await this.db.exec(`ALTER TABLE games ADD COLUMN coach_cost_usd REAL NOT NULL DEFAULT 0`);
    }
    // Pattern tag on each mistake (e.g. "fork", "dragon-c-file"), so recurring patterns can be counted.
    const mistakeColumns = await this.db.all<{ name: string }>(`PRAGMA table_info(mistakes)`);
    if (!mistakeColumns.some((c) => c.name === 'pattern')) {
      await this.db.exec(`ALTER TABLE mistakes ADD COLUMN pattern TEXT`);
    }
    // The review is stored with its game so it can be shown again without paying twice.
    if (!gameColumns.some((c) => c.name === 'review_json')) {
      await this.db.exec(`ALTER TABLE games ADD COLUMN review_json TEXT`);
    }
  }

  /** Saves a game and its mistakes in one transaction. Returns the new game id. */
  saveGame(g: SaveGameRequest): Promise<number> {
    return this.serial(() =>
      this.transaction(async () => {
        const { lastId: gameId } = await this.db.run(INSERT_GAME, [
          g.pgn,
          g.result,
          g.engineElo,
          g.engineLabel,
          g.myColor,
          g.coachCostUsd,
        ]);
        for (const m of g.mistakes) {
          await this.db.run(INSERT_MISTAKE, [
            gameId,
            m.moveNumber,
            m.fen,
            m.myMove,
            m.bestMove,
            scoreToCp(m.evalBefore),
            scoreToCp(m.evalAfter),
            m.category,
            m.pattern,
            m.coachNote,
          ]);
        }
        return gameId;
      }),
    );
  }

  /** Top recurring mistake categories and patterns over the last N saved games. */
  mistakeSummary(lastN: number): Promise<MistakeSummary> {
    return this.serial(async () => {
      const one = async (sql: string, params: SqlValue[] = []) => (await this.db.all<{ n: number }>(sql, params))[0].n;
      return {
        gamesSaved: await one(`SELECT COUNT(*) AS n FROM games`),
        lastN: await one(`SELECT COUNT(*) AS n FROM (${RECENT_GAME_IDS})`, [lastN]),
        categories: await this.db.all<{ category: MistakeCategory; count: number }>(
          `SELECT category, COUNT(*) AS count FROM mistakes
           WHERE category IS NOT NULL AND game_id IN (${RECENT_GAME_IDS})
           GROUP BY category ORDER BY count DESC, category`,
          [lastN],
        ),
        patterns: await this.db.all<{ pattern: PatternTag; count: number }>(
          `SELECT pattern, COUNT(*) AS count FROM mistakes
           WHERE pattern IS NOT NULL AND game_id IN (${RECENT_GAME_IDS})
           GROUP BY pattern ORDER BY count DESC, pattern LIMIT 8`,
          [lastN],
        ),
        uncategorized: await one(`SELECT COUNT(*) AS n FROM mistakes WHERE category IS NULL AND game_id IN (${RECENT_GAME_IDS})`, [
          lastN,
        ]),
      };
    });
  }

  recentGames(limit: number): Promise<RecentGame[]> {
    return this.serial(() =>
      this.db.all<RecentGame>(
        `SELECT g.id, g.played_at AS playedAt, g.result, g.engine_label AS engineLabel, g.my_color AS myColor,
                g.coach_cost_usd AS coachCostUsd,
                (SELECT COUNT(*) FROM mistakes m WHERE m.game_id = g.id) AS mistakes
         FROM games g ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
        [limit],
      ),
    );
  }

  gameMistakes(gameId: number): Promise<unknown[]> {
    return this.serial(() => this.db.all(`SELECT * FROM mistakes WHERE game_id = ? ORDER BY move_number`, [gameId]));
  }

  recordUsage(u: { route: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }): Promise<void> {
    return this.serial(async () => {
      await this.db.run(`INSERT INTO api_usage (route, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)`, [
        u.route,
        u.model,
        u.inputTokens,
        u.outputTokens,
        u.costUsd,
      ]);
    });
  }

  usageSummary(): Promise<UsageSummary> {
    return this.serial(
      async () =>
        (
          await this.db.all<UsageSummary>(
            `SELECT COALESCE(SUM(cost_usd), 0) AS totalUsd,
                    COALESCE(SUM(CASE WHEN substr(at, 1, 7) = strftime('%Y-%m', 'now') THEN cost_usd END), 0) AS monthUsd,
                    COUNT(*) AS calls
             FROM api_usage`,
          )
        )[0],
    );
  }

  gameExists(gameId: number): Promise<boolean> {
    return this.serial(async () => (await this.db.all(`SELECT 1 FROM games WHERE id = ?`, [gameId])).length > 0);
  }

  storedReview(gameId: number): Promise<GameReview | null> {
    return this.serial(async () => {
      const [row] = await this.db.all<{ review_json: string | null }>(`SELECT review_json FROM games WHERE id = ?`, [gameId]);
      return row?.review_json ? (JSON.parse(row.review_json) as GameReview) : null;
    });
  }

  /**
   * Stores a review: its tags and explanations replace the live ones on matching mistakes, and
   * moments the live coach did not flag become new mistakes. The review cost is added to the game.
   */
  saveReview(review: GameReview): Promise<void> {
    return this.serial(() =>
      this.transaction(async () => {
        for (const m of review.moments) {
          const [existing] = await this.db.all<{ id: number }>(
            `SELECT id FROM mistakes WHERE game_id = ? AND move_number = ? AND my_move = ?`,
            [review.gameId, m.moveNumber, m.myMove],
          );
          if (existing) {
            await this.db.run(`UPDATE mistakes SET category = ?, pattern = COALESCE(?, pattern), coach_note = ? WHERE id = ?`, [
              m.category,
              m.pattern,
              m.explanation,
              existing.id,
            ]);
          } else {
            await this.db.run(INSERT_MISTAKE, [
              review.gameId,
              m.moveNumber,
              m.fen,
              m.myMove,
              m.bestMove,
              scoreToCp(m.evalBefore),
              scoreToCp(m.evalAfter),
              m.category,
              m.pattern,
              m.explanation,
            ]);
          }
        }
        await this.db.run(`UPDATE games SET review_json = ?, coach_cost_usd = coach_cost_usd + ? WHERE id = ?`, [
          JSON.stringify({ ...review, costUsd: 0 }), // shown again later at no cost
          review.costUsd,
          review.gameId,
        ]);
      }),
    );
  }

  getSetting(key: string): Promise<string | null> {
    return this.serial(async () => {
      const [row] = await this.db.all<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
      return row?.value ?? null;
    });
  }

  setSetting(key: string, value: string): Promise<void> {
    return this.serial(async () => {
      await this.db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
        key,
        value,
      ]);
    });
  }

  /** The game in progress, saved after every move. */
  async currentGame(): Promise<SavedGameState | null> {
    const raw = await this.getSetting(CURRENT_GAME_KEY);
    return raw ? (JSON.parse(raw) as SavedGameState) : null;
  }
  saveCurrentGame(state: SavedGameState): Promise<void> {
    return this.setSetting(CURRENT_GAME_KEY, JSON.stringify(state));
  }
  clearCurrentGame(): Promise<void> {
    return this.setSetting(CURRENT_GAME_KEY, '');
  }

  /** The player's rating, replayed from every finished game (games at unknown strengths are skipped). */
  playerRating(): Promise<RatingSummary> {
    return this.serial(async () => {
      const rows = await this.db.all<{
        id: number;
        playedAt: string;
        result: RatedGame['result'];
        myColor: 'white' | 'black';
        engineElo: number | null;
        engineLabel: string;
      }>(
        `SELECT id, played_at AS playedAt, result, my_color AS myColor, engine_elo AS engineElo, engine_label AS engineLabel
         FROM games WHERE result != '*' ORDER BY played_at, id`,
      );
      const rated: RatedGame[] = [];
      for (const r of rows) {
        const engineRating = r.engineElo ?? ENGINE_RATINGS[r.engineLabel];
        if (engineRating) {
          rated.push({ id: r.id, playedAt: r.playedAt, engineLabel: r.engineLabel, result: r.result, myColor: r.myColor, engineRating });
        }
      }
      return computeRating(rated);
    });
  }
}
