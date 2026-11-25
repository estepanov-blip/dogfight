import { createBattle, createRematch, takeTurn } from './battle';
import { randomSeed } from './rng';
import type { Balance, BattleState, PlayerIndex, SymbolId, TurnRecord } from './types';

export type GameMode = 'bot' | 'local';
export type SessionPhase = 'idle' | 'animating' | 'over';

/**
 * Framework-agnostic controller around the pure engine.
 * Owns the input lock: while a spin is being animated, further spins are rejected.
 * The UI calls trySpin() on click and finishAnimation() when its timeline ends.
 */
export class BattleSession {
  readonly balance: Balance;
  readonly mode: GameMode;
  state: BattleState;
  phase: SessionPhase = 'idle';
  /** Debug: symbols to use for the next spin instead of RNG. */
  forcedNext: SymbolId[] | null = null;
  rejectedClicks = 0;
  private listeners = new Set<() => void>();

  constructor(balance: Balance, mode: GameMode, seed: number = randomSeed(), starter: PlayerIndex = 0) {
    this.balance = balance;
    this.mode = mode;
    this.state = createBattle(balance, { seed, starter });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  isBotTurn(): boolean {
    return this.mode === 'bot' && this.state.current === 1 && this.state.status === 'playing';
  }

  /** Can a human press "КРУТИТЬ" right now? */
  canHumanSpin(): boolean {
    return this.phase === 'idle' && this.state.status === 'playing' && !this.isBotTurn();
  }

  /**
   * Performs a spin if the session is idle. Returns null (and counts the
   * rejection) when locked — this is what prevents double clicks.
   */
  trySpin(by: 'human' | 'bot' = 'human'): TurnRecord | null {
    const allowed =
      this.phase === 'idle' &&
      this.state.status === 'playing' &&
      (by === 'bot' ? this.isBotTurn() : !this.isBotTurn());
    if (!allowed) {
      this.rejectedClicks++;
      return null;
    }
    const forced = this.forcedNext ?? undefined;
    this.forcedNext = null;
    const { state, record } = takeTurn(this.state, this.balance, { forced });
    this.state = state;
    this.phase = 'animating';
    this.emit();
    return record;
  }

  finishAnimation() {
    if (this.phase !== 'animating') return;
    this.phase = this.state.status === 'over' ? 'over' : 'idle';
    this.emit();
  }

  rematch(seed: number = randomSeed()) {
    this.state = createRematch(this.state, this.balance, seed);
    this.phase = 'idle';
    this.forcedNext = null;
    this.emit();
  }

  restart(seed: number, starter: PlayerIndex = 0) {
    this.state = createBattle(this.balance, { seed, starter });
    this.phase = 'idle';
    this.forcedNext = null;
    this.emit();
  }

  /** Debug: force the symbols of the next spin (null clears). */
  setForcedNext(symbols: SymbolId[] | null) {
    if (symbols && symbols.length !== this.balance.reels) throw new Error('forced combo must have 3 symbols');
    this.forcedNext = symbols ? [...symbols] : null;
    this.emit();
  }

  /** Debug helper: set HP of both fighters (keeps the battle going). */
  debugSetHp(hp: [number, number]) {
    if (this.phase !== 'idle') return;
    const f = this.state.fighters;
    this.state = {
      ...this.state,
      fighters: [
        { ...f[0], hp: clampHp(hp[0], this.balance.hp) },
        { ...f[1], hp: clampHp(hp[1], this.balance.hp) },
      ],
    };
    this.emit();
  }
}

function clampHp(v: number, max: number) {
  return Math.max(1, Math.min(max, Math.round(v)));
}
