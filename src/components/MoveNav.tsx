interface Props {
  sans: string[]; // moves played so far (SAN)
  viewPly: number | null; // null = the live position
  onView: (ply: number | null) => void;
  canTakeBack: boolean;
  onTakeBack: () => void;
  rated: boolean;
  unratedReason: string | null;
}

/** Browse earlier positions (read-only), take back your last move, and whether the game is rated. */
export function MoveNav({ sans, viewPly, onView, canTakeBack, onTakeBack, rated, unratedReason }: Props) {
  const plies = sans.length;
  const at = viewPly ?? plies;
  const go = (ply: number) => onView(ply >= plies ? null : Math.max(0, ply));
  return (
    <div className="move-nav">
      <div className="move-nav-buttons" role="group" aria-label="Browse moves">
        <button type="button" id="nav-start" aria-label="First position" disabled={at === 0} onClick={() => go(0)}>
          «
        </button>
        <button type="button" id="nav-back" aria-label="Back one move" disabled={at === 0} onClick={() => go(at - 1)}>
          ‹
        </button>
        <button type="button" id="nav-forward" aria-label="Forward one move" disabled={viewPly === null} onClick={() => go(at + 1)}>
          ›
        </button>
        <button type="button" id="nav-live" aria-label="Back to the game" disabled={viewPly === null} onClick={() => onView(null)}>
          »
        </button>
        <button type="button" id="take-back" className="take-back" disabled={!canTakeBack} onClick={onTakeBack}>
          Take back
        </button>
      </div>
      <p className={`rated-note${rated ? ' rated' : ''}`} id="rated-note">
        {viewPly !== null
          ? `Viewing ${viewPly === 0 ? 'the starting position' : `the position after ${Math.ceil(viewPly / 2)}${viewPly % 2 === 1 ? '.' : '…'} ${sans[viewPly - 1]}`}. Press » to return to the game.`
          : rated
            ? 'Rated game: no coaching or take-backs so far.'
            : `Unrated game: ${unratedReason}.`}
      </p>
    </div>
  );
}
