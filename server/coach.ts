import Anthropic from '@anthropic-ai/sdk';
import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
  MistakeCategory,
} from '../shared/coach-types.ts';
import {
  CHAT_HISTORY_TURNS,
  CHAT_MAX_TOKENS,
  COMMENT_EFFORT,
  COMMENT_MAX_TOKENS,
  HINT_MAX_TOKENS,
  LIVE_EFFORT,
  MODELS,
  PRICING,
} from './config.ts';
import {
  CHAT_SYSTEM,
  COACH_SYSTEM,
  COMMENT_SCHEMA,
  HINT_SYSTEM,
  MISTAKE_CATEGORIES,
  buildChatPrompt,
  buildCommentPrompt,
  buildHintPrompt,
} from './prompts.ts';
import { recordUsage } from './db.ts';

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
function logUsage(route: string, model: string, usage: Anthropic.Usage): number {
  const price = PRICING[model];
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

/** One Haiku/Sonnet call with shared error handling and usage logging. Returns the text output. */
async function callClaude(
  route: string,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'> & { model: string },
): Promise<{ text: string; costUsd: number }> {
  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create(params);
  } catch (err) {
    throw toCoachError(err);
  }
  const costUsd = logUsage(route, params.model, message.usage);
  if (message.stop_reason === 'refusal') throw new CoachError(502, 'The coach declined to answer this one.');
  if (message.stop_reason === 'max_tokens') throw new CoachError(502, 'The coach ran out of room to answer. Try again.');
  // Haiku 5.5 may return thinking blocks first; read only the text blocks.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new CoachError(502, 'The coach returned no text.');
  return { text, costUsd };
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
  const history: Anthropic.MessageParam[] = req.history
    .slice(-CHAT_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.text }));
  // The API needs the first message to be from the user.
  while (history.length && history[0].role !== 'user') history.shift();
  const { text: reply, costUsd } = await callClaude('chat', {
    model: MODELS.live,
    max_tokens: CHAT_MAX_TOKENS,
    system: CHAT_SYSTEM,
    output_config: { effort: LIVE_EFFORT },
    messages: [...history, { role: 'user', content: prompt }],
  });
  return { reply, costUsd };
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
