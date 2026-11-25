import { useCallback, useEffect, useReducer, useState } from 'react';
import { BALANCE, BattleSession, randomSeed, type GameMode } from '../engine';
import { TIMING, useAnimator } from './useAnimator';

export { TIMING } from './useAnimator';
export type { FloatItem, PoseState, ReelView, View } from './useAnimator';

export interface BattleOptions {
  mode: GameMode;
  seed?: number;
  speed: number;
  botPaused?: boolean;
}

/** Local battle (vs bot or hot-seat): engine session + presentation timeline. */
export function useBattle({ mode, seed, speed, botPaused }: BattleOptions) {
  const [session] = useState(() => new BattleSession(BALANCE, mode, seed ?? randomSeed()));
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const anim = useAnimator(speed);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => session.subscribe(rerender), [session]);

  const { play, snap } = anim;

  const spin = useCallback(
    (by: 'human' | 'bot' = 'human') => {
      const r = session.trySpin(by);
      if (r)
        play(r, () => {
          session.finishAnimation();
          if (r.outcome !== null) setShowResult(true);
        });
      return r;
    },
    [play, session],
  );

  // Bot plays with the same rules: it just presses the same button after a pause.
  const botTurn = session.isBotTurn() && session.phase === 'idle';
  useEffect(() => {
    if (!botTurn || botPaused) return;
    const t = window.setTimeout(() => spin('bot'), Math.round(TIMING.botDelay / Math.max(0.25, speed)));
    return () => window.clearTimeout(t);
  }, [botTurn, botPaused, spin, speed, session.state.spinCount]);

  const rematch = useCallback(() => {
    session.rematch();
    snap(session.state);
    setShowResult(false);
  }, [session, snap]);

  const restart = useCallback(
    (newSeed: number) => {
      session.restart(newSeed);
      snap(session.state);
      setShowResult(false);
    },
    [session, snap],
  );

  const debugSetHp = useCallback(
    (hp: [number, number]) => {
      session.debugSetHp(hp);
      anim.setView((v) => ({ ...v, hp: [session.state.fighters[0].hp, session.state.fighters[1].hp] }));
    },
    [session, anim],
  );

  return {
    ...anim,
    session,
    state: session.state,
    phase: session.phase,
    showResult,
    spin,
    rematch,
    restart,
    debugSetHp,
    closeResult: () => setShowResult(false),
  };
}

export type BattleController = ReturnType<typeof useBattle>;
