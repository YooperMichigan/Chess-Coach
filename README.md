# Chess Coach

Personal, local-only app: play Stockfish in the browser with Claude as a coach. See `CLAUDE.md` for the full spec and build order.

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

Games are saved automatically when they end (checkmate, draw or resign). A game you abandon with "New game" after making at least one move is saved as unfinished (`*`). The database is `data/chess-coach.db` (gitignored); back it up by copying that file.

Coach settings (eval-drop threshold, check-in interval, per-game cap, your level) are in `src/config.ts` under `COACH`. Model IDs are in `server/config.ts`.

## Status
- [x] Stage 1: playable board vs Stockfish (legal moves, adjustable strength, new game as White/Black, resign)
- [x] Stage 2: eval bar, move list, engine best line (separate full-strength analysis worker, depth 16)
- [x] Stage 3: coach panel (Express + Haiku): comments on eval drops over 80cp, missed mates, every 5th move (toggle), and Ask coach; 25 calls per game cap
- [x] Stage 4: chat box and a three-level hint button (nudge, where to look, show move), resetting each move
- [x] Stage 5: games and mistakes saved to SQLite (`data/chess-coach.db`), with a "Your history" panel showing the most common mistake types over the last 10 games
- [ ] Stage 6: post-game review (Sonnet)

## License note
Stockfish is GPLv3. Fine for personal use; revisit before sharing or publishing.
