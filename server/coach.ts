import Anthropic from '@anthropic-ai/sdk';
import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
  GameReview,
  MistakeCategory,
  ReviewRequest,
} from '../shared/coach-types.ts';
import {
  CHAT_EFFORT,
  CHAT_HISTORY_TURNS,
  CHAT_MAX_TOKENS,
  COMMENT_EFFORT,
  COMMENT_MAX_TOKENS,
  HINT_MAX_TOKENS,
  LIVE_EFFORT,
  MODELS,
  PRICING,
  REVIEW_EFFORT,
  REVIEW_HISTORY_GAMES,
  REVIEW_MAX_TOKENS,
  usesRefusalFallback,
} from './config.ts';
import {
  CHAT_SYSTEM,
  COACH_SYSTEM,
  COMMENT_SCHEMA,
  HINT_SYSTEM,
  MISTAKE_CATEGORIES,
  REVIEW_SCHEMA,
  REVIEW_SYSTEM,
  buildChatPrompt,
  buildCommentPrompt,
  buildHintPrompt,
  buildReviewPrompt,
} from './prompts.ts';
import { mistakeSummary, recordUsage, saveReview, storedReview } from './db.ts';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Created lazily so the server starts (and explains itself) even without a key.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new CoachError(500, 'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  client ??= new Anthropic();
  return client;
}

export class CoachError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let sessionCostUsd = 0;

/** Logs a call's tokens and estimated cost to the terminal and the database. Returns the cost. */
/**
 * Price for the model that answered. The API may report a longer, versioned name than the ID
 * we sent, so match by prefix and fall back to the requested model rather than pricing at $0.
 */
function priceFor(answeredModel: string, requestedModel: string) {
  const byPrefix = (m: string) =>
    PRICING[m] ?? Object.entries(PRICING).find(([id]) => m.startsWith(id))?.[1];
  const price = byPrefix(answeredModel) ?? byPrefix(requestedModel);
  if (!price) console.warn(`[coach] no price configured for ${answeredModel}; cost shown as $0. Add it to PRICING in server/config.ts.`);
  return price;
}

function logUsage(route: string, model: string, usage: Anthropic.Usage, requestedModel = model): number {
  const price = priceFor(model, requestedModel);
  const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : 0;
  sessionCostUsd += cost;
  console.log(
    `[coach] ${route} ${model} in=${usage.input_tokens} out=${usage.output_tokens}` +
      ` cost=$${cost.toFixed(5)} session=$${sessionCostUsd.toFixed(4)}`,
  );
  try {
    recordUsage({ route, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: cost });
  } catch (err) {
    console.error('[db] could not record usage:', err);
  }
  return cost;
}

/** The fields both the regular and the beta Messages API responses share. */
interface ClaudeReply {
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  content: Array<{ type: string; text?: string }>;
}

/** Logs usage, checks the stop reason, and returns the response text and its cost. */
function finish(route: string, message: ClaudeReply, requestedModel: string): { text: string; costUsd: number } {
  // Priced by the model that actually answered (a refusal fallback may have served it).
  const costUsd = logUsage(route, message.model, message.usage as Anthropic.Usage, requestedModel);
  if (message.stop_reason === 'refusal') throw new CoachError(502, 'The coach declined to answer this one.');
  if (message.stop_reason === 'max_tokens') throw new CoachError(502, 'The coach ran out of room to answer. Try again.');
  // Thinking blocks may come first; read only the text blocks.
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) throw new CoachError(502, 'The coach returned no text.');
  return { text, costUsd };
}

/**
 * One Claude call with shared error handling, usage logging and cost. Models other than Haiku
 * go through the beta endpoint with the server-side refusal fallback switched on.
 */
