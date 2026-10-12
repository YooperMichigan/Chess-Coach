import Anthropic from '@anthropic-ai/sdk';
import type { CoachCommentRequest, CoachCommentResponse, MistakeCategory } from '../shared/coach-types.ts';
import { COMMENT_EFFORT, COMMENT_MAX_TOKENS, MODELS, PRICING } from './config.ts';
import { COACH_SYSTEM, COMMENT_SCHEMA, MISTAKE_CATEGORIES, buildCommentPrompt } from './prompts.ts';

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

function logUsage(route: string, model: string, usage: Anthropic.Usage) {
  const price = PRICING[model];
  const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : 0;
  sessionCostUsd += cost;
  console.log(
    `[coach] ${route} ${model} in=${usage.input_tokens} out=${usage.output_tokens}` +
      ` cost=$${cost.toFixed(5)} session=$${sessionCostUsd.toFixed(4)}`,
  );
}

export async function coachComment(req: CoachCommentRequest): Promise<CoachCommentResponse> {
  const prompt = buildCommentPrompt(req);
  if (process.env.COACH_DRY_RUN) {
    console.log('[coach] dry run, prompt:\n' + prompt);
    return { comment: '(dry run: no API call made)', category: null };
  }
  const model = MODELS.live;
  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create({
      model,
      max_tokens: COMMENT_MAX_TOKENS,
      system: COACH_SYSTEM,
      output_config: { effort: COMMENT_EFFORT, format: { type: 'json_schema', schema: COMMENT_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    throw toCoachError(err);
  }
  logUsage('comment', model, message.usage);

  if (message.stop_reason === 'refusal') throw new CoachError(502, 'The coach declined to answer this one.');
  if (message.stop_reason === 'max_tokens') throw new CoachError(502, 'The coach ran out of room to answer. Try again.');
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) throw new CoachError(502, 'The coach returned no text.');
  let parsed: { comment: string; category: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CoachError(502, 'The coach returned malformed output.');
  }
  const category = (MISTAKE_CATEGORIES as readonly string[]).includes(parsed.category)
    ? (parsed.category as MistakeCategory)
    : null;
  return { comment: parsed.comment.trim(), category };
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
