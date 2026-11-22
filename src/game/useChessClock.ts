import { useEffect, useRef, useState } from 'react';
import type { TimeControl } from '../config';
import type { ClockSnapshot } from '../../shared/coach-types';

type Side = 'w' | 'b';

interface Options {
  control: TimeControl | null; // null = untimed
  plies: number; // moves played so far
  turn: Side; // side to move
  live: boolean; // false while the game is over or the engine is loading; the clock stops
  onFlag: (side: Side) => void; // a side ran out of time
}

/**
 * A chess clock driven by the move count. Clocks start after White's first move (that move is
 * free), the mover's time is charged and its increment added after each move, and a take-back
 * just hands the clock to the side to move. It pauses while the app is hidden (iPad locked,
 * app switched, window closed), so walking away never costs time.
 */
export function useChessClock({ control, plies, turn, live, onFlag }: Options) {
  const time = useRef({ w: 0, b: 0 });
  const started = useRef(false);
  const since = useRef<number | null>(null); // when the side to move's clock started running
  const runningSide = useRef<Side | null>(null);
  const lastPlies = useRef(plies);
  const flagged = useRef(false);
  const onFlagRef = useRef(onFlag);
  onFlagRef.current = onFlag;
  const [, setTick] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

  /** Charges the running side for the time since its clock started. */
  const charge = () => {
    const side = runningSide.current;
    if (side && since.current !== null) time.current[side] = Math.max(0, time.current[side] - (Date.now() - since.current));
    since.current = null;
  };

  const reset = (tc: TimeControl | null) => {
    time.current = { w: tc?.baseMs ?? 0, b: tc?.baseMs ?? 0 };
    started.current = false;
    since.current = null;
    runningSide.current = null;
    flagged.current = false;
    setTick((t) => t + 1);
  };

  const snapshot = (): ClockSnapshot | null => {
    if (!control) return null;
    const side = runningSide.current;
    const run = side && since.current !== null ? Date.now() - since.current : 0;
    return {
      controlId: control.id,
      white: side === 'w' ? Math.max(0, time.current.w - run) : time.current.w,
      black: side === 'b' ? Math.max(0, time.current.b - run) : time.current.b,
      started: started.current,
    };
  };

  /** Picks up a saved game's clocks (paused until play resumes). `atPlies` is its move count. */
  const restore = (s: ClockSnapshot, atPlies: number) => {
    lastPlies.current = atPlies;
    time.current = { w: s.white, b: s.black };
    started.current = s.started;
    since.current = null;
    runningSide.current = null;
    flagged.current = false;
    setTick((t) => t + 1);
  };

  // A move, a take-back or a new game: settle the clocks and hand over to the side to move.
  useEffect(() => {
    const prev = lastPlies.current;
    lastPlies.current = plies;
    if (!control) return;
    if (plies === prev + 1) {
      const mover: Side = turn === 'w' ? 'b' : 'w';
      if (started.current) {
        charge();
        time.current[mover] += control.incrementMs;
      } else if (mover === 'w') {
        started.current = true; // White's first move is free; the clocks start now
      }
    } else {
      charge(); // take-back or position change: whoever was thinking keeps the time they used
    }
    runningSide.current = started.current ? turn : null;
    since.current = started.current && live && visible ? Date.now() : null;
    setTick((t) => t + 1);
    // Only a change in the move count hands the clock over.
  }, [plies]);

  // Stop while the game is over, loading or hidden; restart when play resumes.
  useEffect(() => {
    if (!control || !started.current) return;
    if (live && visible) {
      runningSide.current = turn;
      if (since.current === null) since.current = Date.now();
    } else {
      charge();
    }
    setTick((t) => t + 1);
  }, [live, visible, control]);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Tick while a clock runs; flag the side whose time reaches zero.
  useEffect(() => {
    if (!control) return;
    const id = setInterval(() => {
      const side = runningSide.current;
      if (!side || since.current === null) return;
      const left = time.current[side] - (Date.now() - since.current);
      if (left <= 0 && !flagged.current) {
        charge();
        time.current[side] = 0;
        flagged.current = true;
        onFlagRef.current(side);
      }
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(id);
  }, [control]);

  const side = runningSide.current;
  const run = side && since.current !== null ? Date.now() - since.current : 0;
  return {
    white: side === 'w' ? Math.max(0, time.current.w - run) : time.current.w,
    black: side === 'b' ? Math.max(0, time.current.b - run) : time.current.b,
    active: since.current !== null ? side : null,
    reset,
    snapshot,
    restore,
  };
}

/** 9:05, or 0:07.3 under ten seconds. */
export function formatClock(ms: number): string {
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
