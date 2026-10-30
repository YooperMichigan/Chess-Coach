// Plain-language board facts computed by chess.js, so the coach never has to decode a FEN
// itself (language models misread FENs and then misplace pieces). Everything here is read
// off the actual position: piece locations, material, what is attacked and defended, and what
// each move in an engine line does. No evaluation or calculation.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

const NAME: Record<PieceSymbol, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const VALUE: Record<PieceSymbol, number> = { k: 0, q: 9, r: 5, b: 3, n: 3, p: 1 };
const ORDER: PieceSymbol[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const SIDE: Record<Color, string> = { w: 'White', b: 'Black' };
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

function load(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

/**
 * Lines describing the position: where every piece stands, material, check, and which pieces
 * are attacked (with attackers and defenders). `student` is the student's colour.
 */
export function describeBoard(fen: string, student: 'white' | 'black'): string[] {
  const g = load(fen);
  if (!g) return ['Board facts: unavailable (the position could not be read).'];
  const me: Color = student === 'white' ? 'w' : 'b';
  const pieces: { sq: Square; type: PieceSymbol; color: Color }[] = [];
  for (const row of g.board()) for (const p of row) if (p) pieces.push({ sq: p.square, type: p.type, color: p.color });

  const lines = ['Board facts (computed by the app from the actual position; use these, do not read piece positions off the FEN):'];
  for (const c of [me, other(me)]) {
    const parts = ORDER.map((t) => {
      const sqs = pieces.filter((p) => p.color === c && p.type === t).map((p) => p.sq);
      return sqs.length ? `${NAME[t]}${sqs.length > 1 ? 's' : ''} ${sqs.join(' ')}` : null;
    }).filter(Boolean);
    lines.push(`  ${SIDE[c]} (${c === me ? 'student' : 'engine'}): ${parts.join('; ')}`);
  }
  const material = (c: Color) => pieces.filter((p) => p.color === c).reduce((s, p) => s + VALUE[p.type], 0);
  const diff = material(me) - material(other(me));
  lines.push(
    `  Material (Q9 R5 B3 N3 P1): student ${material(me)}, engine ${material(other(me))} (${diff === 0 ? 'level' : `student ${diff > 0 ? '+' : ''}${diff}`}).`,
  );
  lines.push(`  ${SIDE[g.turn()]} to move${g.inCheck() ? ', in check' : ''}.`);

  // Attacked pieces (pseudo-legal attacks: a pinned piece still counts as an attacker).
  const attacked: string[] = [];
  for (const p of pieces) {
    if (p.type === 'k') continue;
    const by = g.attackers(p.sq, other(p.color));
    if (!by.length) continue;
    const defenders = g.attackers(p.sq, p.color);
    const who = (sqs: Square[]) => sqs.map((s) => `${NAME[g.get(s)!.type]} ${s}`).join(', ');
    attacked.push(
      `  ${SIDE[p.color]} ${NAME[p.type]} ${p.sq} is attacked by ${who(by)}; ${defenders.length ? `defended by ${who(defenders)}` : 'undefended'}.`,
    );
  }
  lines.push(attacked.length ? 'Pieces under attack (pins not considered):' : 'No pieces are under attack.', ...attacked);
  return lines;
}

/** One move in words, e.g. "Nxe5 (knight f3 takes pawn e5, check)". */
function describeMove(g: Chess, san: string): string | null {
  let m;
  try {
    m = g.move(san);
  } catch {
    return null;
  }
  let what: string;
  if (m.isKingsideCastle()) what = 'castles kingside';
  else if (m.isQueensideCastle()) what = 'castles queenside';
  else {
    what = `${NAME[m.piece]} ${m.from} ${m.captured ? `takes ${NAME[m.captured]} ${m.isEnPassant() ? `${m.to} en passant` : m.to}` : `to ${m.to}`}`;
    if (m.promotion) what += `, promotes to ${NAME[m.promotion]}`;
  }
  if (g.isCheckmate()) what += ', checkmate';
  else if (g.inCheck()) what += ', check';
  return `${m.san} (${SIDE[m.color]} ${what})`;
}

/**
 * An engine line (SAN, possibly with move numbers such as "12. Nf3 Nc6 13. d4") played out
 * from `fen`, each move spelled out. Returns the original text if it can't be replayed.
 */
export function describeLine(fen: string, line: string): string {
  const g = load(fen);
  if (!g || !line.trim()) return line;
  const sans = line.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t) && !/^\d+\.\.\.$/.test(t)).map((t) => t.replace(/^\d+\.+/, ''));
  const out: string[] = [];
  for (const san of sans) {
    const d = describeMove(g, san);
    if (!d) return line;
    out.push(d);
  }
  return out.join(', then ');
}

/** The position after `san` is played from `fen`, or null if it can't be played. */
export function fenAfter(fen: string, san: string): string | null {
  const g = load(fen);
  if (!g) return null;
  try {
    g.move(san);
    return g.fen();
  } catch {
    return null;
  }
}

/** A single move from `fen` spelled out, e.g. "Bxf7+ (White bishop c4 takes pawn f7, check)". */
export function describeMoveFrom(fen: string, san: string): string {
  const g = load(fen);
  return (g && describeMove(g, san)) || san;
}
