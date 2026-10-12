// The single place for model IDs and per-call limits. Swap models here.

export const MODELS = {
  live: 'claude-haiku-5-5', // per-move comments, chat, hints
  review: 'claude-sonnet-5-5', // post-game review (Stage 6)
} as const;

// Live comments are 1-3 sentences. The cap leaves room for Haiku 5.5's adaptive thinking,
// which counts toward max_tokens.
export const COMMENT_MAX_TOKENS = 1024;
export const COMMENT_EFFORT = 'low' as const;

// USD per million tokens, for the console cost log only (Haiku 5.5, prompts <= 100K tokens).
// Check current prices at https://platform.claude.com/docs/en/about-claude/pricing
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

export const PORT = Number(process.env.PORT ?? 3001);
