import { useEffect, useRef } from 'react';

interface Props {
  moves: string[]; // SAN, in order
  viewPly: number | null; // plies shown on the board when browsing; null = the live position
  onSelect: (ply: number) => void; // show the position after this many plies
}

export function MoveList({ moves, viewPly, onSelect }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring the latest move into view inside its scrolling panel, but never scroll the page
    // itself (in the stacked iPad portrait layout that would jump away from the board).
    const { scrollX, scrollY } = window;
    endRef.current?.scrollIntoView({ block: 'nearest' });
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
  }, [moves.length]);

  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  // The move whose position is on the board: the last one, or the one being browsed.
  const shown = (viewPly ?? moves.length) - 1;
  const move = (san: string | undefined, index: number) =>
    san ? (
      <button type="button" className={`move${index === shown ? ' current' : ''}`} onClick={() => onSelect(index + 1)}>
        {san}
      </button>
    ) : (
      <span className="move" />
    );

  return (
    <div className="move-list">
      {rows.length === 0 && <p className="empty">No moves yet.</p>}
      <ol>
        {rows.map(([w, b], i) => (
          <li key={i}>
            <span className="move-no">{i + 1}.</span>
            {move(w, 2 * i)}
            {move(b, 2 * i + 1)}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