async function callClaude(
  route: string,
  params: Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'> & {
    model: string;
  },
): Promise<{ text: string; costUsd: number }> {
  try {
    const fallback = usesRefusalFallback(params.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    return finish(route, await getClient().beta.messages.create({ ...params, ...fallback }), params.model);
  } catch (err) {
    throw toCoachError(err);
  }
}

function dryRun(route: string, prompt: string): boolean {
  if (!process.env.COACH_DRY_RUN) return false;
  console.log(`[coach] dry run (${route}), prompt:\n${prompt}`);
  return true;
}

export async function coachComment(req: CoachCommentRequest): Promise<CoachCommentResponse> {
  const prompt = buildCommentPrompt(req);
  if (dryRun('comment', prompt)) {
    // A placeholder tag on mistakes lets the save-and-summary path be tested without the API.
    const tagged = req.trigger === 'swing' || req.trigger === 'missed-mate';
    return { comment: '(dry run: no API call made)', category: tagged ? 'tactical-oversight' : null, costUsd: 0 };
  }
  const { text, costUsd } = await callClaude('comment', {
    model: MODELS.live,
    max_tokens: COMMENT_MAX_TOKENS,
    system: COACH_SYSTEM,
    output_config: { effort: COMMENT_EFFORT, format: { type: 'json_schema', schema: COMMENT_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  let parsed: { comment: string; category: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CoachError(502, 'The coach returned malformed output.');
  }
  const category = (MISTAKE_CATEGORIES as readonly string[]).includes(parsed.category)
    ? (parsed.category as MistakeCategory)
    : null;
  return { comment: parsed.comment.trim(), category, costUsd };
}

export async function coachChat(req: CoachChatRequest): Promise<CoachChatResponse> {
  const prompt = buildChatPrompt(req);
  if (dryRun('chat', prompt)) return { reply: '(dry run: no API call made)', costUsd: 0 };
  // Earlier turns go in as plain text; only the newest question carries the position data.
  const history: Anthropic.Beta.Messages.BetaMessageParam[] = req.history
    .slice(-CHAT_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.text }));
  // The API needs the first message to be from the user.
  while (history.length && history[0].role !== 'user') history.shift();
  const { text: reply, costUsd } = await callClaude('chat', {
    model: MODELS.chat,
    max_tokens: CHAT_MAX_TOKENS,
    system: CHAT_SYSTEM,
    output_config: { effort: CHAT_EFFORT },
    messages: [...history, { role: 'user', content: prompt }],
  });
  return { reply, costUsd };
}

export async function coachReview(req: ReviewRequest): Promise<GameReview> {
  const stored = storedReview(req.gameId);
  if (stored) return stored; // already reviewed: show it again at no cost
  const history = mistakeSummary(REVIEW_HISTORY_GAMES);
  const prompt = buildReviewPrompt(req, history);
  let parsed: { moments: { index: number; explanation: string; category: string }[]; summary: string; recurring: string; focus: string };
  let costUsd = 0;
  if (dryRun('review', prompt)) {
    parsed = {
      moments: req.moments.map((_, index) => ({ index, explanation: '(dry run: no API call made)', category: 'tactical-oversight' })),
      summary: '(dry run summary)',
      recurring: '(dry run recurring weaknesses)',
      focus: '(dry run focus)',
    };
  } else {
    const result = await callClaude('review', {
      model: MODELS.review,
      max_tokens: REVIEW_MAX_TOKENS,
      system: REVIEW_SYSTEM,
      output_config: { effort: REVIEW_EFFORT, format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
    costUsd = result.costUsd;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new CoachError(502, 'The review came back malformed. Try again.');
    }
  }
  const byIndex = new Map(parsed.moments.map((m) => [m.index, m]));
  const review: GameReview = {
    gameId: req.gameId,
    moments: req.moments.map((m, i) => {
      const r = byIndex.get(i);
      const category = r && (MISTAKE_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as MistakeCategory) : null;
      return { ...m, explanation: r?.explanation.trim() || 'No explanation was returned for this moment.', category };
    }),
    summary: parsed.summary.trim(),
    recurring: parsed.recurring.trim(),
    focus: parsed.focus.trim(),
    costUsd,
  };
  saveReview(review);
  return review;
}

export async function coachHint(req: CoachHintRequest): Promise<CoachHintResponse> {
  const prompt = buildHintPrompt(req);
  if (dryRun('hint', prompt)) return { hint: `(dry run: level ${req.level} hint, no API call made)`, costUsd: 0 };
  const { text: hint, costUsd } = await callClaude(`hint-${req.level}`, {
    model: MODELS.live,
    max_tokens: HINT_MAX_TOKENS,
    system: HINT_SYSTEM,
    output_config: { effort: LIVE_EFFORT },
    messages: [{ role: 'user', content: prompt }],
  });
  return { hint, costUsd };
}

function toCoachError(err: unknown): CoachError {
  if (err instanceof CoachError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new CoachError(500, 'The API key in .env was rejected. Check ANTHROPIC_API_KEY.');
  if (err instanceof Anthropic.PermissionDeniedError) return new CoachError(500, 'The API key lacks permission for this model.');
  if (err instanceof Anthropic.RateLimitError) {
    return new CoachError(429, 'Rate or spend limit reached on your API account. Check the Billing page in the Claude Console.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    // Includes the "specified API usage limits" error when your own spend limit is hit.
    return new CoachError(502, `The API rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new CoachError(502, 'Could not reach the Claude API. Check your connection.');
  if (err instanceof Anthropic.APIError) return new CoachError(502, `Claude API error ${err.status}: ${err.message}`);
  return new CoachError(500, err instanceof Error ? err.message : 'Unknown error');
}
