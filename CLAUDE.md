# CLAUDE.md: Chess Coach App

## Project summary
A personal-use web app where I play chess against Stockfish and Claude acts as a live coach inside the app. Claude comments during the game, answers questions, gives graded hints, and reviews finished games. This is a single-user, local-only project. It will never be distributed or deployed publicly.

## Core principle
**Stockfish does all chess calculation. Claude does all explanation.**
Claude must never be asked to evaluate a position, find a best move, or verify legality on its own. Every number, evaluation, and best line given to Claude comes from Stockfish. chess.js is the source of truth for legality and board state.

## Tech stack
- **Frontend:** Vite + React + TypeScript
- **Board UI:** react-chessboard
- **Rules and state:** chess.js
- **Engine:** Stockfish WASM (npm `stockfish`) running in a Web Worker. Strength set via UCI options `Skill Level` or `UCI_LimitStrength` + `UCI_Elo`.
- **Backend:** Node + Express (small server whose only jobs are the Claude API proxy and SQLite access)
- **Storage:** SQLite via better-sqlite3
- **Claude API:** official `@anthropic-ai/sdk`, called from the backend only

## Hard rules
1. The Anthropic API key lives in `.env` on the server only. Never expose it to client code and never commit it. Add `.env` to `.gitignore` first.
2. Never send full game history on every call (see Token discipline below).
3. Do not add features outside the current build stage. Finish and verify each stage before starting the next.
4. Ask before adding any new dependency that isn't listed above.
5. Stockfish is GPLv3. This is fine for personal use, but flag it if I ever mention sharing or publishing the app.

## Models
- **Live per-move comments and chat:** `claude-haiku-5-5` (cheap and fast)
- **Post-game review:** `claude-sonnet-5-5` (better explanations)
- Put model IDs in a single config file so they're easy to swap. Don't hardcode them in multiple places. Haiku 5.5 uses a newer tokenizer than older Haiku models, so don't reuse old token estimates.

## Architecture
```
Browser
  ├─ React UI (board, eval bar, move list, coach panel, chat, hint button)
  ├─ chess.js (state + legality)
  └─ Stockfish WASM worker (eval, best line, opponent moves)
        │
        ▼  (position + engine data only)
Express server
  ├─ POST /api/coach/comment   → Haiku
  ├─ POST /api/coach/chat      → Haiku
  ├─ POST /api/coach/hint      → Haiku
  ├─ POST /api/coach/review    → Sonnet
  └─ /api/games, /api/mistakes → SQLite
```

## What gets sent to Claude
Per call, send only what's needed:
- Current FEN
- Last 6-10 moves in SAN (not the whole game, except for post-game review)
- Eval before and after my last move (centipawns or mate score), from Stockfish
- Stockfish's best line (first 3-5 moves) for the position before my move
- My move, and whether it was the engine's top choice
- Player and engine strength settings

Never ask Claude to calculate. If data is missing, say so rather than guessing.

## Coach behavior (system prompt requirements)
- Act like a coach sitting next to me, not a commentator. Be brief: 1-3 sentences for live comments.
- **Coach, don't solve.** Default to nudges ("What does your opponent's last move threaten?"). Do not name the best move unless I press the hint button's final level or ask directly.
- Only comment when something is worth saying (see triggers below). Silence is fine.
- Use only the engine data provided for any evaluation or move claim. Never invent lines.
- Be direct. No flattery or filler. Point out mistakes plainly and explain the underlying idea (tactic missed, weakened square, king safety, piece activity, etc.).
- Tag each significant mistake with a category: `tactical-oversight`, `opening`, `positional`, `endgame`, `time`, `blunder-check`.

## Comment triggers
Call the coach automatically only when:
- Eval swing against me exceeds 80 centipawns (make this configurable), or
- I miss a forced mate or a winning tactic, or
- Every ~5 moves for a brief strategic note (toggleable), or
- I click "Ask coach" or send a chat message.

## Hint system (button, three levels)
1. **Nudge:** a general idea or question, no piece or square named
2. **Target:** which piece or area to look at
3. **Move:** the actual best move, with a one-line reason

Each press escalates one level for the current position. Reset on the next move.

## Post-game review
1. Engine pass over the whole game to find the 3-5 largest eval swings.
2. Send those critical positions (FEN + engine line + my move) to Sonnet.
3. Claude explains each in plain language and summarizes my recurring weaknesses.
4. Save mistake tags to SQLite so patterns show up across games.

## Database (SQLite)
- `games`: id, played_at, pgn, result, engine_elo, my_color
- `mistakes`: id, game_id, move_number, fen, my_move, best_move, eval_before, eval_after, category, coach_note
- Add a simple query for "top recurring mistake categories over the last N games" to feed the review prompt.

## Token and cost discipline
- Personal use, so cost should be pennies per game. Keep it that way.
- Don't send the full game history on every call. Recent moves + FEN is enough for live use.
- Debounce calls. Never fire a coach call while Stockfish is still computing.
- Add a config cap on coach comments per game (default 25).
- Log token usage per call to the console so I can see what a game costs.
- Remind me to set a monthly spend limit on the API account.

## Build order (stop and confirm after each stage)
1. **Playable board vs Stockfish.** Legal moves, adjustable strength, new game, resign. No Claude yet.
2. **Eval bar + move list + engine best-line display.** Verify evals look sane.
3. **Coach panel.** Express proxy, Haiku comments on the triggers above. Test with a hardcoded blunder position first.
4. **Chat + hint button.**
5. **SQLite: save games and mistakes.**
6. **Post-game review with Sonnet + recurring-weakness summary.**

## Definition of done for each stage
- App runs with a single command (`npm run dev`)
- No console errors
- I can play a full game without a crash
- Brief note on what was built and how to test it

## Commands (fill in as the project is created)
- Install: `npm install`
- Dev: `npm run dev`
- Server: `npm run server`
- Env: copy `.env.example` to `.env` and add `ANTHROPIC_API_KEY`

## Things to flag to me, not decide silently
- Any place where Claude's output could affect game state (it shouldn't)
- Stockfish WASM performance issues in the browser
- Anything that would require sending the API key to the client
- Scope creep (accounts, multiplayer, online play, deployment)
