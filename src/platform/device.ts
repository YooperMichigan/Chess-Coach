// iPad build: no server. The coach calls the Anthropic API straight from the app with the key
// from the iOS Keychain, and games are kept in a SQLite database on the device.
import Anthropic from '@anthropic-ai/sdk';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { CoachError, createCoach, type Coach } from '../../shared/coach-core';
import { COACHING_BRIEF_MAX } from '../../shared/prompts';
import { COACHING_BRIEF_KEY, SqlGameStore, type SqlDriver } from '../../shared/store-sql';
import type { SavedGameState } from '../../shared/coach-types';
import { CoachUnavailableError, type ApiKeyManager, type CoachClient, type GameStore, type Platform } from './types';

// ---- On-device SQLite ----

const DB_NAME = 'chesscoach';

async function connectSqlite(): Promise<SqlDriver> {
  if (!Capacitor.isNativePlatform()) return browserPreviewDriver();
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const db =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await db.open();
  await db.execute('PRAGMA foreign_keys = ON;', false);
  return {
    async exec(sql) {
      // Transactions go through the plugin's own calls so it knows one is open.
      if (sql === 'BEGIN') await db.beginTransaction();
      else if (sql === 'COMMIT') await db.commitTransaction();
      else if (sql === 'ROLLBACK') await db.rollbackTransaction();
      else await db.execute(sql, false);
    },
    async run(sql, params = []) {
      const res = await db.run(sql, params, false);
      return { lastId: res.changes?.lastId ?? 0 };
    },
    async all<T>(sql: string, params: (string | number | null)[] = []) {
      return ((await db.query(sql, params)).values ?? []) as T[];
    },
  };
}

/**
 * Running the iOS build in a desktop browser (for testing) has no native SQLite. A test
 * harness can supply one as window.__chessCoachSql; otherwise storage reports unavailable.
 */
function browserPreviewDriver(): SqlDriver {
  type Bridge = (op: 'exec' | 'run' | 'all', sql: string, params: unknown[]) => Promise<unknown>;
  const bridge = (window as unknown as { __chessCoachSql?: Bridge }).__chessCoachSql;
  if (!bridge) throw new Error('On-device storage is only available in the iPad app.');
  return {
    exec: async (sql) => void (await bridge('exec', sql, [])),
    run: async (sql, params = []) => (await bridge('run', sql, params)) as { lastId: number },
    all: async <T,>(sql: string, params: unknown[] = []) => (await bridge('all', sql, params)) as T[],
  };
}

/** Connects on first use, so the app starts even if the database is slow to open. */
function lazyDriver(connect: () => Promise<SqlDriver>): SqlDriver {
  let conn: Promise<SqlDriver> | null = null;
  const get = () => (conn ??= connect());
  return {
    exec: async (sql) => (await get()).exec(sql),
    run: async (sql, params) => (await get()).run(sql, params),
    all: async <T,>(sql: string, params?: (string | number | null)[]) => (await get()).all<T>(sql, params),
  };
}

class DeviceStore implements GameStore {
  constructor(private db: SqlGameStore) {}
  saveGame = async (req: Parameters<GameStore['saveGame']>[0]) => ({ gameId: await this.db.saveGame(req) });
  mistakeSummary = (lastN: number) => this.db.mistakeSummary(lastN);
  usage = () => this.db.usageSummary();
  rating = () => this.db.playerRating();
  coachingBrief = async () => (await this.db.getSetting(COACHING_BRIEF_KEY)) ?? '';
  async saveCoachingBrief(brief: string): Promise<string> {
    if (brief.length > COACHING_BRIEF_MAX) throw new Error(`The coaching brief must be at most ${COACHING_BRIEF_MAX} characters.`);
    await this.db.setSetting(COACHING_BRIEF_KEY, brief.trim());
    return brief.trim();
  }
  currentGame = () => this.db.currentGame();
  saveCurrentGame = (state: SavedGameState) => this.db.saveCurrentGame(state);
  clearCurrentGame = () => this.db.clearCurrentGame();
}

// ---- API key in the iOS Keychain ----
// Never logged, never put in an error message, never shown in full after entry.

const KEYCHAIN_ITEM = 'anthropic-api-key';

/** A client that talks to the API from the app itself (adds the direct-browser-access header). */
const apiClient = (apiKey: string) =>
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 180_000 });

class KeychainApiKey implements ApiKeyManager {
  private key: string | null | undefined; // undefined = not read from the Keychain yet

  async get(): Promise<string | null> {
    if (this.key === undefined) {
      const stored = await SecureStorage.get(KEYCHAIN_ITEM, false, false).catch(() => null);
      this.key = typeof stored === 'string' && stored ? stored : null;
    }
    return this.key;
  }

