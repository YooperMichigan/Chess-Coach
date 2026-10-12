import 'dotenv/config';
import express from 'express';
import { PORT } from './config.ts';
import { CoachError, coachComment } from './coach.ts';
import { parseCommentRequest } from './validate.ts';

const app = express();
app.use(express.json({ limit: '16kb' }));

app.post('/api/coach/comment', async (req, res) => {
  let parsed;
  try {
    parsed = parseCommentRequest(req.body);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  try {
    res.json(await coachComment(parsed));
  } catch (err) {
    const e = err instanceof CoachError ? err : new CoachError(500, 'Unexpected server error');
    console.error(`[coach] error: ${e.message}`);
    res.status(e.status).json({ error: e.message });
  }
});

// Bind to localhost only: this server holds the API key and is for local use.
app.listen(PORT, '127.0.0.1', () => {
  const key = process.env.ANTHROPIC_API_KEY ? 'API key loaded' : 'NO API KEY: copy .env.example to .env';
  console.log(`[server] listening on http://127.0.0.1:${PORT} (${key})`);
});
