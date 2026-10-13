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

/** The position on the board right now, with Stockfish's view of it. */
export interface PositionInfo {
  fen: string;
  myColor: 'white' | 'black';
  recentMoves: string; // last 6-10 moves, numbered SAN
  toMove: 'player' | 'engine';
  gameResult: string | null; // e.g. "Checkmate. Black wins." once the game is over
  eval: EngineEval | null; // player's point of view; null = missing
  bestMove: string | null; // SAN, engine's choice for the side to move
  bestLine: string; // numbered SAN
  engineStrength: string;
  playerLevel: string;
}

/** Stockfish data about the player's most recent move. */
export interface LastMoveInfo {
  san: string;
  evalBefore: EngineEval | null;
  evalAfter: EngineEval | null;
  engineTopMove: string | null;
  wasTopChoice: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CoachChatRequest {
  question: string;
  history: ChatTurn[]; // earlier turns this game, most recent last (capped by the client)
  position: PositionInfo;
  lastMove: LastMoveInfo | null;
}

export interface CoachChatResponse {
  reply: string;
}

export type HintLevel = 1 | 2 | 3;

export interface CoachHintRequest {
  level: HintLevel;
  position: PositionInfo; // must be the player's turn
  previousHints: string[]; // hints already given for this position, level 1 first
}

export interface CoachHintResponse {
  hint: string;
}
