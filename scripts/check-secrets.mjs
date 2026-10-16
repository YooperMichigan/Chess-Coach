// Looks for anything shaped like an Anthropic API key in the repository (tracked files and
// git history) and in the built app (dist/ and the copy inside the iOS project). Exits 1 if
// one is found. Run: npm run check:secrets
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KEY = /sk-ant-[A-Za-z0-9_-]{20,}/;
const hits = [];

function scanFile(path) {
  const text = readFileSync(path, 'latin1');
  if (KEY.test(text)) hits.push(path);
}
function scanDir(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) scanDir(p);
    else scanFile(p);
  }
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const f of tracked) if (existsSync(f)) scanFile(f);
for (const dir of ['dist', 'ios/App/App/public']) scanDir(dir);
const history = execFileSync('git', ['log', '--all', '-p', '--no-color'], { encoding: 'utf8', maxBuffer: 1 << 30 });
if (KEY.test(history)) hits.push('git history');

if (hits.length) {
  // Name the places, never print the key itself.
  console.error(`Possible API key found in:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`No API key found (${tracked.length} tracked files, dist/, iOS bundle, git history).`);
