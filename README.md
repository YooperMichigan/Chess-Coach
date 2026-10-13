# Chess Coach

Personal, local-only app: play Stockfish in the browser with Claude as a coach. See `CLAUDE.md` for the full spec and build order.

## Starting the app
Double-click **Start Chess Coach** in the project folder. It updates the app, starts it, and opens it in your browser. Leave the Terminal window it opens running while you play; close it to stop the app. Drag it to the right-hand side of the Dock for one-click access.

## Training features
- **Opening trainer** (under the board): pick the London System (White) or the Sicilian Dragon (Black). It shows the book line as the game goes, with the idea behind every move, what the book plays next, and where you or Stockfish left the book; out of book it shows the set-up checklist and typical plans. Optionally Stockfish plays book replies so the openings actually arise. The repertoire lives in `src/openings/book.ts`.
- **Coaching brief** (in the coach panel): tell the coach your goals and how you like to be coached. It's stored in the database and added to every coach prompt; the coach's rules still take priority.
- **Your rating** (top right): an Elo-style rating from finished games against Stockfish, starting at 1200. Skill Level settings use estimated strengths (`shared/rating.ts`). The coach is told your rating.

## Setup
```bash
npm install
cp .env.example .env   # then paste your ANTHROPIC_API_KEY into .env
npm run dev            # web app (http://localhost:5173) + coach server (port 3001)
```
`npm run dev` copies the Stockfish WASM files into `public/stockfish/`, then starts Vite and the Express coach server together. Token usage and cost for every coach call are logged in that terminal (`[coach] ...` lines).

Other commands:
- `npm run server`: coach server only
- `npm run coach:test`: with the server running, sends one hardcoded blunder (1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5??) to the coach, asks for all three hint levels in the position before it, and asks one chat question, using real Stockfish evals
- `npm run typecheck`

The coach panel shows the estimated API cost of the current game, and the history panel shows the total spent in the app and this month. Every Claude call is recorded in the `api_usage` table. Costs are estimates from token counts and the prices in `server/config.ts`; the Claude Console shows what you are actually billed.

After a game ends, press **Review this game**. Reviews are stored with the game, so opening one again costs nothing. A review costs roughly 5-10 cents (Opus 5.5). Live comments, hints and chat use Sonnet 5.5, a few cents per game.

Games are saved automatically when they end (checkmate, draw or resign). A game you abandon with "New game" after making at least one move is saved as unfinished (`*`). The database is `data/chess-coach.db` (gitignored); back it up by copying that file.

Coach settings (eval-drop threshold, check-in interval, per-game cap, your level) are in `src/config.ts` under `COACH`. Model IDs are in `server/config.ts`.

## Status
- [x] Stage 1: playable board vs Stockfish (legal moves, adjustable strength, new game as White/Black, resign)
- [x] Stage 2: eval bar, move list, engine best line (separate full-strength analysis worker, depth 16)
- [x] Stage 3: coach panel (Express + Haiku): comments on eval drops over 80cp, missed mates, every 5th move (toggle), and Ask coach; 25 calls per game cap
- [x] Stage 4: chat box and a three-level hint button (nudge, where to look, show move), resetting each move
- [x] Stage 5: games and mistakes saved to SQLite (`data/chess-coach.db`), with a "Your history" panel showing the most common mistake types over the last 10 games
- [x] Stage 6: post-game review: a Stockfish pass finds your 3-5 costliest moves (by lost winning chances), and Opus explains each one, summarises the game and your recurring weaknesses, and suggests one thing to work on

## License note
Stockfish is GPLv3. Fine for personal use; revisit before sharing or publishing.
