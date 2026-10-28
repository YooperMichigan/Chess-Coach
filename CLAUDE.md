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
- **Live per-move comments, hints and chat:** `claude-sonnet-5-5` (changed from Haiku 5.5 for better explanations; roughly 20x the cost, still a few cents per game)
- **Post-game review:** `claude-opus-5-5` (changed from Sonnet 5.5 for deeper explanations)
- Non-Haiku models are called with the server-side refusal fallback (`fallbacks: "default"`).
- Put model IDs in a single config file so they're easy to swap (`shared/coach-config.ts`, used by the server and the iPad build). Don't hardcode them in multiple places. Haiku 5.5 uses a newer tokenizer than older Haiku models, so don't reuse old token estimates.

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
- Per-game call cap: removed at my request (`COACH.maxCallsPerGame: null` in `src/config.ts`; set a number to restore it). Instead, a **Hold** toggle in the coach panel pauses automatic comments; Ask coach, Hint and chat still work.
- Log token usage per call to the console so I can see what a game costs.
- Remind me to set a monthly spend limit on the API account.

## Build order (stop and confirm after each stage)
1. **Playable board vs Stockfish.** Legal moves, adjustable strength, new game, resign. No Claude yet.
2. **Eval bar + move list + engine best-line display.** Verify evals look sane.
3. **Coach panel.** Express proxy, Haiku comments on the triggers above. Test with a hardcoded blunder position first.
4. **Chat + hint button.**
5. **SQLite: save games and mistakes.**
6. **Post-game review with Sonnet + recurring-weakness summary.**
7. **Standalone iPad app (Capacitor).** See the Stage 7 section below.

## Definition of done for each stage
- App runs with a single command (`npm run dev`)
- No console errors
- I can play a full game without a crash
- Brief note on what was built and how to test it

## Commands (fill in as the project is created)
- Install: `npm install`
- Dev: `npm run dev` (Vite and the Express coach server together)
- Server: `npm run server`
- Coach smoke test: `npm run coach:test` (server must be running; `COACH_DRY_RUN=1` on the server skips the API call)
- Typecheck: `npm run typecheck`
- Env: copy `.env.example` to `.env` and add `ANTHROPIC_API_KEY`
- iPad build: `npm run ios:build` (= `VITE_MODE=ios npm run build && npx cap sync ios`), then `npm run ios:open` and Run in Xcode
- Secret scan: `npm run check:secrets` (tracked files, git history, `dist/`, iOS bundle)

## Added after Stage 6
- **Opening trainer:** hand-written repertoire in `src/openings/book.ts` (London as White, Dragon as Black), keyed by position so transpositions match. Every line must stay legal (chess.js) and each book move should be checked with Stockfish. Stockfish may play book replies while in book (a deterministic choice from the book, never from Claude). The opening and book status are passed to the coach as context.
- **Coaching brief:** the player's goals and preferred style, stored in the `settings` table and appended to every coach system prompt inside `<student_brief>`; the coach's rules take priority over it.
- **Rating:** Elo-style rating replayed from finished games (`shared/rating.ts`), shown in the header and passed to the coach as the player's level.
- **Question-first coaching support:** comment and chat requests carry a transcript of the coach panel (last 8 entries), so the coach can ask a question in a comment and give a verdict on the answer in chat. Chat may use up to 6 sentences for a verdict or principle.
- **Opening context:** the coach gets the repertoire's own explanations for the last book moves and the next ones, and must teach opening ideas from that text, not from memory.
- **Patterns:** comments and reviews tag each moment with one tag from `PATTERN_TAGS` (`shared/coach-types.ts`); tags are stored on `mistakes.pattern`, and the app's counts (saved games + this game) are passed as a "Pattern record" line. The coach may only cite counts from that line.
- **Key-moment trigger:** castling, capturing a minor/major piece, and pawn breaks in the player's move (detected from the board, no engine judgement) trigger a comment when on (toggle in the coach panel). Priority: eval drop > missed mate > key moment > periodic.

## Stage 7: Standalone iPad app (Capacitor)

Do not start it until stages 1-6 work on desktop.

### Goal
Package the existing web app as a standalone iPad app using Capacitor. No Mac server required at runtime. Stockfish runs locally on the iPad, game data is stored on the device, and the app calls the Anthropic API directly.

### Rule override (applies to this stage only)
The earlier rule "API key lives on the server only" does not apply to the iPad build. In the iPad build:
- The user (me) enters the API key on first launch. It is stored in the iOS Keychain through a Keychain-backed secure-storage Capacitor plugin.
- The key must never appear in source files, `.env` files bundled into the app, build output, logs, or git history.
- Ask me before choosing and installing the secure-storage plugin.
- The web/desktop build keeps the Express proxy and server-side key. Do not remove that path.

### Architecture: two modes behind interfaces
Create two interfaces and keep both implementations working:
- `CoachClient`: sends coach/chat/hint/review requests.
  - `ServerCoachClient` calls the Express proxy (desktop/web).
  - `DirectCoachClient` calls the Anthropic API from the app (iPad).
