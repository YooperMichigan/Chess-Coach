// Copies the Stockfish WASM engine from node_modules into public/ so Vite serves it
// as a static Web Worker. Runs automatically before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'stockfish');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`[copy-stockfish] copied ${files.length} files to public/stockfish`);
