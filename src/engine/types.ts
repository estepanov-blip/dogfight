/**
 * Pure combat domain types. No React / DOM imports allowed in src/engine.
 */

export const SYMBOL_IDS = ['punch', 'critical', 'block', 'heal', 'extra', 'miss'] as const;
export type SymbolId = (typeof SYMBOL_IDS)[number];

export type PlayerIndex = 0 | 1;

/** Every effect a combo can produce. Absent values in balance.json mean 0. */
export interface EffectValues {
  damage: number;
  shield: number;
  heal: number;
  extra: number;
  selfDamage: number;
}

export interface SymbolDef extends Partial<EffectValues> {
  weight: number;
}

export interface RulesConfig {
  /** Total spins (both players) after which the fight ends on HP. */
  maxSpins: number;
  /** Max consecutive extra turns one fighter may chain. */
  maxExtraTurnsInRow: number;
  /** Lightning symbols in a non-triple spin give at most this many extra turns. */
  maxExtraPerMixedSpin: number;
}

export interface Balance {
  hp: number;
  reels: number;
  symbols: Record<SymbolId, SymbolDef>;
  triples: Record<SymbolId, Partial<EffectValues>>;
  rules: RulesConfig;
  /**
   * Simulator-only experiment knobs (FC-04). Never read from balance.json:
   * production battles always run with these absent (= v0.2 behaviour).
   */
  experiment?: CombatExperiment;
}

export interface CombatExperiment {
  /** Shield the non-starting fighter begins the battle with (Q02). Default 0. */
  secondStartShield?: number;
  /**
   * Q04 "hold" rule: own shield no longer expires at the start of own turn; it lasts
   * until an opponent hit with positive damage. A new shield replaces the old one,
   * a spin without shield keeps it. Default false (v0.2: expires every own turn).
   */
  shieldHold?: boolean;
}

export interface ComboResult {
  symbols: SymbolId[];
  /** Set when all reels show the same symbol: the triple replaces normal effects. */
  triple: SymbolId | null;
  effect: EffectValues;
  /** Lightning extras that were cut by maxExtraPerMixedSpin. */
  extraCappedBySpin: number;
}

export interface FighterState {
  hp: number;
  /** Absorbs up to this much of the next incoming hit; 0 = no shield. */
  shield: number;
}

export type BattleStatus = 'playing' | 'over';
export type EndReason = 'ko' | 'doubleKo' | 'spinLimit' | 'forfeit' | 'timeout';
export type Outcome = PlayerIndex | 'draw';

/** Everything that happened during one spin. Used by UI, log and analytics. */
export interface TurnRecord {
  index: number; // 1-based spin number in the battle
  actor: PlayerIndex;
  isExtraTurn: boolean;
  forced: boolean;
  combo: ComboResult;
  shieldExpired: number; // own shield that vanished at the start of this turn
  healed: number; // actual HP restored (after cap)
  overheal: number; // heal lost to the HP cap
  damageAttempted: number;
  absorbed: number; // blocked by the opponent's shield
  damageDealt: number;
  shieldBroken: boolean; // opponent's shield was consumed by this hit
  selfDamage: number;
  shieldGained: number;
  extraGranted: number;
  extraWasted: number; // lost to the chain / per-spin caps
  hpBefore: [number, number];
  hpAfter: [number, number];
  shieldAfter: [number, number];
  nextActor: PlayerIndex | null;
  nextIsExtraTurn: boolean;
  outcome: Outcome | null;
  endReason: EndReason | null;
}

export interface BattleState {
  fighters: [FighterState, FighterState];
  current: PlayerIndex;
  starter: PlayerIndex;
  spinCount: number;
  /** Extra turns granted in the current fighter's streak (capped by rules). */
  streakExtraGranted: number;
  /** Extra turns still owed to the current fighter. */
  pendingExtra: number;
  /** True when the current turn is a bonus (extra) turn. */
  currentIsExtra: boolean;
  status: BattleStatus;
  outcome: Outcome | null;
  endReason: EndReason | null;
  /** Serializable RNG state so the battle is fully deterministic and replayable. */
  rngState: number;
  seed: number;
  log: TurnRecord[];
}
