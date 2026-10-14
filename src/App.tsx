import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move, type Square } from 'chess.js';
import { Chessboard, type PieceDropHandlerArgs } from 'react-chessboard';
import { StockfishEngine, type AnalysisInfo } from './engine/stockfish';
import { pvToSan } from './engine/format';
import { EvalBar } from './components/EvalBar';
import { EngineLine, type EngineView } from './components/EngineLine';
import { MoveList } from './components/MoveList';
import { CoachPanel, type CoachNote } from './components/CoachPanel';
import { fetchRating, requestChat, requestComment, requestHint, requestReview, saveGame } from './coach/api';
import { RatingBadge } from './components/RatingBadge';
import type { RatingSummary } from '../shared/rating';
import { ReviewPanel, type ReviewState } from './components/ReviewPanel';
import { OpeningPanel } from './components/OpeningPanel';
import { CapturedPieces } from './components/CapturedPieces';
import { useFitToWindow } from './components/useFitToWindow';
import { bookFor, openingById, openingContext, pickBookReply, positionKey } from './openings/book';
import { analyzePlayerMoves, pickCriticalMoments } from './review/criticalMoments';
import { HistoryPanel } from './components/HistoryPanel';
import { detectKeyMoment, detectTrigger, numberMoves, toPlayerScore } from './coach/triggers';
import {
  buildCoachRequest,
  buildLastMoveInfo,
  buildPositionInfo,
  type PlayerMove,
  type RequestContext,
} from './coach/request';
import type {
  CoachTrigger,
  GameResult,
  HintLevel,
  MistakeRecord,
  PatternTag,
  SaveGameRequest,
  TranscriptEntry,
} from '../shared/coach-types';
import {
  ANALYSIS_DEPTH,
  BEST_LINE_LENGTH,
  COACH,
  DEFAULT_PRESET_INDEX,
  ENGINE_MOVE_TIME_MS,
  HISTORY_LAST_N,
  STRENGTH_PRESETS,
} from './config';

type Color = 'white' | 'black';
type OpeningChoice = Record<Color, string | null>;

// Stockfish's book replies come after a short pause so they don't feel instant.
const BOOK_REPLY_DELAY_MS = 500;
const DEFAULT_OPENINGS: OpeningChoice = { white: 'london', black: 'dragon' };

/** Per-browser preferences; storage may be unavailable (private mode), so never rely on it. */
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: preferences just won't persist
  }
}
type PromotionPiece = 'q' | 'r' | 'b' | 'n';

const TRIGGER_LABEL: Record<CoachTrigger, string> = {
  swing: 'Eval drop',
  'missed-mate': 'Missed mate',
  periodic: 'Check-in',
  ask: 'You asked',
  'key-moment': 'Key moment',
};

function resultCode(game: Chess, resignedBy: Color | null): GameResult {
  if (resignedBy) return resignedBy === 'white' ? '0-1' : '1-0';
  if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0';
  if (game.isDraw()) return '1/2-1/2';
  return '*';
}

