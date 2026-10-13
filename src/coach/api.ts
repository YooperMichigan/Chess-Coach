import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachCommentRequest,
  CoachCommentResponse,
  CoachHintRequest,
  CoachHintResponse,
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
