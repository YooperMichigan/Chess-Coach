import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GameReview,
  MistakeCategory,
  MistakeSummary,
  PatternTag,
  PlayerScore,
  SaveGameRequest,
  UsageSummary,
} from '../shared/coach-types.ts';
import { ENGINE_RATINGS, computeRating, type RatedGame, type RatingSummary } from '../shared/rating.ts';

// The database lives next to the project in data/ (gitignored). Override with CHESS_DB_PATH.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.CHESS_DB_PATH ?? join(root, 'data', 'chess-coach.db');
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Evals are stored as integer centipawns from the player's point of view. Forced mates are
// stored as +/-(10000 - moves to mate), so M3 = 9997 and -M3 = -9997.
db.exec(`
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
`);

// Databases created before the cost column existed get it added here.
const gameColumns = db.prepare(`PRAGMA table_info(games)`).all() as { name: string }[];
if (!gameColumns.some((c) => c.name === 'coach_cost_usd')) {
  db.exec(`ALTER TABLE games ADD COLUMN coach_cost_usd REAL NOT NULL DEFAULT 0`);
}
// Pattern tag on each mistake (e.g. "fork", "dragon-c-file"), so recurring patterns can be counted.
const mistakeColumns = db.prepare(`PRAGMA table_info(mistakes)`).all() as { name: string }[];
if (!mistakeColumns.some((c) => c.name === 'pattern')) {
  db.exec(`ALTER TABLE mistakes ADD COLUMN pattern TEXT`);
}
// The Stage 6 review is stored with its game so it can be shown again without paying twice.
if (!gameColumns.some((c) => c.name === 'review_json')) {
  db.exec(`ALTER TABLE games ADD COLUMN review_json TEXT`);
}

export function scoreToCp(s: PlayerScore | null): number | null {
  if (!s) return null;
  if ('cp' in s) return Math.round(s.cp);
  return Math.sign(s.mate) * (10_000 - Math.abs(s.mate));
}

const insertGame = db.prepare(
  `INSERT INTO games (pgn, result, engine_elo, engine_label, my_color, coach_cost_usd)
   VALUES (@pgn, @result, @engineElo, @engineLabel, @myColor, @coachCostUsd)`,
);
const insertMistake = db.prepare(
  `INSERT INTO mistakes (game_id, move_number, fen, my_move, best_move, eval_before, eval_after, category, pattern, coach_note)
   VALUES (@gameId, @moveNumber, @fen, @myMove, @bestMove, @evalBefore, @evalAfter, @category, @pattern, @coachNote)`,
);

/** Saves a game and its mistakes in one transaction. Returns the new game id. */
export const saveGame = db.transaction((g: SaveGameRequest): number => {
  const gameId = Number(
    insertGame.run({
      pgn: g.pgn,
      result: g.result,
      engineElo: g.engineElo,
      engineLabel: g.engineLabel,
      myColor: g.myColor,
      coachCostUsd: g.coachCostUsd,
    })
      .lastInsertRowid,
  );
  for (const m of g.mistakes) {
    insertMistake.run({
      gameId,
      moveNumber: m.moveNumber,
      fen: m.fen,
      myMove: m.myMove,
      bestMove: m.bestMove,
      evalBefore: scoreToCp(m.evalBefore),
      evalAfter: scoreToCp(m.evalAfter),
      category: m.category,
      pattern: m.pattern,
      coachNote: m.coachNote,
    });
  }
  return gameId;
});

const recentGameIds = `SELECT id FROM games ORDER BY played_at DESC, id DESC LIMIT @lastN`;
const topCategories = db.prepare(
  `SELECT category, COUNT(*) AS count FROM mistakes
   WHERE category IS NOT NULL AND game_id IN (${recentGameIds})
   GROUP BY category ORDER BY count DESC, category`,
);
const uncategorized = db.prepare(
  `SELECT COUNT(*) AS n FROM mistakes WHERE category IS NULL AND game_id IN (${recentGameIds})`,
);
const topPatterns = db.prepare(
  `SELECT pattern, COUNT(*) AS count FROM mistakes
   WHERE pattern IS NOT NULL AND game_id IN (${recentGameIds})
   GROUP BY pattern ORDER BY count DESC, pattern LIMIT 8`,
);
const gameCount = db.prepare(`SELECT COUNT(*) AS n FROM games`);
const coveredGames = db.prepare(`SELECT COUNT(*) AS n FROM (${recentGameIds})`);

