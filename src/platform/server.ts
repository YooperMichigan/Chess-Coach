// Mac/web build: everything goes through the local Express server, which holds the API key
// in .env and the SQLite database in data/.
import type { SavedGameState } from '../../shared/coach-types';
import type { CoachClient, GameStore, Platform } from './types';

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

async function get<Res>(path: string, what: string): Promise<Res> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${what} (server error ${res.status}).`);
  return res.json();
}

export class ServerCoachClient implements CoachClient {
  comment = (body: Parameters<CoachClient['comment']>[0]) => post<Awaited<ReturnType<CoachClient['comment']>>>('/api/coach/comment', body);
  chat = (body: Parameters<CoachClient['chat']>[0]) => post<Awaited<ReturnType<CoachClient['chat']>>>('/api/coach/chat', body);
  hint = (body: Parameters<CoachClient['hint']>[0]) => post<Awaited<ReturnType<CoachClient['hint']>>>('/api/coach/hint', body);
  review = (body: Parameters<CoachClient['review']>[0]) => post<Awaited<ReturnType<CoachClient['review']>>>('/api/coach/review', body);
}

export class SqliteServerStore implements GameStore {
  saveGame = (body: Parameters<GameStore['saveGame']>[0]) => post<{ gameId: number }>('/api/games', body);
  mistakeSummary = (lastN: number) => get<Awaited<ReturnType<GameStore['mistakeSummary']>>>(`/api/mistakes/summary?lastN=${lastN}`, 'your history');
  usage = () => get<Awaited<ReturnType<GameStore['usage']>>>('/api/usage', 'API spend');
  rating = () => get<Awaited<ReturnType<GameStore['rating']>>>('/api/rating', 'your rating');

  async coachingBrief(): Promise<string> {
    return (await get<{ coachingBrief: string }>('/api/settings', 'the coaching brief')).coachingBrief;
  }

  async saveCoachingBrief(coachingBrief: string): Promise<string> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachingBrief }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `Could not save (server error ${res.status}).`);
    return data.coachingBrief;
  }

  async currentGame(): Promise<SavedGameState | null> {
    const res = await fetch('/api/current-game');
    if (!res.ok) return null;
    return res.json();
  }

  async saveCurrentGame(state: SavedGameState): Promise<void> {
    const body = JSON.stringify(state);
    await fetch('/api/current-game', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60_000, // lets the last save finish as the page closes (browser cap: 64 KB)
    });
  }

  async clearCurrentGame(): Promise<void> {
    await fetch('/api/current-game', { method: 'DELETE' });
  }
}

export const createPlatform = (): Platform => ({
  coach: new ServerCoachClient(),
  store: new SqliteServerStore(),
  apiKey: null, // the key lives in .env on the server
});
