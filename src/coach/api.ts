import type { CoachCommentRequest, CoachCommentResponse } from '../../shared/coach-types';

export async function requestComment(body: CoachCommentRequest): Promise<CoachCommentResponse> {
  let res: Response;
  try {
    res = await fetch('/api/coach/comment', {
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
  return data as CoachCommentResponse;
}
