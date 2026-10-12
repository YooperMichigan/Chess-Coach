# Chess Coach

Personal, local-only app: play Stockfish in the browser with Claude as a coach. See `CLAUDE.md` for the full spec and build order.

## Setup
```bash
npm install
npm run dev     # http://localhost:5173
```
`npm run dev` copies the Stockfish WASM files from `node_modules/stockfish` into `public/stockfish/` first.

## Status
- [x] Stage 1: playable board vs Stockfish (legal moves, adjustable strength, new game as White/Black, resign)
- [x] Stage 2: eval bar, move list, engine best line (separate full-strength analysis worker, depth 16)
- [ ] Stage 3: coach panel (Express + Haiku)
- [ ] Stage 4: chat + hint button
- [ ] Stage 5: SQLite games and mistakes
- [ ] Stage 6: post-game review (Sonnet)

## License note
Stockfish is GPLv3. Fine for personal use; revisit before sharing or publishing.
