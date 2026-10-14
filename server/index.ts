import 'dotenv/config';
import express from 'express';
import { PORT } from './config.ts';
import { CoachError, coachChat, coachComment, coachHint, coachReview } from './coach.ts';
import {
  parseChatRequest,
  parseCommentRequest,
  parseHintRequest,
  parseReviewRequest,
  parseSaveGameRequest,
} from './validate.ts';
import {
  dbPath,
  gameExists,
  gameMistakes,
  getSetting,
  mistakeSummary,
  playerRating,
  recentGames,
  saveGame,
  setSetting,
  usageSummary,
} from './db.ts';
import { COACHING_BRIEF_MAX } from './prompts.ts';

const app = express();
// Small bodies everywhere, except the saved game in progress, which has its own larger limit.
const smallJson = express.json({ limit: '16kb' });
app.use((req, res, next) => (req.path === '/api/current-game' ? next() : smallJson(req, res, next)));

/** Wraps a coach route: validate the body (400 on failure), then run the Claude call. */
function coachRoute<Req, Res>(parse: (body: unknown) => Req, run: (req: Req) => Promise<Res>) {
  return async (req: express.Request, res: express.Response) => {
    let parsed: Req;
    try {
      parsed = parse(req.body);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    try {
      res.json(await run(parsed));
    } catch (err) {
      const e = err instanceof CoachError ? err : new CoachError(500, 'Unexpected server error');
      console.error(`[coach] error: ${e.message}`);
      res.status(e.status).json({ error: e.message });
    }
  };
}

app.post('/api/coach/comment', coachRoute(parseCommentRequest, coachComment));
app.post('/api/coach/chat', coachRoute(parseChatRequest, coachChat));
app.post('/api/coach/hint', coachRoute(parseHintRequest, coachHint));
app.post(
  '/api/coach/review',
  coachRoute(
    (body) => {
      const r = parseReviewRequest(body);
      if (!gameExists(r.gameId)) throw new Error('That game is not saved yet');
      return r;
    },
    coachReview,
  ),
);

// ---- Saved games and mistakes (SQLite) ----

/** Clamps a numeric query parameter to [min, max], with a default. */
function intParam(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}

app.post('/api/games', (req, res) => {
  let parsed;
  try {
    parsed = parseSaveGameRequest(req.body);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  try {
    const gameId = saveGame(parsed);
    console.log(`[db] saved game ${gameId}: ${parsed.result}, ${parsed.mistakes.length} mistake(s)`);
    res.json({ gameId });
  } catch (err) {
    console.error('[db] save failed:', err);
    res.status(500).json({ error: 'Could not save the game to the database.' });
  }
});

app.get('/api/games', (req, res) => {
  res.json(recentGames(intParam(req.query.limit, 20, 1, 200)));
});

app.get('/api/games/:id/mistakes', (req, res) => {
  res.json(gameMistakes(intParam(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER)));
});

// Top recurring mistake categories over the last N games.
app.get('/api/mistakes/summary', (req, res) => {
  res.json(mistakeSummary(intParam(req.query.lastN, 10, 1, 500)));
});

// The player's in-app rating, estimated from finished games against Stockfish.
app.get('/api/rating', (_req, res) => {
  res.json(playerRating());
});

// The game in progress, saved after every move so it survives closing the browser or the app.
const CURRENT_GAME_KEY = 'currentGame';
app.get('/api/current-game', (_req, res) => {
  const raw = getSetting(CURRENT_GAME_KEY);
  res.json(raw ? JSON.parse(raw) : null);
});
app.put('/api/current-game', express.json({ limit: '512kb' }), (req, res) => {
  const g = req.body as Record<string, unknown> | null;
  if (!g || g.version !== 1 || !Array.isArray(g.moves) || !g.moves.every((m) => typeof m === 'string' && m.length <= 10)) {
    res.status(400).json({ error: 'Invalid saved game.' });
    return;
  }
  setSetting(CURRENT_GAME_KEY, JSON.stringify(g));
  res.json({ ok: true });
});
app.delete('/api/current-game', (_req, res) => {
  setSetting(CURRENT_GAME_KEY, '');
  res.json({ ok: true });
});

// The coaching brief: the student's goals and preferred coaching style, added to every coach prompt.
app.get('/api/settings', (_req, res) => {
  res.json({ coachingBrief: getSetting('coachingBrief') ?? '' });
});
app.put('/api/settings', (req, res) => {
  const brief = (req.body ?? {}).coachingBrief;
  if (typeof brief !== 'string' || brief.length > COACHING_BRIEF_MAX) {
    res.status(400).json({ error: `The coaching brief must be text of at most ${COACHING_BRIEF_MAX} characters.` });
    return;
  }
  setSetting('coachingBrief', brief.trim());
  res.json({ coachingBrief: brief.trim() });
});

// Estimated Claude API spend recorded by this app (all time and this month).
app.get('/api/usage', (_req, res) => {
  res.json(usageSummary());
});

// Bind to localhost only: this server holds the API key and is for local use.
app.listen(PORT, '127.0.0.1', () => {
  const key = process.env.ANTHROPIC_API_KEY ? 'API key loaded' : 'NO API KEY: copy .env.example to .env';
  console.log(`[server] listening on http://127.0.0.1:${PORT} (${key})`);
  console.log(`[db] ${dbPath}`);
});
