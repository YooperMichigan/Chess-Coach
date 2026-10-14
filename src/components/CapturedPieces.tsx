import { useMemo } from 'react';
import { Chess } from 'chess.js';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPH: Record<'w' | 'b', Record<string, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' },
};

interface Props {
  history: string[]; // SAN moves so far
  myColor: 'white' | 'black';
  onClose: () => void;
}

/** Pop-up card: the pieces each side has captured, and the material balance on the board. */
export function CapturedPieces({ history, myColor, onClose }: Props) {
  const { byMe, byThem, balance } = useMemo(() => {
    const g = new Chess();
    const taken: Record<'w' | 'b', string[]> = { w: [], b: [] }; // pieces captured BY each colour
    for (const san of history) {
      const m = g.move(san);
      if (m.captured) taken[m.color].push(m.captured);
    }
    // Balance from the pieces actually on the board, so promotions are counted correctly.
    let material = 0;
    for (const row of g.board()) for (const sq of row) if (sq && sq.type !== 'k') material += (sq.color === 'w' ? 1 : -1) * VALUE[sq.type];
    const mine = myColor === 'white' ? 'w' : 'b';
    const theirs = mine === 'w' ? 'b' : 'w';
    const sort = (list: string[]) => [...list].sort((a, b) => VALUE[b] - VALUE[a]);
    return {
      byMe: sort(taken[mine]).map((p) => GLYPH[theirs][p]),
      byThem: sort(taken[theirs]).map((p) => GLYPH[mine][p]),
      balance: mine === 'w' ? material : -material,
    };
  }, [history, myColor]);

  const balanceText = balance === 0 ? 'Material is level' : balance > 0 ? `You are up ${balance}` : `You are down ${-balance}`;
  return (
    <div className="captured" role="dialog" aria-label="Captured pieces">
      <div className="captured-head">
        <strong>Captured pieces</strong>
        <button className="captured-close" onClick={onClose} aria-label="Close captured pieces">
          ×
        </button>
      </div>
      <div className="captured-row">
        <span className="captured-who">You took</span>
        <span className="captured-glyphs">{byMe.length ? byMe.join(' ') : '—'}</span>
      </div>
      <div className="captured-row">
        <span className="captured-who">Stockfish took</span>
        <span className="captured-glyphs">{byThem.length ? byThem.join(' ') : '—'}</span>
      </div>
      <p className={`captured-balance ${balance > 0 ? 'up' : balance < 0 ? 'down' : ''}`}>
        {balanceText}
        {balance !== 0 && <span className="captured-units"> (pawn = 1, knight/bishop = 3, rook = 5, queen = 9)</span>}
      </p>
    </div>
  );
}
