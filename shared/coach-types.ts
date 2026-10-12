// Request/response shapes shared by the React client and the Express server.
// Every number here comes from Stockfish; the server never computes chess itself.

export type MistakeCategory =
  | 'tactical-oversight'
  | 'opening'
  | 'positional'
  | 'endgame'
  | 'time'
  | 'blunder-check';

export type CoachTrigger = 'swing' | 'missed-mate' | 'periodic' | 'ask';

/** Engine score from the player's point of view. */
export type PlayerScore = { cp: number } | { mate: number };

export interface EngineEval {
  score: PlayerScore;
  depth: number;
}

export interface CoachCommentRequest {
  trigger: CoachTrigger;
  fen: string; // position after the player's move
  myColor: 'white' | 'black';
  recentMoves: string; // last 6-10 moves, numbered SAN
  myMove: string; // SAN
  engineTopMove: string | null; // SAN, engine's choice in the position before the move
  wasTopChoice: boolean;
  evalBefore: EngineEval | null; // null = engine data missing
  evalAfter: EngineEval | null;
  bestLineBefore: string; // numbered SAN, first 3-5 moves
  bestLineAfter: string; // opponent's best continuation after the player's move
  engineStrength: string;
  playerLevel: string;
}

export interface CoachCommentResponse {
  comment: string; // empty = nothing worth saying
  category: MistakeCategory | null;
}
