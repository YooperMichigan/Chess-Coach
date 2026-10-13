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
  costUsd: number; // estimated cost of this call
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
  costUsd: number; // estimated cost of this call
}

export type HintLevel = 1 | 2 | 3;

export interface CoachHintRequest {
  level: HintLevel;
  position: PositionInfo; // must be the player's turn
  previousHints: string[]; // hints already given for this position, level 1 first
}

export interface CoachHintResponse {
  hint: string;
  costUsd: number; // estimated cost of this call
}

// ---- Stage 5: saved games and mistakes ----

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'; // '*' = unfinished

/** A move that cost the player more than the alert threshold, or missed a forced mate. */
export interface MistakeRecord {
  moveNumber: number; // full-move number, e.g. 4 for 4.Nxe5
  fen: string; // position before the mistake
  myMove: string; // SAN
  bestMove: string | null; // engine's choice, SAN
  evalBefore: PlayerScore | null;
  evalAfter: PlayerScore | null;
  category: MistakeCategory | null; // from the coach, when it commented
  coachNote: string | null;
}

export interface SaveGameRequest {
  pgn: string;
  result: GameResult;
  engineElo: number | null; // null for Skill Level presets
  engineLabel: string; // e.g. "Elo 1500" or "Beginner (Skill 0)"
  myColor: 'white' | 'black';
  mistakes: MistakeRecord[];
  coachCostUsd: number; // estimated Claude API cost of this game's coach calls
}

export interface SaveGameResponse {
  gameId: number;
}

export interface MistakeSummary {
  gamesSaved: number; // all time
  lastN: number; // games the counts below cover
  categories: { category: MistakeCategory; count: number }[];
  uncategorized: number; // mistakes the coach did not tag (e.g. comment cap reached)
}

/** Estimated Claude API spend recorded by this app. */
export interface UsageSummary {
  totalUsd: number;
  monthUsd: number; // current calendar month (UTC)
  calls: number;
}

// ---- Stage 6: post-game review ----

/** One of the biggest eval swings in the game, found by a Stockfish pass over every move. */
export interface CriticalMoment {
  ply: number; // index in the game history
  moveNumber: number; // full-move number
  fen: string; // position before the player's move
  myMove: string; // SAN
  myMoveUci: string;
  bestMove: string | null; // Stockfish's choice in that position, SAN
  bestMoveUci: string | null;
  bestLine: string; // Stockfish's line from the position before the move
  replyLine: string; // Stockfish's line after the player's move (how it gets punished)
  evalBefore: PlayerScore | null;
  evalAfter: PlayerScore | null;
}

export interface ReviewRequest {
  gameId: number; // the saved game
  pgn: string; // the full game is allowed for the post-game review
  myColor: 'white' | 'black';
  result: GameResult;
  engineStrength: string;
  playerLevel: string;
  moments: CriticalMoment[]; // 0-5, largest swings first
}

export interface ReviewedMoment extends CriticalMoment {
  explanation: string;
  category: MistakeCategory | null;
}

export interface GameReview {
  gameId: number;
  moments: ReviewedMoment[];
  summary: string; // what happened in this game
  recurring: string; // recurring weaknesses across recent games
  focus: string; // one thing to work on next game
  costUsd: number; // cost of this review call (0 if it was already stored)
}
