import Anthropic from '@anthropic-ai/sdk';
import { CoachError, createCoach } from '../shared/coach-core.ts';
import { store } from './db.ts';

export { CoachError };

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Created lazily so the server starts (and explains itself) even without a key.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new CoachError(500, 'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  client ??= new Anthropic();
  return client;
}

function dryRun(route: string, prompt: string): boolean {
  if (!process.env.COACH_DRY_RUN) return false;
  console.log(`[coach] dry run (${route}), prompt:\n${prompt}`);
  return true;
}

const coach = createCoach({ client: getClient, store, dryRun });

/** Runs a coach call, turning API errors into a CoachError with a status for the response. */
const guarded =
  <Req, Res>(fn: (req: Req) => Promise<Res>) =>
  async (req: Req): Promise<Res> => {
    try {
      return await fn(req);
    } catch (err) {
      throw toCoachError(err);
    }
  };

export const coachComment = guarded(coach.comment);
export const coachChat = guarded(coach.chat);
export const coachHint = guarded(coach.hint);
export const coachReview = guarded(coach.review);

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
