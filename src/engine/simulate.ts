import { createBattle, takeTurn } from './battle';
import { normalizeSeed } from './rng';
import { SYMBOL_IDS, type Balance, type EndReason, type PlayerIndex, type SymbolId } from './types';

export interface SimulationOptions {
  fights: number;
  seed: number;
  /** Alternate who opens each fight (like rematches do). Default true. */
  alternateStarter?: boolean;
}

export interface Distribution {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  /** histogram[i] = number of fights that lasted i spins */
  histogram: number[];
}

export interface SimulationReport {
  fights: number;
  seed: number;
  elapsedMs: number;
  totalSpins: number;
  wins: [number, number];
  draws: number;
  winRate: [number, number];
  drawRate: number;
  starterWinRate: number;
  endReasons: Record<EndReason, number>;
  spinsPerFight: Distribution;
  /** Turns (spins) by a single fighter, averaged. */
  meanSpinsPerFighter: number;
  symbolFrequency: Record<SymbolId, number>; // share of all reel stops
  tripleFrequency: Record<SymbolId, number>; // share of spins
  anyTripleRate: number;
  effects: {
    spinsWithDamage: number; // share of spins
    spinsWithCrit: number;
    spinsWithShield: number;
    spinsWithHeal: number;
    spinsWithExtra: number;
    spinsAllMiss: number;
    meanDamagePerSpin: number;
    totalDamageDealt: number;
    totalAbsorbed: number;
    shieldsBroken: number;
    shieldsExpiredUnused: number;
    totalHealed: number;
    totalOverheal: number;
    totalSelfDamage: number;
    extraGranted: number;
    extraWasted: number;
  };
  meanWinnerHp: number;
  comebackRate: number; // winner was behind on HP at the midpoint of the fight
}

function distribution(values: number[], maxBucket: number): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length || 1;
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const histogram = new Array<number>(maxBucket + 1).fill(0);
  let sum = 0;
  for (const v of sorted) {
    sum += v;
    histogram[Math.min(v, maxBucket)]++;
  }
  return {
    mean: sum / n,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    histogram,
  };
}

/** Runs N headless bot-vs-bot fights with the real engine (same code path as the UI). */
export function simulate(balance: Balance, opts: SimulationOptions): SimulationReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fights = Math.max(1, Math.floor(opts.fights));
  const alternate = opts.alternateStarter ?? true;
  let seed = normalizeSeed(opts.seed);

  const wins: [number, number] = [0, 0];
  let draws = 0;
  let starterWins = 0;
  const endReasons: Record<EndReason, number> = { ko: 0, doubleKo: 0, spinLimit: 0 };
  const lengths: number[] = [];
  const symCount = Object.fromEntries(SYMBOL_IDS.map((s) => [s, 0])) as Record<SymbolId, number>;
  const tripleCount = Object.fromEntries(SYMBOL_IDS.map((s) => [s, 0])) as Record<SymbolId, number>;
  const e = {
    damage: 0, crit: 0, shield: 0, heal: 0, extra: 0, allMiss: 0,
    dmgAttempted: 0, dealt: 0, absorbed: 0, broken: 0, expiredUnused: 0,
    healed: 0, overheal: 0, self: 0, extraGranted: 0, extraWasted: 0,
  };
  let totalSpins = 0;
  let winnerHpSum = 0;
  let decisive = 0;
  let comebacks = 0;

  for (let i = 0; i < fights; i++) {
    // derive an independent seed per fight (splitmix-like step)
    seed = (Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) + 0x9e3779b9) >>> 0;
    const starter: PlayerIndex = alternate ? ((i % 2) as PlayerIndex) : 0;
    let st = createBattle(balance, { seed, starter });
    let midHp: [number, number] | null = null;
    const midpointGuess = 6;
    while (st.status === 'playing') {
      const { state, record: r } = takeTurn(st, balance, { skipLog: true });
      st = state;
      totalSpins++;
      for (const s of r.combo.symbols) symCount[s]++;
      if (r.combo.triple) tripleCount[r.combo.triple]++;
      if (r.damageAttempted > 0) e.damage++;
      if (r.combo.symbols.includes('critical')) e.crit++;
      if (r.shieldGained > 0) e.shield++;
      if (r.combo.effect.heal > 0) e.heal++;
      if (r.combo.symbols.includes('extra')) e.extra++;
      if (r.combo.symbols.every((s) => s === 'miss')) e.allMiss++;
      e.dmgAttempted += r.damageAttempted;
      e.dealt += r.damageDealt;
      e.absorbed += r.absorbed;
      if (r.shieldBroken) e.broken++;
      if (r.shieldExpired > 0) e.expiredUnused++;
      e.healed += r.healed;
      e.overheal += r.overheal;
      e.self += r.selfDamage;
      e.extraGranted += r.extraGranted;
      e.extraWasted += r.extraWasted;
      if (r.index === midpointGuess) midHp = [...r.hpAfter];
    }
    lengths.push(st.spinCount);
    endReasons[st.endReason!]++;
    if (st.outcome === 'draw') draws++;
    else {
      const w = st.outcome as PlayerIndex;
      wins[w]++;
      if (w === starter) starterWins++;
      winnerHpSum += st.fighters[w].hp;
      decisive++;
      if (midHp && midHp[w] < midHp[w === 0 ? 1 : 0]) comebacks++;
    }
  }

  const reelStops = totalSpins * balance.reels || 1;
  const spins = totalSpins || 1;
  const decisiveN = decisive || 1;
  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

  return {
    fights,
    seed: normalizeSeed(opts.seed),
    elapsedMs,
    totalSpins,
    wins,
    draws,
    winRate: [wins[0] / fights, wins[1] / fights],
    drawRate: draws / fights,
    starterWinRate: starterWins / decisiveN,
    endReasons,
    spinsPerFight: distribution(lengths, balance.rules.maxSpins),
    meanSpinsPerFighter: totalSpins / fights / 2,
    symbolFrequency: mapValues(symCount, (v) => v / reelStops),
    tripleFrequency: mapValues(tripleCount, (v) => v / spins),
    anyTripleRate: Object.values(tripleCount).reduce((a, b) => a + b, 0) / spins,
    effects: {
      spinsWithDamage: e.damage / spins,
      spinsWithCrit: e.crit / spins,
      spinsWithShield: e.shield / spins,
      spinsWithHeal: e.heal / spins,
      spinsWithExtra: e.extra / spins,
      spinsAllMiss: e.allMiss / spins,
      meanDamagePerSpin: e.dmgAttempted / spins,
      totalDamageDealt: e.dealt,
      totalAbsorbed: e.absorbed,
      shieldsBroken: e.broken,
      shieldsExpiredUnused: e.expiredUnused,
      totalHealed: e.healed,
      totalOverheal: e.overheal,
      totalSelfDamage: e.self,
      extraGranted: e.extraGranted,
      extraWasted: e.extraWasted,
    },
    meanWinnerHp: winnerHpSum / decisiveN,
    comebackRate: comebacks / decisiveN,
  };
}

function mapValues<K extends string>(o: Record<K, number>, f: (v: number) => number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(o) as K[]) out[k] = f(o[k]);
  return out;
}
