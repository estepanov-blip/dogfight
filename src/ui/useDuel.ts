import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerIndex } from '../engine';
import { api, ApiError } from '../online/api';
import type { DuelView } from '../online/protocol';
import { requestWriteAccess } from '../platform/telegram';
import { useAnimator } from './useAnimator';

const POLL_WAITING = 2500; // opponent's turn / open challenge
const POLL_MY_TURN = 10000; // just to notice a forfeit
const POLL_OVER = 6000; // to notice "rematch" from the opponent
const CATCH_UP_LIMIT = 3; // more missed spins than this -> jump instead of replaying

/**
 * Online duel controller. The server is authoritative: the client only asks
 * for a spin and replays the TurnRecords it gets back (or finds while polling).
 */
export function useDuel(id: string, speed: number) {
  const anim = useAnimator(speed);
  const [duel, setDuel] = useState<DuelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // request in flight
  const [animating, setAnimating] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const shown = useRef(0); // how many log entries are on screen
  const latest = useRef<DuelView | null>(null);
  const animatingRef = useRef(false);
  const busyRef = useRef(false);
  const { play, snap } = anim;

  /** Replays whatever the latest server state has that the screen has not shown yet. */
  const drain = useCallback(() => {
    const v = latest.current;
    const b = v?.battle;
    if (!v || !b || animatingRef.current) return;
    const pending = b.log.slice(shown.current);
    if (pending.length === 0) {
      if (b.status === 'over' && !animatingRef.current) setShowResult(true);
      return;
    }
    if (pending.length > CATCH_UP_LIMIT) {
      snap(b);
      shown.current = b.log.length;
      if (b.status === 'over') setShowResult(true);
      return;
    }
    const next = pending[0];
    animatingRef.current = true;
    setAnimating(true);
    play(next, () => {
      shown.current = next.index;
      animatingRef.current = false;
      setAnimating(false);
      drain();
    });
  }, [play, snap]);

  const accept = useCallback((v: DuelView, first: boolean) => {
    latest.current = v;
    setDuel(v);
    setError(null);
    if (first && v.battle) {
      // forfeit / finished duels: if the last record ended the fight, show the end state directly
      snap(v.battle);
      shown.current = v.battle.log.length;
      if (v.battle.status === 'over') setShowResult(true);
    } else if (v.battle && !v.battle.log.length && shown.current === 0 && v.status === 'over') {
      setShowResult(true); // forfeit before any spin
    }
    drain();
  }, [drain, snap]);

  const load = useCallback(
    async (first = false) => {
      try {
        accept(await api.duel(id), first);
      } catch (e) {
        if (first || !(e instanceof ApiError && e.status === 0)) setError(e instanceof Error ? e.message : String(e));
      }
    },
    [accept, id],
  );

  useEffect(() => {
    shown.current = 0;
    latest.current = null;
    setDuel(null);
    setShowResult(false);
    void load(true);
  }, [id, load]);

  // polling (paused while hidden / animating / sending)
  useEffect(() => {
    if (!duel) return;
    const period =
      duel.status === 'over' ? POLL_OVER : duel.status === 'active' && duel.yourTurn ? POLL_MY_TURN : POLL_WAITING;
    const t = window.setInterval(() => {
      if (document.hidden || animatingRef.current || busyRef.current) return;
      void load(false);
    }, period);
    return () => window.clearInterval(t);
  }, [duel, load]);

  // a forfeit (status over without a new spin) must also surface the result
  useEffect(() => {
    if (duel?.status === 'over' && !animating && duel.battle && shown.current >= duel.battle.log.length) setShowResult(true);
  }, [duel, animating]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const spin = useCallback(async () => {
    const v = latest.current;
    if (!v?.battle || !v.yourTurn || animatingRef.current || busyRef.current) return;
    const res = await run(() => api.spin(id, v.battle!.spinCount));
    if (res) accept(res.duel, false);
  }, [accept, id, run]);

  const acceptChallenge = useCallback(async () => {
    await requestWriteAccess(); // opt-in for "твой ход" messages
    const v = await run(() => api.accept(id));
    if (v) accept(v, true);
  }, [accept, id, run]);

  const forfeit = useCallback(async () => {
    const v = await run(() => api.forfeit(id));
    if (v) accept(v, false);
  }, [accept, id, run]);

  const rematch = useCallback(async () => (await run(() => api.rematch(id)))?.id ?? null, [id, run]);

  /** DFC-001: the UI shows only the server-confirmed flag. */
  const toggleAuto = useCallback(
    async (on: boolean) => {
      const v = await run(() => api.auto(id, on));
      if (v) accept(v, false);
    },
    [accept, id, run],
  );

  const shownTurn: PlayerIndex | null = duel?.battle
    ? animating && anim.lastRecord
      ? anim.lastRecord.actor
      : duel.battle.current
    : null;

  return {
    anim,
    duel,
    error,
    busy,
    animating,
    showResult,
    shownTurn,
    spin,
    acceptChallenge,
    forfeit,
    rematch,
    toggleAuto,
    reload: () => load(false),
    clearError: () => setError(null),
    closeResult: () => setShowResult(false),
  };
}
