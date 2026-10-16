# Chess Coach

Personal, local-only app: play Stockfish in the browser with Claude as a coach. See `CLAUDE.md` for the full spec and build order.

## Starting the app
Double-click **Start Chess Coach** in the project folder. It updates the app, starts it, and opens it in your browser. Leave the Terminal window it opens running while you play; close it to stop the app. Drag it to the right-hand side of the Dock for one-click access.

## Training features
- **Opening trainer** (under the board): pick the London System (White) or the Sicilian Dragon (Black). It shows the book line as the game goes, with the idea behind every move, what the book plays next, and where you or Stockfish left the book; out of book it shows the set-up checklist and typical plans. Optionally Stockfish plays book replies so the openings actually arise. The repertoire lives in `src/openings/book.ts`.
- **Question-first coaching:** the coach can ask you a question in a comment; answer in the chat box and it gives a verdict, because chat sees the recent comments and hints. It also comments on key moments (castling, trades, pawn breaks; toggle in the coach panel), tags each moment with a pattern (fork, back-rank, dragon-c-file, ...), and the history panel counts the patterns behind your mistakes.
- **Coaching brief** (in the coach panel): tell the coach your goals and how you like to be coached. It's stored in the database and added to every coach prompt; the coach's rules still take priority.
- **Themes** (top right): Classic, Club Room, Night Study and Tournament. Theme CSS is in `src/themes.css`; board colours are in `src/themes.ts`.
- **Your rating** (top right, click the game count for your last 10 games): an Elo-style rating from finished games against Stockfish, starting at 1200. Skill Level settings use estimated strengths (`shared/rating.ts`). The coach is told your rating.

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

The coach panel shows the estimated API cost of the current game, and the history panel shows the total spent in the app and this month. Every Claude call is recorded in the `api_usage` table. Costs are estimates from token counts and the prices in `shared/coach-config.ts`; the Claude Console shows what you are actually billed.

After a game ends, press **Review this game**. Reviews are stored with the game, so opening one again costs nothing. A review costs roughly 5-10 cents (Opus 5.5). Live comments, hints and chat use Sonnet 5.5, a few cents per game.

Games are saved automatically when they end (checkmate, draw or resign). A game you abandon with "New game" after making at least one move is saved as unfinished (`*`). The database is `data/chess-coach.db` (gitignored); back it up by copying that file.

Coach settings (eval-drop threshold, check-in interval, per-game cap, your level) are in `src/config.ts` under `COACH`. Model IDs are in `shared/coach-config.ts`. The engine's thinking time and analysis depth can be changed in the app (right-hand column), which helps on slower machines.

## Status
- [x] Stage 1: playable board vs Stockfish (legal moves, adjustable strength, new game as White/Black, resign)
- [x] Stage 2: eval bar, move list, engine best line (separate full-strength analysis worker, depth 16)
- [x] Stage 3: coach panel (Express + Haiku): comments on eval drops over 80cp, missed mates, every 5th move (toggle), and Ask coach; 25 calls per game cap
- [x] Stage 4: chat box and a three-level hint button (nudge, where to look, show move), resetting each move
- [x] Stage 5: games and mistakes saved to SQLite (`data/chess-coach.db`), with a "Your history" panel showing the most common mistake types over the last 10 games
- [x] Stage 6: post-game review: a Stockfish pass finds your 3-5 costliest moves (by lost winning chances), and Opus explains each one, summarises the game and your recurring weaknesses, and suggests one thing to work on

- [ ] Stage 7: standalone iPad app (Capacitor). Built and tested in a browser that emulates the iPad build; still to be confirmed on the iPad itself (see below)

## iPad app (Stage 7)
The iPad build is the same app with no Mac server: Stockfish runs on the iPad, games are kept in a SQLite database on the iPad, and the coach calls the Anthropic API directly with a key stored in the iPad's Keychain. The Mac version is unchanged and keeps its key in `.env`.

Two builds from one codebase, chosen with `VITE_MODE`:
- `npm run dev` / `npm run build`: the Mac/web app (Express server, `data/chess-coach.db`, key in `.env`)
- `VITE_MODE=ios npm run build`: the iPad app (`src/platform/device.ts`: direct API calls, on-device SQLite, Keychain)

The coach prompts, models, limits and database queries are shared (`shared/coach-core.ts`, `shared/store-sql.ts`), so both versions coach and store the same way. Games are not synced between the Mac and the iPad; each keeps its own history.

### Build and run on the iPad (on the Mac)
You need Xcode from the Mac App Store and the iPad connected by cable the first time.
```bash
npm install
npm run ios:build      # = VITE_MODE=ios npm run build && npx cap sync ios
npm run ios:open       # = npx cap open ios  (opens the project in Xcode)
```
Then in Xcode press Run with the iPad selected. After any code change, run `npm run ios:build` again and press Run.

On first launch the app asks for your API key. It checks the key with one free request (it lists the models; no tokens used) and stores it in the Keychain, for this iPad only (not synced to iCloud, not restored onto another device). Under **API key** in the coach panel you can see it masked (`sk-ant-…abcd`), replace it, or remove it. You can skip the prompt and play without the coach.

Without a connection (or without credit), the coach panel shows "Coach unavailable: <reason>" and you keep playing. Those failed calls don't count toward the 25 per game. Stockfish, saving, resuming, history and saved reviews all work offline.

`npm run check:secrets` searches the tracked files, the git history, `dist/` and the iOS bundle for anything that looks like an API key.

### Manual steps for you (not done by the build)
1. **API key just for this app.** In the Claude Console, create a separate API key for the iPad, in its own workspace if possible, with a low monthly spend limit.
2. **Auto-reload off.** Turn auto-reload off on the API account's billing page, so a leaked key can only spend the prepaid balance.
3. **Developer Mode on the iPad.** Settings, Privacy & Security, Developer Mode: on. The iPad restarts. (The option appears after the iPad has been connected to Xcode once.)
4. **Signing in Xcode.** Select the App target, Signing & Capabilities: tick "Automatically manage signing", choose your Apple ID team (add your Apple ID under Xcode, Settings, Accounts if needed), select the connected iPad as the run destination, and press Run.
5. **Trust the developer profile on the iPad.** Settings, General, VPN & Device Management: tap your Apple ID profile, then Trust.
6. **Free Apple ID limit.** With a free Apple ID the installed app expires after about 7 days; reconnect the iPad and press Run in Xcode again. Your games and key stay on the iPad. Check Apple's current terms; a paid developer account lasts a year.

## License note
Stockfish is GPLv3. Fine for personal use; revisit before sharing or publishing.
