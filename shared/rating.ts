// The player's in-app rating, estimated from results against Stockfish. It is on the same
// rough scale as Stockfish's UCI_Elo setting, not an official FIDE or online rating.

/**
 * Estimated strength of each engine setting (by its label in STRENGTH_PRESETS). Elo presets
 * use their UCI_Elo value; Skill Level presets have no official Elo, so these are estimates.
 */
export const ENGINE_RATINGS: Record<string, number> = {
  'Beginner (Skill 0)': 800,
  'Novice (Skill 3)': 1000,
  'Casual (Skill 6)': 1200,
  'Elo 1320': 1320,
  'Elo 1500': 1500,
  'Elo 1800': 1800,
  'Elo 2100': 2100,
  'Elo 2500': 2500,
  'Full strength': 2800,
};

export const START_RATING = 1200;
export const PROVISIONAL_GAMES = 20; // bigger rating changes until then, so it finds your level fast
const K_PROVISIONAL = 40;
const K_ESTABLISHED = 20;

export interface RatedGame {
  id?: number;
  playedAt?: string;
  engineLabel?: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  myColor: 'white' | 'black';
  engineRating: number;
}

/** One finished game in the rating history, for the "last games" list. */
export interface RatedGameResult {
  gameId: number | null;
  playedAt: string | null;
  engineLabel: string | null;
  myColor: 'white' | 'black';
  outcome: 'win' | 'loss' | 'draw';
  change: number; // rating points gained or lost
  ratingAfter: number;
}

export interface RatingSummary {
  rating: number; // START_RATING before any rated game
  games: number; // finished games counted
  provisional: boolean;
  lastChange: number | null; // change from the most recent game
  trend: number[]; // rating after each of the last 20 games, oldest first
  recent: RatedGameResult[]; // the last 10 rated games, newest first
}

/** Standard Elo, replayed over all finished games in order. */
export function computeRating(games: RatedGame[]): RatingSummary {
  let rating = START_RATING;
  let lastChange: number | null = null;
  const after: number[] = [];
  const results: RatedGameResult[] = [];
  games.forEach((g, i) => {
    const score = g.result === '1/2-1/2' ? 0.5 : (g.result === '1-0') === (g.myColor === 'white') ? 1 : 0;
    const expected = 1 / (1 + 10 ** ((g.engineRating - rating) / 400));
    const k = i < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
    const change = k * (score - expected);
    rating += change;
    lastChange = Math.round(change);
    after.push(Math.round(rating));
    results.push({
      gameId: g.id ?? null,
      playedAt: g.playedAt ?? null,
      engineLabel: g.engineLabel ?? null,
      myColor: g.myColor,
      outcome: score === 1 ? 'win' : score === 0 ? 'loss' : 'draw',
      change: Math.round(change),
      ratingAfter: Math.round(rating),
    });
  });
  return {
    rating: Math.round(rating),
    games: games.length,
    provisional: games.length < PROVISIONAL_GAMES,
    lastChange,
    trend: after.slice(-20),
    recent: results.slice(-10).reverse(),
  };
}
