import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BALANCE, BattleSession, randomSeed, type GameMode, type PlayerIndex, type SymbolId, type TurnRecord } from '../engine';
import { haptic } from '../platform/telegram';
import { captionFor, floatsFor, posesFor, type Caption, type FloatSpec, type Pose } from './presentation';

/** Base timeline (ms) at speed 1. Everything is divided by `speed`. */
export const TIMING = {
  reelStops: [520, 780, 1040],
  impact: 1160, // attacker lunges
  land: 1290, // fist connects: HP bars, numbers, shake
  settle: 1950, // unlock input
  ko: 1600, // KO fall starts
  result: 3300, // result overlay
  botDelay: 750,
};

export interface View {
  hp: [number, number];
  shield: [number, number];
}

export interface FloatItem extends FloatSpec {
  id: number;
}

export interface PoseState {
  pose: Pose;
  key: number;
}

export interface ReelView {
  symbols: SymbolId[];
  prev: SymbolId[];
  spinKey: number;
  spinning: boolean;
  jackpot: boolean;
}

export interface BattleOptions {
  mode: GameMode;
  seed?: number;
  speed: number;
  botPaused?: boolean;
}


export function useBattle({ mode, seed, speed, botPaused }: BattleOptions) {
  const [session] = useState(() => new BattleSession(BALANCE, mode, seed ?? randomSeed()));
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const timers = useRef<number[]>([]);
  const idSeq = useRef(1);

  const initialView = (): View => ({
    hp: [session.state.fighters[0].hp, session.state.fighters[1].hp],
    shield: [0, 0],
  });
  const [view, setView] = useState<View>(initialView);
  const [reel, setReel] = useState<ReelView>({
    symbols: ['punch', 'heal', 'punch'],
    prev: ['punch', 'heal', 'punch'],
    spinKey: 0,
    spinning: false,
    jackpot: false,
  });
  const [poses, setPoses] = useState<[PoseState, PoseState]>([
    { pose: 'idle', key: 0 },
    { pose: 'idle', key: 0 },
  ]);
  const [caption, setCaption] = useState<(Caption & { key: number }) | null>(null);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const [impact, setImpact] = useState<{ side: PlayerIndex; crit: boolean; key: number } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [lastRecord, setLastRecord] = useState<TurnRecord | null>(null);

  useEffect(() => session.subscribe(rerender), [session]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const setPose = (side: PlayerIndex, pose: Pose) =>
    setPoses((p) => {
      const n: [PoseState, PoseState] = [p[0], p[1]];
      n[side] = { pose, key: p[side].key + 1 };
      return n;
    });

  const runTimeline = useCallback(
    (r: TurnRecord) => {
      const k = 1 / Math.max(0.25, speed);
      const T = (ms: number) => Math.round(ms * k);
      const target = (r.actor === 0 ? 1 : 0) as PlayerIndex;
      const { actor: actorPose, target: targetPose } = posesFor(r);
      const over = r.outcome !== null;

      setLastRecord(r);
      setCaption(null);
      setImpact(null);
      setPoses((p) => [
        { pose: 'idle', key: p[0].key + 1 },
        { pose: 'idle', key: p[1].key + 1 },
      ]);
      // own shield vanishes at the start of own turn
      setView((v) => {
        const shield: [number, number] = [...v.shield];
        shield[r.actor] = 0;
        return { ...v, shield };
      });
      setReel((prev) => ({
        symbols: r.combo.symbols,
        prev: prev.symbols,
        spinKey: prev.spinKey + 1,
        spinning: true,
        jackpot: false,
      }));

      at(T(TIMING.reelStops[2] + 60), () => setReel((v) => ({ ...v, spinning: false, jackpot: !!r.combo.triple })));

      at(T(TIMING.impact), () => {
        setPose(r.actor, actorPose);
        if (r.damageAttempted === 0 && r.selfDamage === 0) setCaption({ ...captionFor(r), key: r.index });
      });

      at(T(TIMING.land), () => {
        setView({ hp: [...r.hpAfter], shield: [...r.shieldAfter] });
        if (targetPose !== 'idle') setPose(target, targetPose);
        if (r.damageAttempted > 0 || r.selfDamage > 0) setCaption({ ...captionFor(r), key: r.index });
        if (r.damageAttempted > 0) setImpact({ side: target, crit: actorPose === 'crit', key: r.index });
        const isCrit = actorPose === 'crit';
        if (isCrit || r.damageDealt >= 30 || r.selfDamage > 0) setShakeKey((x) => x + 1);
        if (isCrit) setFlashKey((x) => x + 1);
        if (r.damageDealt > 0 || r.selfDamage > 0) haptic(r.damageDealt >= 30 || r.selfDamage > 0 ? 'heavy' : 'light');
        const items = floatsFor(r).map((f) => ({ ...f, id: idSeq.current++ }));
        setFloats((fs) => [...fs, ...items]);
        at(T(1300), () => setFloats((fs) => fs.filter((f) => !items.some((i) => i.id === f.id))));
      });

      if (over) {
        at(T(TIMING.ko), () => {
          if (r.outcome === 'draw') {
            if (r.endReason === 'doubleKo') {
              setPose(0, 'ko');
              setPose(1, 'ko');
            }
            setCaption({ text: r.endReason === 'doubleKo' ? 'ДВОЙНОЙ НОКАУТ!' : 'НИЧЬЯ!', kind: 'draw', key: -1 });
          } else {
            const winner = r.outcome as PlayerIndex;
            const loser = (winner === 0 ? 1 : 0) as PlayerIndex;
            if (r.endReason === 'ko') {
              setPose(loser, 'ko');
              setCaption({ text: 'НОКАУТ!', kind: 'ko', key: -1 });
              setShakeKey((x) => x + 1);
              haptic('ko');
            } else {
              setCaption({ text: 'ГОНГ!', sub: 'победа по очкам', kind: 'ko', key: -1 });
            }
            setPose(winner, 'win');
          }
        });
        at(T(TIMING.result), () => {
          session.finishAnimation();
          setShowResult(true);
        });
      } else {
        at(T(TIMING.settle), () => {
          setPoses((p) => [
            { pose: 'idle', key: p[0].key + 1 },
            { pose: 'idle', key: p[1].key + 1 },
          ]);
          session.finishAnimation();
        });
      }
    },
    [at, session, speed],
  );

  const spin = useCallback(
    (by: 'human' | 'bot' = 'human') => {
      const r = session.trySpin(by);
      if (r) runTimeline(r);
      return r;
    },
    [runTimeline, session],
  );

  // Bot plays with the same rules: it just presses the same button after a pause.
  const botTurn = session.isBotTurn() && session.phase === 'idle';
  useEffect(() => {
    if (!botTurn || botPaused) return;
    const t = window.setTimeout(() => spin('bot'), Math.round(TIMING.botDelay / Math.max(0.25, speed)));
    return () => window.clearTimeout(t);
  }, [botTurn, botPaused, spin, speed, session.state.spinCount]);

  const resetVisuals = useCallback(() => {
    clearTimers();
    setView({ hp: [BALANCE.hp, BALANCE.hp], shield: [0, 0] });
    setPoses((p) => [
      { pose: 'idle', key: p[0].key + 1 },
      { pose: 'idle', key: p[1].key + 1 },
    ]);
    setCaption(null);
    setFloats([]);
    setImpact(null);
    setShowResult(false);
    setLastRecord(null);
    setReel((v) => ({ ...v, spinning: false, jackpot: false }));
  }, [clearTimers]);

  const rematch = useCallback(() => {
    resetVisuals();
    session.rematch();
  }, [resetVisuals, session]);

  const restart = useCallback(
    (newSeed: number) => {
      resetVisuals();
      session.restart(newSeed);
    },
    [resetVisuals, session],
  );

  const debugSetHp = useCallback(
    (hp: [number, number]) => {
      session.debugSetHp(hp);
      setView((v) => ({ ...v, hp: [session.state.fighters[0].hp, session.state.fighters[1].hp] }));
    },
    [session],
  );

  return {
    session,
    state: session.state,
    phase: session.phase,
    view,
    reel,
    poses,
    caption,
    floats,
    impact,
    shakeKey,
    flashKey,
    showResult,
    lastRecord,
    spin,
    rematch,
    restart,
    debugSetHp,
    closeResult: () => setShowResult(false),
  };
}

export type BattleController = ReturnType<typeof useBattle>;
