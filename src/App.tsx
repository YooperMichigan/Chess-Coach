import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move, type Square } from 'chess.js';
import { Chessboard, type PieceDropHandlerArgs } from 'react-chessboard';
import { StockfishEngine, type AnalysisInfo } from './engine/stockfish';
import { pvToSan } from './engine/format';
import { EvalBar } from './components/EvalBar';
import { EngineLine } from './components/EngineLine';
import { MoveList } from './components/MoveList';
import { CoachPanel, type CoachNote } from './components/CoachPanel';
import { requestComment } from './coach/api';
import { detectTrigger, numberMoves, toPlayerScore } from './coach/triggers';
import { buildCoachRequest, type PlayerMove } from './coach/request';
import type { CoachTrigger } from '../shared/coach-types';
import {
  ANALYSIS_DEPTH,
  BEST_LINE_LENGTH,
  COACH,
  DEFAULT_PRESET_INDEX,
  ENGINE_MOVE_TIME_MS,
  STRENGTH_PRESETS,
} from './config';

type Color = 'white' | 'black';
type PromotionPiece = 'q' | 'r' | 'b' | 'n';

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
  const coachBusyRef = useRef(false);
  const callsUsedRef = useRef(0);
  const pendingReviewRef = useRef<PlayerMove | null>(null); // awaiting analysis
  const lastPlayerMoveRef = useRef<PlayerMove | null>(null);
  const playerMoveCountRef = useRef(0);
  const noteIdRef = useRef(0);

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
  useEffect(() => {
    if (engineReady && !isOver && !myTurn && !thinking && positionAnalyzed) void engineMove();
  }, [engineReady, fen, isOver, myTurn, thinking, positionAnalyzed, engineMove]);

  async function callCoach(m: PlayerMove, trigger: CoachTrigger) {
    // One call at a time, and never past the per-game cap.
    if (coachBusyRef.current || callsUsedRef.current >= COACH.maxCallsPerGame) return;
    const id = gameIdRef.current;
    const request = buildCoachRequest(m, trigger, {
      history: gameRef.current.history(),
      myColor,
      analysisOf: (f) => analysesRef.current.get(f),
      engineStrength: STRENGTH_PRESETS[presetIndex].label,
      playerLevel: COACH.playerLevel,
      recentPlies: COACH.recentPlies,
      bestLineLength: BEST_LINE_LENGTH,
    });
    const moveLabel = numberMoves([m.san], m.ply);
    coachBusyRef.current = true;
    callsUsedRef.current++;
    setCoachBusy(true);
    setCallsUsed(callsUsedRef.current);
    try {
      const res = await requestComment(request);
      if (id !== gameIdRef.current) return;
      if (res.comment) {
        setNotes((n) => [...n, { id: ++noteIdRef.current, moveLabel, trigger, text: res.comment, category: res.category }]);
      }
    } catch (err) {
      if (id !== gameIdRef.current) return;
      const text = err instanceof Error ? err.message : 'The coach request failed.';
      setNotes((n) => [...n, { id: ++noteIdRef.current, moveLabel, trigger, text, category: null, error: true }]);
    } finally {
      if (id === gameIdRef.current) {
        coachBusyRef.current = false;
        setCoachBusy(false);
      }
    }
  }

  // When analysis of the position after your move finishes, decide whether the coach speaks.
  useEffect(() => {
    const m = pendingReviewRef.current;
    if (!m || analyzedFen !== m.fenAfter) return;
    pendingReviewRef.current = null;
    const before = analysesRef.current.get(m.fenBefore);
    const after = analysesRef.current.get(m.fenAfter);
    const trigger = detectTrigger(
      before ? toPlayerScore(before.score, myColor) : null,
      after ? toPlayerScore(after.score, myColor) : null,
      {
        thresholdCp: COACH.swingThresholdCp,
        periodicDue: periodicOn && playerMoveCountRef.current % COACH.periodicEvery === 0,
      },
    );
    if (trigger) void callCoach(m, trigger);
    // Runs only when an analysis finishes; callCoach reads the latest settings from refs and state.
  }, [analyzedFen]);

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
    await engineRef.current?.newGame();
    setFen(gameRef.current.fen());
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
      <header>
        <h1>Chess Coach</h1>
      </header>
      <main>
        <div className="board-wrap">
          <EvalBar score={barScore} resultLabel={resultLabel} orientation={myColor} />
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
        <aside className="controls">
          <p className={`status${isOver ? ' over' : ''}`}>{turnText}</p>

          <CoachPanel
            notes={notes}
            busy={coachBusy}
            callsUsed={callsUsed}
            callsMax={COACH.maxCallsPerGame}
            canAsk={lastPlayerMoveRef.current !== null}
            periodicOn={periodicOn}
            onAsk={() => lastPlayerMoveRef.current && void callCoach(lastPlayerMoveRef.current, 'ask')}
            onTogglePeriodic={setPeriodicOn}
          />

          <EngineLine
            score={current?.score ?? null}
            depth={current?.depth ?? 0}
            line={current ? pvToSan(fen, current.pv, BEST_LINE_LENGTH) : ''}
            gameOver={isOver ? 'Game over.' : null}
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
        </aside>
      </main>
    </div>
  );
}
