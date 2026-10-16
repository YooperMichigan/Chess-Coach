// The two seams between the UI and the outside world. The Mac/web build talks to the Express
// server; the iPad build calls the Anthropic API directly and stores data on the device.
// UI code only ever sees these interfaces (via src/platform/index.ts).
import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
  GameReview,
  MistakeSummary,
  ReviewRequest,
  SaveGameRequest,
  SavedGameState,
  UsageSummary,
} from '../../shared/coach-types';
import type { RatingSummary } from '../../shared/rating';

/** The coach could not be reached (no key, offline, out of credit…). Nothing was spent. */
export class CoachUnavailableError extends Error {
  name = 'CoachUnavailableError';
}

/** Sends coach, chat, hint and review requests. Errors are thrown with a message fit to show. */
export interface CoachClient {
  comment(req: CoachCommentRequest): Promise<CoachCommentResponse>;
  chat(req: CoachChatRequest): Promise<CoachChatResponse>;
  hint(req: CoachHintRequest): Promise<CoachHintResponse>;
  review(req: ReviewRequest): Promise<GameReview>;
}

/** Saved games, mistakes and pattern tags, plus the settings and spend that go with them. */
export interface GameStore {
  saveGame(req: SaveGameRequest): Promise<{ gameId: number }>;
  mistakeSummary(lastN: number): Promise<MistakeSummary>;
  usage(): Promise<UsageSummary>;
  rating(): Promise<RatingSummary>;
  coachingBrief(): Promise<string>;
  saveCoachingBrief(brief: string): Promise<string>;
  currentGame(): Promise<SavedGameState | null>;
  saveCurrentGame(state: SavedGameState): Promise<void>;
  clearCurrentGame(): Promise<void>;
}

/** The API key, where the app holds one itself (the iPad build). Never returns the full key. */
export interface ApiKeyManager {
  /** Masked form such as "sk-ant-…3fQx", or null when no key is stored. */
  masked(): Promise<string | null>;
  /** Checks the key with one free API request, then stores it. Throws a readable error. */
  replace(key: string): Promise<void>;
  remove(): Promise<void>;
}

export interface Platform {
  coach: CoachClient;
  store: GameStore;
  apiKey: ApiKeyManager | null; // null when the server holds the key
}
