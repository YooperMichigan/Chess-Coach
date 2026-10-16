import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlGameStore, type SqlDriver, type SqlValue } from '../shared/store-sql.ts';

// The database lives next to the project in data/ (gitignored). Override with CHESS_DB_PATH.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.CHESS_DB_PATH ?? join(root, 'data', 'chess-coach.db');
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

/** better-sqlite3 behind the shared SqlDriver interface (the iPad app uses a Capacitor driver). */
export function betterSqliteDriver(db: Database.Database): SqlDriver {
  const statements = new Map<string, Database.Statement>();
  const prepared = (sql: string) => {
    let s = statements.get(sql);
    if (!s) statements.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      return { lastId: Number(prepared(sql).run(...params).lastInsertRowid) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return prepared(sql).all(...params) as T[];
    },
  };
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const store = new SqlGameStore(betterSqliteDriver(db));
export const dbPath = DB_PATH;