- `GameStore`: saves games, mistakes, and pattern tags.
  - `SqliteServerStore` uses the existing Express + SQLite backend.
  - `DeviceStore` uses an on-device store (Capacitor SQLite plugin, e.g. `@capacitor-community/sqlite`, or IndexedDB). Keep the same schema and the same queries.

Select the implementation with a build-time flag, e.g. `VITE_MODE=web` or `VITE_MODE=ios`. UI code must not know which one is active.

### Direct API call requirements (DirectCoachClient)
- POST to `https://api.anthropic.com/v1/messages`
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`, and `anthropic-dangerous-direct-browser-access: true`
- Reuse the same prompts, models config, payload shape, and token-discipline rules as the server version.
- If CORS from the Capacitor WebView causes problems, tell me and propose using Capacitor's native HTTP option. Don't work around it silently.
- Handle errors without breaking the game: 401 (bad key), 402/credit exhausted, 429 (rate limit), and no network. Show "Coach unavailable: <short reason>" in the coach panel and let me keep playing.

### API key screen
- First launch: prompt for the key, validate it with one tiny request, then store it.
- Settings screen: show the key masked, with "Replace key" and "Remove key" actions.
- Never log the key, never include it in error messages, never show it in full after entry.

### Capacitor setup
1. Install `@capacitor/core`, `@capacitor/ios`, and dev dependency `@capacitor/cli`. Ask before adding any other plugin.
2. `npx cap init` with app name "Chess Coach", a unique bundle ID (ask me for it), `webDir` set to the Vite build output (`dist`).
3. Build with `VITE_MODE=ios`, then `npx cap add ios`.
4. Document the loop in the README: `VITE_MODE=ios npm run build && npx cap sync`, then `npx cap open ios`.
5. Add `ios/` build artifacts and any key files to `.gitignore` as appropriate.

### iPad-specific work
- **Stockfish:** use the single-threaded WASM build only. Multi-threaded builds need cross-origin isolation headers that the Capacitor shell does not provide. Verify the worker and `.wasm` load from bundled files, and confirm the engine plays moves.
- **Touch:** tap-to-move (tap piece, tap destination) in addition to drag-and-drop. Highlight legal destination squares.
- **Layout:** board fills the available space. Landscape: coach panel beside the board. Portrait: coach panel below it. Respect safe-area insets.
- **Orientation:** support landscape and portrait.
- **State saving:** save the game state after every move. On launch, offer to resume an unfinished game. The app can be suspended when the iPad locks or I switch apps.
- **Offline:** the app must work offline except for coach calls. Engine, board, and saved games must work with no connection.
- **Strength:** older iPads may be slow. Keep the engine's thinking time and strength configurable.

### Manual steps for me (list these in the README, don't attempt them)
- Create a separate API key just for this app, in its own workspace if possible, with a low spend limit.
- Turn auto-reload off on the API account so a leaked key can only spend the prepaid balance.
- Enable Developer Mode on the iPad, then restart it.
- In Xcode: Signing & Capabilities, automatic signing, select my Apple ID team, select the connected iPad, press Run.
- On the iPad: trust the developer profile under Settings, General, VPN & Device Management.
- With a free Apple ID the install expires after about 7 days and must be re-run from Xcode. Check Apple's current terms.

### Definition of done for Stage 7
- `VITE_MODE=web` build still works exactly as before.
- `VITE_MODE=ios` build installs and runs on the iPad with no Mac server.
- I can play a full game, with the engine, coach comments, chat, hints, save, resume, and post-game review.
- Airplane mode: I can still play and review saved games. The coach shows "unavailable" without errors or crashes.
- A search of the repo and the built `dist/` folder finds no API key.
- Short README section listing the manual steps above.

### Decisions made for Stage 7
- Secure storage: `@aparajita/capacitor-secure-storage` (Keychain, this device only, not synced). SQLite: `@capacitor-community/sqlite`. Bundle ID: `com.yoopermichigan.chesscoach`.
- `DirectCoachClient` uses the official `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`, which sends exactly the headers listed above. The Anthropic API answers CORS for the `capacitor://localhost` origin, so no native-HTTP workaround is used.
- Coach logic (`shared/coach-core.ts`) and the database schema and queries (`shared/store-sql.ts`) are shared by both builds; each build supplies only the transport (server SDK client or direct client) and the SQLite driver (better-sqlite3 or the Capacitor plugin).
- `VITE_MODE` is resolved in `vite.config.ts` by aliasing `@platform-impl` to `src/platform/server.ts` or `src/platform/device.ts`, so the web bundle contains no iPad code.

### Flag to me, don't decide silently
- Which secure-storage and SQLite plugins you propose
- Any CORS or networking workaround
- Any place the key could end up in logs, crash reports, or build output
- Any performance problem running Stockfish on the iPad

## Things to flag to me, not decide silently
- Any place where Claude's output could affect game state (it shouldn't)
- Stockfish WASM performance issues in the browser
- Anything that would require sending the API key to the client
- Scope creep (accounts, multiplayer, online play, deployment)
