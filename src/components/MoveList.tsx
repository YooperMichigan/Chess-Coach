import { useEffect, useRef } from 'react';

interface Props {
  moves: string[]; // SAN, in order
}

export function MoveList({ moves }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [moves.length]);

  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  const last = moves.length - 1;

  return (
    <div className="move-list">
      {rows.length === 0 && <p className="empty">No moves yet.</p>}
      <ol>
        {rows.map(([w, b], i) => (
          <li key={i}>
            <span className="move-no">{i + 1}.</span>
            <span className={`move${2 * i === last ? ' current' : ''}`}>{w}</span>
            <span className={`move${2 * i + 1 === last ? ' current' : ''}`}>{b ?? ''}</span>
          </li>
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
