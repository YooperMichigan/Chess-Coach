import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard, type PieceDropHandlerArgs } from 'react-chessboard';
import { StockfishEngine, type AnalysisInfo } from './engine/stockfish';
import { pvToSan } from './engine/format';
import { EvalBar } from './components/EvalBar';
import { EngineLine } from './components/EngineLine';
import { MoveList } from './components/MoveList';
import {
  ANALYSIS_DEPTH,
  BEST_LINE_LENGTH,
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
    void analyzer.analyze(fen, ANALYSIS_DEPTH, (info) => setAnalysis({ ...info, fen }));
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

  // Let the engine move whenever it's its turn.
  useEffect(() => {
    if (engineReady && !isOver && !myTurn && !thinking) void engineMove();
  }, [engineReady, fen, isOver, myTurn, thinking, engineMove]);

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare || isOver || !myTurn || thinking) return false;
    try {
      const piece = game.get(sourceSquare as Square);
      const isPromotion =
        piece?.type === 'p' && (targetSquare[1] === '8' || targetSquare[1] === '1');
      game.move({ from: sourceSquare, to: targetSquare, promotion: isPromotion ? promotion : undefined });
    } catch {
      return false; // illegal move — chess.js throws
    }
    setFen(game.fen());
    return true;
  }

  async function newGame(color: Color = myColor) {
    gameIdRef.current++;
    setThinking(false);
    gameRef.current = new Chess();
    setResignedBy(null);
    setMyColor(color);
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