/** Top recurring mistake categories over the last N saved games (feeds the Stage 6 review). */
export function mistakeSummary(lastN: number): MistakeSummary {
  return {
    gamesSaved: (gameCount.get() as { n: number }).n,
    lastN: (coveredGames.get({ lastN }) as { n: number }).n,
    categories: topCategories.all({ lastN }) as { category: MistakeCategory; count: number }[],
    patterns: topPatterns.all({ lastN }) as { pattern: PatternTag; count: number }[],
    uncategorized: (uncategorized.get({ lastN }) as { n: number }).n,
  };
}

export function recentGames(limit: number) {
  return db
    .prepare(
      `SELECT g.id, g.played_at AS playedAt, g.result, g.engine_label AS engineLabel, g.my_color AS myColor,
              g.coach_cost_usd AS coachCostUsd,
              (SELECT COUNT(*) FROM mistakes m WHERE m.game_id = g.id) AS mistakes
       FROM games g ORDER BY g.played_at DESC, g.id DESC LIMIT ?`,
    )
    .all(limit);
}

export function gameMistakes(gameId: number) {
  return db.prepare(`SELECT * FROM mistakes WHERE game_id = ? ORDER BY move_number`).all(gameId);
}

const insertUsage = db.prepare(
  `INSERT INTO api_usage (route, model, input_tokens, output_tokens, cost_usd)
   VALUES (@route, @model, @inputTokens, @outputTokens, @costUsd)`,
);
export function recordUsage(u: { route: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }) {
  insertUsage.run(u);
}

const usageTotals = db.prepare(
  `SELECT COALESCE(SUM(cost_usd), 0) AS totalUsd,
          COALESCE(SUM(CASE WHEN substr(at, 1, 7) = strftime('%Y-%m', 'now') THEN cost_usd END), 0) AS monthUsd,
          COUNT(*) AS calls
   FROM api_usage`,
);
export function usageSummary(): UsageSummary {
  return usageTotals.get() as UsageSummary;
}

export function gameExists(gameId: number): boolean {
  return db.prepare(`SELECT 1 FROM games WHERE id = ?`).get(gameId) !== undefined;
}

export function storedReview(gameId: number): GameReview | null {
  const row = db.prepare(`SELECT review_json FROM games WHERE id = ?`).get(gameId) as { review_json: string | null } | undefined;
  return row?.review_json ? (JSON.parse(row.review_json) as GameReview) : null;
}

const findMistake = db.prepare(`SELECT id FROM mistakes WHERE game_id = ? AND move_number = ? AND my_move = ?`);
const updateMistake = db.prepare(
  `UPDATE mistakes SET category = @category, pattern = COALESCE(@pattern, pattern), coach_note = @coachNote WHERE id = @id`,
);

/**
 * Stores a review: its tags and explanations replace the live ones on matching mistakes, and
 * moments the live coach did not flag become new mistakes. The review cost is added to the game.
 */
export const saveReview = db.transaction((review: GameReview) => {
  for (const m of review.moments) {
    const existing = findMistake.get(review.gameId, m.moveNumber, m.myMove) as { id: number } | undefined;
    if (existing) {
      updateMistake.run({ id: existing.id, category: m.category, pattern: m.pattern, coachNote: m.explanation });
    } else {
      insertMistake.run({
        gameId: review.gameId,
        moveNumber: m.moveNumber,
        fen: m.fen,
        myMove: m.myMove,
        bestMove: m.bestMove,
        evalBefore: scoreToCp(m.evalBefore),
        evalAfter: scoreToCp(m.evalAfter),
        category: m.category,
        pattern: m.pattern,
        coachNote: m.explanation,
      });
    }
  }
  db.prepare(`UPDATE games SET review_json = ?, coach_cost_usd = coach_cost_usd + ? WHERE id = ?`).run(
    JSON.stringify({ ...review, costUsd: 0 }), // shown again later at no cost
    review.costUsd,
    review.gameId,
  );
});

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

const finishedGames = db.prepare(
  `SELECT id, played_at AS playedAt, result, my_color AS myColor, engine_elo AS engineElo, engine_label AS engineLabel
   FROM games WHERE result != '*' ORDER BY played_at, id`,
);

/** The player's rating, replayed from every finished game (games at unknown strengths are skipped). */
export function playerRating(): RatingSummary {
  const rows = finishedGames.all() as {
    id: number;
    playedAt: string;
    result: RatedGame['result'];
    myColor: 'white' | 'black';
    engineElo: number | null;
    engineLabel: string;
  }[];
  const rated: RatedGame[] = [];
  for (const r of rows) {
    const engineRating = r.engineElo ?? ENGINE_RATINGS[r.engineLabel];
    if (engineRating) {
      rated.push({ id: r.id, playedAt: r.playedAt, engineLabel: r.engineLabel, result: r.result, myColor: r.myColor, engineRating });
    }
  }
  return computeRating(rated);
}

export const dbPath = DB_PATH;