function gameOverText(game: Chess, resignedBy: Color | null): string | null {
  if (resignedBy) return `${resignedBy === 'white' ? 'White' : 'Black'} resigned.`;
  if (game.isCheckmate()) return `Checkmate. ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (game.isStalemate()) return 'Draw by stalemate.';
  if (game.isThreefoldRepetition()) return 'Draw by threefold repetition.';
  if (game.isInsufficientMaterial()) return 'Draw by insufficient material.';
  if (game.isDraw()) return 'Draw by the 50-move rule.';
  return null;
}

export default function App() {
  // chess.js is the single source of truth for board state and legality.
  const gameRef = useRef(new Chess());
  // Opponent engine (strength-limited) and a separate full-strength engine for analysis,
  // so the eval bar and best line are never weakened by the opponent's strength setting.
  const engineRef = useRef<StockfishEngine | null>(null);
  const analyzerRef = useRef<StockfishEngine | null>(null);
  // Incremented on every new game so stale engine replies are discarded.
  const gameIdRef = useRef(0);

  const [fen, setFen] = useState(gameRef.current.fen());
  const [myColor, setMyColor] = useState<Color>('white');
  const [presetIndex, setPresetIndex] = useState(DEFAULT_PRESET_INDEX);
  const [promotion, setPromotion] = useState<PromotionPiece>('q');
  const [thinking, setThinking] = useState(false);
  const [resignedBy, setResignedBy] = useState<Color | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [analysis, setAnalysis] = useState<(AnalysisInfo & { fen: string }) | null>(null);
  // Deepest analysis seen per position, and the last position whose analysis finished.
  // The coach and the opponent both wait for the finished analysis.
  const analysesRef = useRef(new Map<string, AnalysisInfo>());
  const [analyzedFen, setAnalyzedFen] = useState<string | null>(null);

  // Coach state. Refs hold what the async coach logic reads; state drives rendering.
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);
  const [callsUsed, setCallsUsed] = useState(0);
  const [periodicOn, setPeriodicOn] = useState(COACH.periodicDefaultOn);
  // How much engine analysis to show while playing (the eval bar and the Stockfish box).
  const [engineView, setEngineView] = useState<EngineView>(() => loadPref('engineView', 'full'));
  const [showCaptured, setShowCaptured] = useState<boolean>(() => loadPref('showCaptured', false));
  const [keyMomentsOn, setKeyMomentsOn] = useState<boolean>(() => loadPref('keyMoments', COACH.keyMomentsDefaultOn));
  // Async coach calls read the coach panel through this ref, so they always see the latest notes.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const coachBusyRef = useRef(false);
  const callsUsedRef = useRef(0);
  const pendingReviewRef = useRef<PlayerMove | null>(null); // awaiting analysis
  const lastPlayerMoveRef = useRef<PlayerMove | null>(null);
  const playerMoveCountRef = useRef(0);
  const noteIdRef = useRef(0);
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
  // Hints given for the current position; a new position starts again at level 1.
  const [hints, setHints] = useState<{ fen: string; texts: string[] }>({ fen: '', texts: [] });

  // Mistakes found by Stockfish this game, keyed by ply. The coach's tag and note are added
  // when its comment arrives. The game is saved to SQLite once it ends.
  const mistakesRef = useRef(new Map<number, MistakeRecord>());
  const savedGameRef = useRef<number | null>(null); // gameIdRef value already saved
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  // Estimated Claude API cost of this game's coach calls (from the server's token counts).
  const [gameCost, setGameCost] = useState(0);
  const gameCostRef = useRef(0);

  // Post-game review: available once the finished game is saved (it needs the game's id).
  const [savedGameId, setSavedGameId] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewState>({ kind: 'idle' });

  // The right-hand column fits the window on wide screens and scrolls inside.
  const controlsRef = useRef<HTMLElement>(null);
  useFitToWindow(controlsRef, ['.app-header']);

  // In-app rating, refreshed whenever a game is saved (historyKey changes).
  const [rating, setRating] = useState<RatingSummary | null>(null);
  useEffect(() => {
    fetchRating()
      .then(setRating)
      .catch(() => setRating(null));
  }, [historyKey]);
  // Tells the coach the player's level: the configured description, else the in-app rating.
  const playerLevel =
    COACH.playerLevel !== 'not specified'
      ? COACH.playerLevel
      : rating && rating.games > 0
        ? `app rating about ${rating.rating}${rating.provisional ? ` (provisional, ${rating.games} game${rating.games === 1 ? "" : "s"})` : ''}`
        : 'not specified';

  // Opening trainer: one chosen opening per colour, and whether Stockfish plays book replies.
  const [openingChoice, setOpeningChoice] = useState<OpeningChoice>(() => loadPref('openingChoice', DEFAULT_OPENINGS));
  const [followBook, setFollowBook] = useState<boolean>(() => loadPref('followBook', true));
  // engineMove is created once, so it reads these through refs.
  const bookRef = useRef({ openingId: openingChoice[myColor], followBook, myColor });
  bookRef.current = { openingId: openingChoice[myColor], followBook, myColor };

  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;
    engine.setStrength(STRENGTH_PRESETS[DEFAULT_PRESET_INDEX].strength).then(() => setEngineReady(true));
    const analyzer = new StockfishEngine();
    analyzerRef.current = analyzer;
    return () => {
      engine.terminate();
      analyzer.terminate();
      engineRef.current = null;
      analyzerRef.current = null;
    };
  }, []);

  // Re-analyze whenever the position changes; any older search is cancelled.
  useEffect(() => {
    const analyzer = analyzerRef.current;
    if (!analyzer) return;
    analyzer.stopSearch();
    if (gameRef.current.isGameOver()) return;
    const analyses = analysesRef.current;
    void analyzer
      .analyze(fen, ANALYSIS_DEPTH, (info) => {
        analyses.set(fen, info);
        setAnalysis({ ...info, fen });
      })
      .then((finished) => {
        if (finished) setAnalyzedFen(fen);
      });
  }, [fen]);

  const game = gameRef.current;
  const status = gameOverText(game, resignedBy);
  const isOver = status !== null;
  const myTurn = game.turn() === myColor[0];

  const engineMove = useCallback(async () => {
    const engine = engineRef.current;
    const g = gameRef.current;
    if (!engine || g.isGameOver()) return;
    const id = gameIdRef.current;
    setThinking(true);
    try {
      // While the game is in the opening book you are practising, Stockfish can play a book
      // reply (weighted toward the main line) instead of searching.
      const { openingId, followBook: follow, myColor: playerColor } = bookRef.current;
      const opening = openingById(openingId);
      if (follow && opening && opening.side === playerColor) {
        const reply = pickBookReply(bookFor(opening.id).get(positionKey(g.fen())) ?? []);
        if (reply) {
          await new Promise((r) => setTimeout(r, BOOK_REPLY_DELAY_MS));
          if (id !== gameIdRef.current) return;
          g.move(reply.san);
          setFen(g.fen());
          return;
        }
      }
      const uci = await engine.getMove(g.fen(), ENGINE_MOVE_TIME_MS);
      if (id !== gameIdRef.current || !uci) return; // game was reset meanwhile
      g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      setFen(g.fen());
    } finally {
      if (id === gameIdRef.current) setThinking(false);
    }
  }, []);

  // Let the engine move once the position after your move has been fully analyzed,
  // so the coach always gets complete engine data for your move.
  const positionAnalyzed = analyzedFen === fen;
  // Coach calls about the current position wait for Stockfish: the analysis must be finished
  // and the opponent must not be searching.
  const coachReady = isOver || (positionAnalyzed && !thinking);
  const hintsGiven = hints.fen === fen ? hints.texts.length : 0;
  const nextHint: HintLevel | null = hintsGiven < 3 ? ((hintsGiven + 1) as HintLevel) : null;
  useEffect(() => {
    if (engineReady && !isOver && !myTurn && !thinking && positionAnalyzed) void engineMove();
  }, [engineReady, fen, isOver, myTurn, thinking, positionAnalyzed, engineMove]);

  const requestContext = (): RequestContext => ({
    history: gameRef.current.history(),
    myColor,
    analysisOf: (f) => analysesRef.current.get(f),
    engineStrength: STRENGTH_PRESETS[presetIndex].label,
    playerLevel,
    recentPlies: COACH.recentPlies,
    bestLineLength: BEST_LINE_LENGTH,
    opening: openingContext(openingById(openingChoice[myColor]), gameRef.current.history(), myColor),
  });

  const addNote = (note: Omit<CoachNote, 'id'>) => setNotes((n) => [...n, { ...note, id: ++noteIdRef.current }]);

  /**
   * Runs one coach call: one at a time, counted against the per-game cap, and dropped if a
   * new game starts meanwhile. Errors become a note labelled `errorLabel`.
   */
  async function runCoach<T extends { costUsd: number }>(
    call: () => Promise<T>,
    onResult: (r: T) => void,
    errorLabel: string,
  ): Promise<boolean> {
    if (coachBusyRef.current || callsUsedRef.current >= COACH.maxCallsPerGame) return false;
    const id = gameIdRef.current;
    coachBusyRef.current = true;
    callsUsedRef.current++;
    setCoachBusy(true);
    setCallsUsed(callsUsedRef.current);
    try {
      const res = await call();
      if (id === gameIdRef.current) {
        gameCostRef.current += res.costUsd;
        setGameCost(gameCostRef.current);
        onResult(res);
      }
      setHistoryKey((k) => k + 1); // refresh the app-wide spend
    } catch (err) {
      if (id === gameIdRef.current) {
        addNote({ from: 'error', label: errorLabel, text: err instanceof Error ? err.message : 'The coach request failed.' });
      }
    } finally {
      if (id === gameIdRef.current) {
        coachBusyRef.current = false;
        setCoachBusy(false);
      }
    }
    return true;
  }

  /** What has been said in the coach panel this game (oldest first), so the coach can follow on. */
  function transcript(dropTrailingQuestion?: string): TranscriptEntry[] {
    let entries = notesRef.current.filter((n) => n.from !== 'error');
    const last = entries[entries.length - 1];
    if (dropTrailingQuestion && last?.from === 'you' && last.text === dropTrailingQuestion) entries = entries.slice(0, -1);
    return entries.slice(-COACH.transcriptEntries).map((n) => ({ from: n.from === 'you' ? 'you' : 'coach', label: n.label, text: n.text }));
  }

  /** Patterns the coach has tagged on this game's mistakes so far. */
  const patternsThisGame = (): PatternTag[] =>
    [...mistakesRef.current.values()].map((m) => m.pattern).filter((p): p is PatternTag => p !== null);

  function callCoach(m: PlayerMove, trigger: CoachTrigger, keyMoment: string | null = null) {
    const label = `${numberMoves([m.san], m.ply)} · ${TRIGGER_LABEL[trigger]}`;
    return runCoach(
      () =>
        requestComment({
          ...buildCoachRequest(m, trigger, requestContext()),
          keyMoment,
          transcript: transcript(),
          patternsThisGame: patternsThisGame(),
        }),
      (res) => {
        if (res.comment) addNote({ from: 'coach', label, text: res.comment, category: res.category, pattern: res.pattern });
        const mistake = mistakesRef.current.get(m.ply);
        if (mistake && res.comment) {
          mistake.category = res.category ?? mistake.category;
          mistake.pattern = res.pattern ?? mistake.pattern;
          mistake.coachNote = res.comment;
        }
      },
      label,
    );
  }

  /** The board now, as the coach sees it. Only called once Stockfish has finished with it. */
  function currentPosition() {
    const g = gameRef.current;
    return buildPositionInfo(g.fen(), g.turn() === myColor[0] ? 'player' : 'engine', status, requestContext());
  }

  function askHint() {
    const level = nextHint;
    if (!level) return;
    const position = currentPosition();
    const previousHints = hints.fen === position.fen ? hints.texts : [];
    void runCoach(
      () => requestHint({ level, position, previousHints }),
      (res) => {
        addNote({ from: 'coach', label: `Hint ${level}/3`, text: res.hint });
        setHints({ fen: position.fen, texts: [...previousHints, res.hint] });
      },
      `Hint ${level}/3`,
    );
  }

  function sendChat(question: string) {
    const position = currentPosition();
    const m = lastPlayerMoveRef.current;
    const lastMove = m ? buildLastMoveInfo(m, requestContext()) : null;
    void runCoach(
      () =>
        requestChat({
          question,
          history: [],
          transcript: transcript(question),
          patternsThisGame: patternsThisGame(),
          position,
          lastMove,
        }),
      (res) => addNote({ from: 'coach', label: 'Coach', text: res.reply }),
      'Coach',
    );
  }

  // A chat question waits until Stockfish has finished with the current position and the
  // coach is free, so it never goes out with half-computed engine data.
  useEffect(() => {
    if (queuedQuestion === null || !coachReady || coachBusy) return;
    setQueuedQuestion(null);
    sendChat(queuedQuestion);
    // sendChat reads the latest position from refs and state.
  }, [queuedQuestion, coachReady, coachBusy]);

  // When analysis of the position after your move finishes, decide whether the coach speaks.
  useEffect(() => {
    const m = pendingReviewRef.current;
    if (!m || analyzedFen !== m.fenAfter) return;
    pendingReviewRef.current = null;
    const before = analysesRef.current.get(m.fenBefore);
    const after = analysesRef.current.get(m.fenAfter);
    const keyMoment = keyMomentsOn ? detectKeyMoment(m.fenBefore, m.uci) : null;
    const trigger = detectTrigger(
      before ? toPlayerScore(before.score, myColor) : null,
      after ? toPlayerScore(after.score, myColor) : null,
      {
        thresholdCp: COACH.swingThresholdCp,
        periodicDue: periodicOn && playerMoveCountRef.current % COACH.periodicEvery === 0,
        keyMoment: keyMoment !== null,
      },
    );
    if (trigger === 'swing' || trigger === 'missed-mate') {
      const info = buildLastMoveInfo(m, requestContext());
      mistakesRef.current.set(m.ply, {
        moveNumber: Math.floor(m.ply / 2) + 1,
        fen: m.fenBefore,
        myMove: m.san,
        bestMove: info.engineTopMove,
        evalBefore: info.evalBefore?.score ?? null,
        evalAfter: info.evalAfter?.score ?? null,
        category: null,
        pattern: null,
        coachNote: null,
      });
    }
    if (trigger) void callCoach(m, trigger, trigger === 'key-moment' ? keyMoment : null);
    // Runs only when an analysis finishes; callCoach reads the latest settings from refs and state.
  }, [analyzedFen]);

  /** Snapshot of the current game for the database. */
  function gameRecord(result: GameResult): SaveGameRequest {
    const g = gameRef.current;
    const preset = STRENGTH_PRESETS[presetIndex];
    const engineName = `Stockfish, ${preset.label}`;
    g.setHeader('Event', 'Chess Coach');
    g.setHeader('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
    g.setHeader('White', myColor === 'white' ? 'You' : engineName);
    g.setHeader('Black', myColor === 'black' ? 'You' : engineName);
    g.setHeader('Result', result);
    return {
      pgn: g.pgn(),
      result,
      engineElo: preset.strength.kind === 'elo' ? preset.strength.elo : null,
      engineLabel: preset.label,
      myColor,
      mistakes: [...mistakesRef.current.values()],
      coachCostUsd: gameCostRef.current,
    };
  }

  async function persistGame(record: SaveGameRequest) {
    const n = record.mistakes.length;
    const id = gameIdRef.current;
    try {
      const { gameId } = await saveGame(record);
      if (record.result !== '*' && id === gameIdRef.current) setSavedGameId(gameId);
      setSaveNote(`Game saved${n ? ` with ${n} mistake${n === 1 ? '' : 's'}` : ''}.`);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setSaveNote(`Game not saved: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // Save once the game ends, after any coach comment still in flight has landed.
  useEffect(() => {
    if (!isOver || coachBusy || savedGameRef.current === gameIdRef.current) return;
    savedGameRef.current = gameIdRef.current;
    void persistGame(gameRecord(resultCode(gameRef.current, resignedBy)));
    // gameRecord reads the finished game from refs and current settings.
  }, [isOver, coachBusy]);

  /** Analyzes one position at full depth for the review, keeping the result in the cache. */
  async function analyzeForReview(fenToAnalyze: string): Promise<AnalysisInfo | null> {
    const analyzer = analyzerRef.current;
    if (!analyzer) return null;
    let last: AnalysisInfo | null = null;
    const finished = await analyzer.analyze(fenToAnalyze, ANALYSIS_DEPTH, (info) => (last = info));
    if (!finished || !last) return null;
    analysesRef.current.set(fenToAnalyze, last);
    return last;
  }

  async function startReview() {
    if (savedGameId === null || review.kind === 'analyzing' || review.kind === 'asking') return;
    const id = gameIdRef.current;
    const g = gameRef.current;
    setReview({ kind: 'analyzing', done: 0, total: 0 });
    requestAnimationFrame(() => document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    // 1. Stockfish pass over every one of your moves (reusing analysis from the game).
    const candidates = await analyzePlayerMoves({
      pgnMoves: g.history(),
      myColor,
      depth: ANALYSIS_DEPTH,
      cached: (f) => analysesRef.current.get(f),
      analyze: analyzeForReview,
      onProgress: (done, total) => id === gameIdRef.current && setReview({ kind: 'analyzing', done, total }),
      bestLineLength: BEST_LINE_LENGTH,
    });
    if (id !== gameIdRef.current) return;
    if (!candidates) {
      setReview({ kind: 'error', message: 'The Stockfish pass was interrupted. Press Review again.' });
      return;
    }
    // 2. The 3-5 biggest swings go to the review model with the game and your mistake history.
    setReview({ kind: 'asking' });
    try {
      const result = await requestReview({
        gameId: savedGameId,
        pgn: gameRecord(resultCode(g, resignedBy)).pgn,
        myColor,
        result: resultCode(g, resignedBy),
        engineStrength: STRENGTH_PRESETS[presetIndex].label,
        playerLevel,
        opening: openingContext(openingById(openingChoice[myColor]), g.history(), myColor),
        moments: pickCriticalMoments(candidates),
      });
      if (id !== gameIdRef.current) return;
      gameCostRef.current += result.costUsd;
      setGameCost(gameCostRef.current);
      setReview({ kind: 'done', review: result });
      setHistoryKey((k) => k + 1); // review tags update the mistake summary and spend
    } catch (err) {
      if (id === gameIdRef.current) {
        setReview({ kind: 'error', message: err instanceof Error ? err.message : 'The review failed.' });
      }
    }
  }

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare || isOver || !myTurn || thinking) return false;
    let move: Move;
    try {
      const piece = game.get(sourceSquare as Square);
      const isPromotion =
        piece?.type === 'p' && (targetSquare[1] === '8' || targetSquare[1] === '1');
      move = game.move({ from: sourceSquare, to: targetSquare, promotion: isPromotion ? promotion : undefined });
    } catch {
      return false; // illegal move — chess.js throws
    }
    const record: PlayerMove = {
      ply: game.history().length - 1,
      san: move.san,
      uci: move.lan,
      fenBefore: move.before,
      fenAfter: move.after,
    };
    playerMoveCountRef.current++;
    pendingReviewRef.current = record;
    lastPlayerMoveRef.current = record;
    setFen(game.fen());
    return true;
  }

  async function newGame(color: Color = myColor) {
    // An abandoned game with at least one of your moves is saved as unfinished ('*').
    if (!isOver && playerMoveCountRef.current > 0 && savedGameRef.current !== gameIdRef.current) {
      savedGameRef.current = gameIdRef.current;
      void persistGame(gameRecord('*'));
    } else {
      setSaveNote(null);
    }
    gameIdRef.current++;
    setThinking(false);
    gameRef.current = new Chess();
    setResignedBy(null);
    setMyColor(color);
    analysesRef.current.clear();
    pendingReviewRef.current = null;
    lastPlayerMoveRef.current = null;
    playerMoveCountRef.current = 0;
    coachBusyRef.current = false;
    callsUsedRef.current = 0;
    setCoachBusy(false);
    setCallsUsed(0);
    setNotes([]);
    setQueuedQuestion(null);
    setHints({ fen: '', texts: [] });
    mistakesRef.current = new Map();
    setSavedGameId(null);
    setReview({ kind: 'idle' });
    gameCostRef.current = 0;
    setGameCost(0);
    // Queue the engine reset first (it runs before any later search), then show the new
    // board right away so the status and the board never disagree.
    const engineReset = engineRef.current?.newGame();
    setFen(gameRef.current.fen());
    await engineReset;
  }

  async function changeStrength(index: number) {
    setPresetIndex(index);
    setEngineReady(false);
    await engineRef.current?.setStrength(STRENGTH_PRESETS[index].strength);
    setEngineReady(true);
  }

  let turnText: string;
  if (status) turnText = status;
  else if (!engineReady) turnText = 'Loading engine…';
  else if (myTurn) turnText = game.inCheck() ? 'Your move — you are in check.' : 'Your move.';
  else turnText = 'Stockfish is thinking…';

  // Only show analysis that belongs to the position on the board.
  const current = analysis?.fen === fen ? analysis : null;
  // Once the game ends, the bar shows the result instead of an engine score.
  let barScore = current?.score ?? null;
  let resultLabel: string | null = null;
  if (resignedBy) {
    barScore = { mate: resignedBy === 'white' ? -1 : 1 };
    resultLabel = resignedBy === 'white' ? '0-1' : '1-0';
  } else if (game.isCheckmate()) {
    barScore = { mate: game.turn() === 'w' ? -1 : 1 };
    resultLabel = game.turn() === 'w' ? '0-1' : '1-0';
  } else if (game.isDraw()) {
    barScore = { cp: 0 };
    resultLabel = '½-½';
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chess Coach</h1>
        <RatingBadge rating={rating} />
      </header>
      <main>
        <div className="left-col">
        <div className="board-wrap">
          <EvalBar score={barScore} resultLabel={resultLabel} orientation={myColor} hidden={engineView === 'hidden' && !isOver} />
          <div className="board">
          <Chessboard
            options={{
              id: 'main-board',
              position: fen,
              boardOrientation: myColor,
              onPieceDrop,
              allowDragging: !isOver && myTurn && !thinking,
              canDragPiece: ({ piece }) => piece.pieceType[0] === myColor[0],
            }}
          />
          </div>
        </div>
        <OpeningPanel
          openingId={openingChoice[myColor]}
          onChange={(id) => {
            const next = { ...openingChoice, [myColor]: id };
            setOpeningChoice(next);
            savePref('openingChoice', next);
          }}
          myColor={myColor}
          history={game.history()}
          fen={fen}
          followBook={followBook}
          onToggleFollow={(on) => {
            setFollowBook(on);
            savePref('followBook', on);
          }}
        />
        </div>
        <aside className="controls" ref={controlsRef}>
          <p className={`status${isOver ? ' over' : ''}`}>{turnText}</p>
          {isOver && (
            <div className="review-cta">
              <button
                id="review-button"
                className="primary"
                onClick={() => void startReview()}
                disabled={savedGameId === null || review.kind === 'analyzing' || review.kind === 'asking'}
              >
                {review.kind === 'done' ? 'Show review again' : 'Review this game'}
              </button>
              <span className="review-hint">
                {savedGameId === null ? 'Saving the game…' : 'Stockfish finds your biggest mistakes; Opus explains them (roughly 5-10 cents).'}
              </span>
            </div>
          )}

          <CoachPanel
            notes={notes}
            status={
              coachBusy ? 'Coach is thinking…' : queuedQuestion !== null ? 'Waiting for Stockfish to finish…' : null
            }
            callsUsed={callsUsed}
            callsMax={COACH.maxCallsPerGame}
            gameCostUsd={gameCost}
            canAsk={lastPlayerMoveRef.current !== null && !coachBusy}
            onAsk={() => lastPlayerMoveRef.current && void callCoach(lastPlayerMoveRef.current, 'ask')}
            nextHint={nextHint}
            hintEnabled={coachReady && myTurn && !isOver && !coachBusy}
            onHint={askHint}
            chatEnabled={queuedQuestion === null && !coachBusy}
            onSend={(q) => {
              addNote({ from: 'you', label: 'You', text: q });
              setQueuedQuestion(q);
            }}
            periodicOn={periodicOn}
            onTogglePeriodic={setPeriodicOn}
            showCaptured={showCaptured}
            onToggleCaptured={(on) => {
              setShowCaptured(on);
              savePref('showCaptured', on);
            }}
            captured={
              <CapturedPieces
                history={game.history()}
                myColor={myColor}
                onClose={() => {
                  setShowCaptured(false);
                  savePref('showCaptured', false);
                }}
              />
            }
            keyMomentsOn={keyMomentsOn}
            onToggleKeyMoments={(on) => {
              setKeyMomentsOn(on);
              savePref('keyMoments', on);
            }}
          />

          <EngineLine
            score={current?.score ?? null}
            depth={current?.depth ?? 0}
            line={current ? pvToSan(fen, current.pv, BEST_LINE_LENGTH) : ''}
            gameOver={isOver ? 'Game over.' : null}
            view={engineView}
            onViewChange={(v) => {
              setEngineView(v);
              savePref('engineView', v);
            }}
          />

          <MoveList moves={game.history()} />

          <label>
            Engine strength
            <select value={presetIndex} onChange={(e) => void changeStrength(Number(e.target.value))}>
              {STRENGTH_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Promote pawns to
            <select value={promotion} onChange={(e) => setPromotion(e.target.value as PromotionPiece)}>
              <option value="q">Queen</option>
              <option value="r">Rook</option>
              <option value="b">Bishop</option>
              <option value="n">Knight</option>
            </select>
          </label>

          <div className="buttons">
            <button onClick={() => void newGame('white')}>New game as White</button>
            <button onClick={() => void newGame('black')}>New game as Black</button>
            <button className="danger" disabled={isOver} onClick={() => setResignedBy(myColor)}>
              Resign
            </button>
          </div>

          <HistoryPanel lastN={HISTORY_LAST_N} refreshKey={historyKey} saveNote={saveNote} />
        </aside>
      </main>
      <ReviewPanel state={review} orientation={myColor} />
    </div>
  );
}
