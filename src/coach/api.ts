import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
  MistakeSummary,
  SaveGameRequest,
  SaveGameResponse,
  UsageSummary,
} from '../../shared/coach-types';

async function post<Res>(path: string, body: unknown): Promise<Res> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the coach server. Is `npm run dev` running?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Coach server error ${res.status}. Is the server running?`);
  }
  return data as Res;
}

export const requestComment = (body: CoachCommentRequest) => post<CoachCommentResponse>('/api/coach/comment', body);
export const requestChat = (body: CoachChatRequest) => post<CoachChatResponse>('/api/coach/chat', body);
export const requestHint = (body: CoachHintRequest) => post<CoachHintResponse>('/api/coach/hint', body);

export const saveGame = (body: SaveGameRequest) => post<SaveGameResponse>('/api/games', body);

export async function fetchMistakeSummary(lastN: number): Promise<MistakeSummary> {
  const res = await fetch(`/api/mistakes/summary?lastN=${lastN}`);
  if (!res.ok) throw new Error(`Could not load your history (server error ${res.status}).`);
  return res.json();
}

export async function fetchUsage(): Promise<UsageSummary> {
  const res = await fetch('/api/usage');
  if (!res.ok) throw new Error(`Could not load API spend (server error ${res.status}).`);
  return res.json();
}

/** Dollar amounts here are fractions of a cent, so show enough digits to see them. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
