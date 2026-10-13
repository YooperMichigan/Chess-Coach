import type { RatingSummary } from '../../shared/rating';
import { PROVISIONAL_GAMES, START_RATING } from '../../shared/rating';

/** The player's in-app rating in the header, with the change from the last game. */
export function RatingBadge({ rating }: { rating: RatingSummary | null }) {
  if (!rating) return null;
  const help =
    `Estimated from your finished games against Stockfish, using each strength setting's approximate rating ` +
    `(Skill Level settings are estimates). Starts at ${START_RATING}; changes are larger for the first ${PROVISIONAL_GAMES} games. ` +
    `On Stockfish's scale, not an official FIDE or online rating.`;
  const change = rating.lastChange;
  return (
    <div className="rating" title={help}>
      <span className="rating-label">Your rating</span>
      <span className="rating-value">{rating.rating}</span>
      {change !== null && change !== 0 && (
        <span className={`rating-change ${change > 0 ? 'up' : 'down'}`}>
          {change > 0 ? '▲' : '▼'}
          {Math.abs(change)}
        </span>
      )}
      <span className="rating-sub">
        {rating.games === 0
          ? 'finish a game to start'
          : `${rating.provisional ? 'provisional · ' : ''}${rating.games} game${rating.games === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
