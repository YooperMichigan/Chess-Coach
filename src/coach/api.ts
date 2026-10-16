// The coach and storage calls the UI makes. They go through the active platform (the local
// server on the Mac, or direct API calls and on-device storage on the iPad).
import type {
  CoachChatRequest,
  CoachCommentRequest,
  CoachHintRequest,
  ReviewRequest,
  SaveGameRequest,
  SavedGameState,
} from '../../shared/coach-types';
import { coach, store } from '../platform';

export const requestComment = (body: CoachCommentRequest) => coach.comment(body);
export const requestChat = (body: CoachChatRequest) => coach.chat(body);
export const requestHint = (body: CoachHintRequest) => coach.hint(body);
export const requestReview = (body: ReviewRequest) => coach.review(body);

export const saveGame = (body: SaveGameRequest) => store.saveGame(body);
export const fetchMistakeSummary = (lastN: number) => store.mistakeSummary(lastN);
export const fetchUsage = () => store.usage();
export const fetchCoachingBrief = () => store.coachingBrief();
export const saveCoachingBrief = (brief: string) => store.saveCoachingBrief(brief);
export const fetchRating = () => store.rating();

/** The auto-saved game in progress, or null if there isn't one (or it can't be read). */
export const fetchCurrentGame = () => store.currentGame().catch(() => null);
const saveFailed = (err: unknown) => console.warn('[save] could not save the game in progress:', err instanceof Error ? err.message : err);
export const saveCurrentGame = (state: SavedGameState) => store.saveCurrentGame(state).catch(saveFailed);
export const clearCurrentGame = () => store.clearCurrentGame().catch(saveFailed);

/**
 * Dollar amounts here are often hundredths of a cent, so show the real figure to two
 * significant digits (e.g. $0.000082) instead of rounding it away.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toPrecision(2).replace(/0+$/, '')}`;
}
