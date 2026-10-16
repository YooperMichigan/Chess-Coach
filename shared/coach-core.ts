// The coach's Claude calls: prompts, models, limits, response parsing and cost. Shared by the
// Mac server (key in .env) and the iPad app (key in the Keychain), so both coach the same way.
import type Anthropic from '@anthropic-ai/sdk';
import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
  GameReview,
  MistakeCategory,
  MistakeSummary,
  PatternTag,
  ReviewRequest,
} from './coach-types.ts';
import { PATTERN_TAGS } from './coach-types.ts';
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
} from './coach-config.ts';
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
  patternRecord,
  withBrief,
} from './prompts.ts';
import { COACHING_BRIEF_KEY, type SqlGameStore } from './store-sql.ts';

/** An error the coach itself raises (refusal, truncated or malformed reply), with an HTTP status. */
export class CoachError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CoachDeps {
  client: () => Anthropic; // throws if no key is available
  store: Pick<SqlGameStore, 'getSetting' | 'mistakeSummary' | 'recordUsage' | 'storedReview' | 'saveReview'>;
  /** Returns true to skip the API call (server dry-run mode). */
  dryRun?: (route: string, prompt: string) => boolean;
}

/**
 * Price for the model that answered. The API may report a longer, versioned name than the ID
 * we sent, so match by prefix and fall back to the requested model rather than pricing at $0.
 */
function priceFor(answeredModel: string, requestedModel: string) {
  const byPrefix = (m: string) => PRICING[m] ?? Object.entries(PRICING).find(([id]) => m.startsWith(id))?.[1];
  const price = byPrefix(answeredModel) ?? byPrefix(requestedModel);
  if (!price) console.warn(`[coach] no price configured for ${answeredModel}; cost shown as $0. Add it to PRICING in shared/coach-config.ts.`);
  return price;
}

/** The fields both the regular and the beta Messages API responses share. */
interface ClaudeReply {
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  content: Array<{ type: string; text?: string }>;
}

const asPattern = (v: unknown): PatternTag | null =>
  (PATTERN_TAGS as readonly string[]).includes(v as string) ? (v as PatternTag) : null;
const asCategory = (v: unknown): MistakeCategory | null =>
  (MISTAKE_CATEGORIES as readonly string[]).includes(v as string) ? (v as MistakeCategory) : null;

