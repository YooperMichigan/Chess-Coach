// The single place for model IDs and per-call limits. Swap models here.

export const MODELS = {
  live: 'claude-sonnet-5-5', // per-move comments and hints
  chat: 'claude-sonnet-5-5', // answers to your chat questions
  review: 'claude-opus-5-5', // post-game review
} as const;

// Models that get Anthropic's server-side refusal fallback: if one declines a request on
// policy grounds, the API retries it on a recommended fallback model instead of failing.
// (Haiku 5.5 has no server-side fallback.)
export function usesRefusalFallback(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

// Live comments are 1-3 sentences. The caps leave room for adaptive thinking, which counts
// toward max_tokens.
export const COMMENT_MAX_TOKENS = 2000;
export const COMMENT_EFFORT = 'low' as const;

// Chat answers are 1-4 sentences; the cap leaves room for Sonnet's adaptive thinking.
export const CHAT_MAX_TOKENS = 4000;
export const CHAT_EFFORT = 'low' as const;
export const HINT_MAX_TOKENS = 2000;
export const LIVE_EFFORT = 'low' as const; // hints

// Post-game review (Opus). Medium effort keeps a review to roughly 5-10 cents.
export const REVIEW_MAX_TOKENS = 8000;
export const REVIEW_EFFORT = 'medium' as const;
// Recent games whose mistake categories feed the recurring-weakness summary.
export const REVIEW_HISTORY_GAMES = 10;

// Earlier chat turns sent with each question (token discipline).
export const CHAT_HISTORY_TURNS = 6;

// USD per million tokens, for the in-app cost display (Haiku 5.5 price is for prompts up to
// 100K tokens). Opus 4.8 is listed because it is a possible refusal-fallback model.
// Check current prices at https://platform.claude.com/docs/en/about-claude/pricing
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

export const PORT = Number(process.env.PORT ?? 3001);
