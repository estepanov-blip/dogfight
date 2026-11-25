import { resolveCombo, spinReels } from './combo';
import { normalizeSeed } from './rng';
import type { Balance, BattleState, PlayerIndex, SymbolId, TurnRecord } from './types';

export interface CreateBattleOptions {
  seed: number;
  starter?: PlayerIndex;
}

export function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

export function createBattle(balance: Balance, opts: CreateBattleOptions): BattleState {
  const seed = normalizeSeed(opts.seed);
  const starter = opts.starter ?? 0;
  return {
    fighters: [
      { hp: balance.hp, shield: 0 },
      { hp: balance.hp, shield: 0 },
    ],
    current: starter,
    starter,
    spinCount: 0,
    streakExtraGranted: 0,
    pendingExtra: 0,
    currentIsExtra: false,
    status: 'playing',
    outcome: null,
    endReason: null,
    rngState: seed,
    seed,
    log: [],
  };
}

export class BattleOverError extends Error {
  constructor() {
    super('Battle is already over');
  }
}

export interface TurnOptions {
  /** Debug: force these symbols instead of spinning (RNG is not advanced). */
  forced?: SymbolId[];
  /** Skip storing the record in state.log (faster simulation). */
  skipLog?: boolean;
}

/**
 * Executes one spin for the current fighter. Pure: returns a new state.
 *
 * Order of resolution (see README "Правила"):
 *  1. The actor's own shield expires (shield lasts until the owner's next turn).
 *  2. Reels -> combo -> effects (triple replaces normal effects).
 *  3. Heal (capped at max HP).
 *  4. Damage to the opponent (reduced by opponent's shield, which is then consumed)
 *     and self-damage are applied simultaneously.
 *  5. Actor gains the new shield.
 *  6. KO check (both <= 0 -> draw), then spin limit check (win on HP or draw).
 *  7. Extra turns (max N in a row, per-spin cap for mixed lightning).
 */
export function takeTurn(
  state: BattleState,
  balance: Balance,
  opts: TurnOptions = {},
): { state: BattleState; record: TurnRecord } {
  if (state.status === 'over') throw new BattleOverError();

  let symbols: SymbolId[];
  let rngState = state.rngState;
  if (opts.forced) {
    if (opts.forced.length !== balance.reels) throw new Error('forced combo must have 3 symbols');
    symbols = [...opts.forced];
  } else {
    const spun = spinReels(state.rngState, balance);
    symbols = spun.symbols;
    rngState = spun.rngState;
  }

  const actor = state.current;
  const opp = other(actor);
  const fighters: BattleState['fighters'] = [{ ...state.fighters[0] }, { ...state.fighters[1] }];
  const me = fighters[actor];
  const them = fighters[opp];
  const hpBefore: [number, number] = [fighters[0].hp, fighters[1].hp];

  // 1. own shield expires before own turn
  const shieldExpired = me.shield;
  me.shield = 0;

  // 2. effects
  const combo = resolveCombo(symbols, balance);
  const fx = combo.effect;

  // 3. heal (cap)
  const healRoom = Math.max(0, balance.hp - me.hp);
  const healed = Math.min(fx.heal, healRoom);
  const overheal = fx.heal - healed;
  me.hp += healed;

  // 4. damage + self-damage simultaneously
  let absorbed = 0;
  let shieldBroken = false;
  if (fx.damage > 0 && them.shield > 0) {
    absorbed = Math.min(fx.damage, them.shield);
    them.shield = 0; // shield absorbs one hit and disappears
    shieldBroken = true;
  }
  const damageDealt = fx.damage - absorbed;
  them.hp = Math.max(0, them.hp - damageDealt);
  const selfDamage = Math.min(fx.selfDamage, me.hp);
  me.hp = Math.max(0, me.hp - fx.selfDamage);

  // 5. new shield
  me.shield = fx.shield;

  const spinCount = state.spinCount + 1;

  // 6. end checks
  let status: BattleState['status'] = 'playing';
  let outcome: BattleState['outcome'] = null;
  let endReason: BattleState['endReason'] = null;
  const actorKo = me.hp <= 0;
  const oppKo = them.hp <= 0;
  if (actorKo && oppKo) {
    status = 'over';
    outcome = 'draw';
    endReason = 'doubleKo';
  } else if (actorKo || oppKo) {
    status = 'over';
    outcome = actorKo ? opp : actor;
    endReason = 'ko';
  } else if (spinCount >= balance.rules.maxSpins) {
    status = 'over';
    endReason = 'spinLimit';
    const [a, b] = [fighters[0].hp, fighters[1].hp];
    outcome = a === b ? 'draw' : a > b ? 0 : 1;
  }

  // 7. extra turns
  const maxChain = balance.rules.maxExtraTurnsInRow;
  const room = Math.max(0, maxChain - state.streakExtraGranted);
  let extraGranted = Math.min(fx.extra, room);
  let extraWasted = fx.extra - extraGranted + combo.extraCappedBySpin;
  let streakExtraGranted = state.streakExtraGranted + extraGranted;
  let pendingExtra = state.pendingExtra + extraGranted;
  let current: PlayerIndex = actor;
  let currentIsExtra = false;
  if (status === 'over') {
    // Extras granted on the final spin are irrelevant; keep the record honest.
    extraWasted += extraGranted;
    extraGranted = 0;
    pendingExtra = 0;
  } else if (pendingExtra > 0) {
    pendingExtra -= 1;
    currentIsExtra = true;
  } else {
    current = opp;
    streakExtraGranted = 0;
    pendingExtra = 0;
  }

  const record: TurnRecord = {
    index: spinCount,
    actor,
    isExtraTurn: state.currentIsExtra,
    forced: !!opts.forced,
    combo,
    shieldExpired,
    healed,
    overheal,
    damageAttempted: fx.damage,
    absorbed,
    damageDealt,
    shieldBroken,
    selfDamage,
    shieldGained: fx.shield,
    extraGranted,
    extraWasted,
    hpBefore,
    hpAfter: [fighters[0].hp, fighters[1].hp],
    shieldAfter: [fighters[0].shield, fighters[1].shield],
    nextActor: status === 'over' ? null : current,
    nextIsExtraTurn: status === 'over' ? false : currentIsExtra,
    outcome,
    endReason,
  };

  return {
    record,
    state: {
      ...state,
      fighters,
      current,
      spinCount,
      streakExtraGranted,
      pendingExtra,
      currentIsExtra,
      status,
      outcome,
      endReason,
      rngState,
      log: opts.skipLog ? state.log : [...state.log, record],
    },
  };
}

/** Rematch: fresh battle, new seed, the other fighter opens. */
export function createRematch(prev: BattleState, balance: Balance, seed: number): BattleState {
  return createBattle(balance, { seed, starter: other(prev.starter) });
}