export function createCoach(deps: CoachDeps) {
  let sessionCostUsd = 0;
  const dryRun = (route: string, prompt: string) => deps.dryRun?.(route, prompt) ?? false;

  /** Logs a call's tokens and estimated cost to the console and the database. Returns the cost. */
  async function logUsage(route: string, model: string, usage: ClaudeReply['usage'], requestedModel: string): Promise<number> {
    const price = priceFor(model, requestedModel);
    const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : 0;
    sessionCostUsd += cost;
    console.log(
      `[coach] ${route} ${model} in=${usage.input_tokens} out=${usage.output_tokens}` +
        ` cost=$${cost.toFixed(5)} session=$${sessionCostUsd.toFixed(4)}`,
    );
    try {
      await deps.store.recordUsage({ route, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: cost });
    } catch (err) {
      console.error('[db] could not record usage:', err);
    }
    return cost;
  }

  /** Logs usage, checks the stop reason, and returns the response text and its cost. */
  async function finish(route: string, message: ClaudeReply, requestedModel: string): Promise<{ text: string; costUsd: number }> {
    // Priced by the model that actually answered (a refusal fallback may have served it).
    const costUsd = await logUsage(route, message.model, message.usage, requestedModel);
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
   * One Claude call with usage logging and cost. Models other than Haiku go through the beta
   * endpoint with the server-side refusal fallback switched on.
   */
  async function callClaude(
    route: string,
    params: Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'> & { model: string },
  ): Promise<{ text: string; costUsd: number }> {
    const fallback = usesRefusalFallback(params.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    return finish(route, await deps.client().beta.messages.create({ ...params, ...fallback }), params.model);
  }

  const brief = () => deps.store.getSetting(COACHING_BRIEF_KEY);
  const history = (): Promise<MistakeSummary> => deps.store.mistakeSummary(REVIEW_HISTORY_GAMES);
  /** The app's pattern counts for the prompt: saved games plus the current game so far. */
  const currentPatternRecord = async (thisGame: PatternTag[]) => patternRecord(await history(), thisGame);

  async function comment(req: CoachCommentRequest): Promise<CoachCommentResponse> {
    const prompt = buildCommentPrompt(req, await currentPatternRecord(req.patternsThisGame));
    if (dryRun('comment', prompt)) {
      // Placeholder tags on mistakes let the save-and-summary path be tested without the API.
      const tagged = req.trigger === 'swing' || req.trigger === 'missed-mate';
      return {
        comment: '(dry run: no API call made)',
        category: tagged ? 'tactical-oversight' : null,
        pattern: tagged ? 'undefended-piece' : null,
        costUsd: 0,
      };
    }
    const { text, costUsd } = await callClaude('comment', {
      model: MODELS.live,
      max_tokens: COMMENT_MAX_TOKENS,
      system: withBrief(COACH_SYSTEM, await brief()),
      output_config: { effort: COMMENT_EFFORT, format: { type: 'json_schema', schema: COMMENT_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
    let parsed: { comment: string; category: string; pattern: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CoachError(502, 'The coach returned malformed output.');
    }
    return { comment: parsed.comment.trim(), category: asCategory(parsed.category), pattern: asPattern(parsed.pattern), costUsd };
  }

  async function chat(req: CoachChatRequest): Promise<CoachChatResponse> {
    const prompt = buildChatPrompt(req, await currentPatternRecord(req.patternsThisGame));
    if (dryRun('chat', prompt)) return { reply: '(dry run: no API call made)', costUsd: 0 };
    // Earlier turns go in as plain text; only the newest question carries the position data.
    const turns: Anthropic.Beta.Messages.BetaMessageParam[] = req.history
      .slice(-CHAT_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.text }));
    // The API needs the first message to be from the user.
    while (turns.length && turns[0].role !== 'user') turns.shift();
    const { text: reply, costUsd } = await callClaude('chat', {
      model: MODELS.chat,
      max_tokens: CHAT_MAX_TOKENS,
      system: withBrief(CHAT_SYSTEM, await brief()),
      output_config: { effort: CHAT_EFFORT },
      messages: [...turns, { role: 'user', content: prompt }],
    });
    return { reply, costUsd };
  }

  async function hint(req: CoachHintRequest): Promise<CoachHintResponse> {
    const prompt = buildHintPrompt(req);
    if (dryRun('hint', prompt)) return { hint: `(dry run: level ${req.level} hint, no API call made)`, costUsd: 0 };
    const { text, costUsd } = await callClaude(`hint-${req.level}`, {
      model: MODELS.live,
      max_tokens: HINT_MAX_TOKENS,
      system: withBrief(HINT_SYSTEM, await brief()),
      output_config: { effort: LIVE_EFFORT },
      messages: [{ role: 'user', content: prompt }],
    });
    return { hint: text, costUsd };
  }

  async function review(req: ReviewRequest): Promise<GameReview> {
    const stored = await deps.store.storedReview(req.gameId);
    if (stored) return stored; // already reviewed: show it again at no cost
    const prompt = buildReviewPrompt(req, await history());
    let parsed: {
      moments: { index: number; explanation: string; category: string; pattern: string }[];
      summary: string;
      recurring: string;
      focus: string;
    };
    let costUsd = 0;
    if (dryRun('review', prompt)) {
      parsed = {
        moments: req.moments.map((_, index) => ({
          index,
          explanation: '(dry run: no API call made)',
          category: 'tactical-oversight',
          pattern: 'fork',
        })),
        summary: '(dry run summary)',
        recurring: '(dry run recurring weaknesses)',
        focus: '(dry run focus)',
      };
    } else {
      const result = await callClaude('review', {
        model: MODELS.review,
        max_tokens: REVIEW_MAX_TOKENS,
        system: withBrief(REVIEW_SYSTEM, await brief()),
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
    const out: GameReview = {
      gameId: req.gameId,
      moments: req.moments.map((m, i) => {
        const r = byIndex.get(i);
        return {
          ...m,
          explanation: r?.explanation.trim() || 'No explanation was returned for this moment.',
          category: asCategory(r?.category),
          pattern: asPattern(r?.pattern),
        };
      }),
      summary: parsed.summary.trim(),
      recurring: parsed.recurring.trim(),
      focus: parsed.focus.trim(),
      costUsd,
    };
    await deps.store.saveReview(out);
    return out;
  }

  return { comment, chat, hint, review };
}

export type Coach = ReturnType<typeof createCoach>;