  async masked(): Promise<string | null> {
    const key = await this.get();
    return key ? `sk-ant-…${key.slice(-4)}` : null;
  }

  async replace(raw: string): Promise<void> {
    const key = raw.trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error('That does not look like an Anthropic API key (they start with sk-ant-).');
    if (navigator.onLine === false) throw new Error('No internet connection. Connect to check the key.');
    try {
      await apiClient(key).models.list({ limit: 1 }); // free: lists models, costs no tokens
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('The API rejected that key. Check that you copied all of it.');
      if (err instanceof Anthropic.PermissionDeniedError) throw new Error('That key is not allowed to use the API.');
      if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the API. Check your connection.');
      if (err instanceof Anthropic.APIError) throw new Error(`Could not check the key (API error ${err.status}).`);
      throw new Error('Could not check the key.');
    }
    // This device only: not synced to iCloud Keychain and not restored onto another device.
    await SecureStorage.set(KEYCHAIN_ITEM, key, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
    this.key = key;
  }

  async remove(): Promise<void> {
    await SecureStorage.remove(KEYCHAIN_ITEM, false);
    this.key = null;
  }
}

// ---- Coach: direct API calls ----

class NoKeyError extends Error {}
class OfflineError extends Error {}

/** A short, key-free reason for the coach panel. */
function unavailable(err: unknown): Error {
  if (err instanceof CoachError) return err; // refusal, truncated or malformed reply: not an outage
  const reason = (() => {
    if (err instanceof NoKeyError) return 'no API key. Add one under "API key" in the coach panel.';
    if (err instanceof Anthropic.AuthenticationError) return 'the API key was rejected. Replace it under "API key".';
    if (err instanceof Anthropic.PermissionDeniedError) return 'the API key is not allowed to use this model.';
    if (err instanceof Anthropic.RateLimitError) return 'rate limit reached. Try again in a minute.';
    if (err instanceof OfflineError) return 'no internet connection.';
    if (err instanceof Anthropic.APIConnectionError) return 'no connection to the API.';
    if (err instanceof Anthropic.APIError) {
      if (err.status === 402) return 'out of API credit. Add credit in the Claude Console.';
      if (err.status === 529 || (err.status ?? 0) >= 500) return 'the API is busy. Try again shortly.';
      // A 400 here includes hitting your own monthly spend limit.
      if (/usage limit|credit balance/i.test(err.message)) return 'API spend limit or credit reached. Check the Claude Console.';
      return `the API rejected the request (error ${err.status}).`;
    }
    return 'unexpected error.';
  })();
  if (!(err instanceof NoKeyError || err instanceof OfflineError)) console.warn(`[coach] unavailable: ${err instanceof Error ? err.name : 'error'}`);
  return new CoachUnavailableError(`Coach unavailable: ${reason}`);
}

class DirectCoachClient implements CoachClient {
  private client: Anthropic | null = null;
  private clientKey: string | null = null;
  private coach: Coach;

  constructor(
    private store: SqlGameStore,
    private keys: KeychainApiKey,
  ) {
    this.coach = createCoach({
      client: () => {
        if (!this.client) throw new NoKeyError();
        return this.client;
      },
      store,
    });
  }

  /** Loads the key (once) and runs the call, turning failures into "Coach unavailable: …". */
  private async call<Req, Res>(fn: (req: Req) => Promise<Res>, req: Req): Promise<Res> {
    try {
      if (navigator.onLine === false) throw new OfflineError();
      const key = await this.keys.get();
      if (!key) throw new NoKeyError();
      if (key !== this.clientKey) {
        this.client = apiClient(key);
        this.clientKey = key;
      }
      return await fn(req);
    } catch (err) {
      throw unavailable(err);
    }
  }

  comment = (req: Parameters<CoachClient['comment']>[0]) => this.call(this.coach.comment, req);
  chat = (req: Parameters<CoachClient['chat']>[0]) => this.call(this.coach.chat, req);
  hint = (req: Parameters<CoachClient['hint']>[0]) => this.call(this.coach.hint, req);
  review = async (req: Parameters<CoachClient['review']>[0]) => {
    if (!(await this.store.gameExists(req.gameId))) throw new Error('That game is not saved yet.');
    // A game reviewed before opens from the device, with no connection needed.
    return (await this.store.storedReview(req.gameId)) ?? this.call(this.coach.review, req);
  };
}

export const createPlatform = (): Platform => {
  const db = new SqlGameStore(lazyDriver(connectSqlite));
  const keys = new KeychainApiKey();
  return { coach: new DirectCoachClient(db, keys), store: new DeviceStore(db), apiKey: keys };
};
