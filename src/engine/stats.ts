import type { PlayerIndex, TurnRecord } from './types';

export interface FighterStats {
  spins: number;
  damageDealt: number;
  damageTaken: number;
  healed: number;
  blocked: number; // damage absorbed by this fighter's shields
  crits: number; // spins containing at least one critical symbol that hit
  triples: number;
  extraTurns: number;
  selfDamage: number;
  biggestHit: number;
}

function empty(): FighterStats {
  return {
    spins: 0, damageDealt: 0, damageTaken: 0, healed: 0, blocked: 0,
    crits: 0, triples: 0, extraTurns: 0, selfDamage: 0, biggestHit: 0,
  };
}

/** Pure aggregation of a battle log for the result screen. */
export function battleStats(log: TurnRecord[]): [FighterStats, FighterStats] {
  const s: [FighterStats, FighterStats] = [empty(), empty()];
  for (const r of log) {
    const a = s[r.actor];
    const d = s[(r.actor === 0 ? 1 : 0) as PlayerIndex];
    a.spins++;
    a.damageDealt += r.damageDealt;
    d.damageTaken += r.damageDealt;
    d.blocked += r.absorbed;
    a.healed += r.healed;
    a.selfDamage += r.selfDamage;
    a.damageTaken += r.selfDamage;
    if (r.combo.symbols.includes('critical') && r.damageAttempted > 0) a.crits++;
    if (r.combo.triple) a.triples++;
    if (r.isExtraTurn) a.extraTurns++;
    a.biggestHit = Math.max(a.biggestHit, r.damageDealt);
  }
  return s;
}
