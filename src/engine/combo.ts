import { SYMBOL_IDS, type Balance, type ComboResult, type EffectValues, type SymbolId } from './types';
import { nextRandom } from './rng';

export function emptyEffect(): EffectValues {
  return { damage: 0, shield: 0, heal: 0, extra: 0, selfDamage: 0 };
}

/** Weighted pick of one symbol from a uniform [0,1) number. */
export function pickSymbol(u: number, balance: Balance): SymbolId {
  let total = 0;
  for (const id of SYMBOL_IDS) total += balance.symbols[id].weight;
  let r = u * total;
  for (const id of SYMBOL_IDS) {
    const w = balance.symbols[id].weight;
    if (r < w) return id;
    r -= w;
  }
  // Floating point edge: fall back to the last symbol with a positive weight.
  for (let i = SYMBOL_IDS.length - 1; i >= 0; i--) {
    if (balance.symbols[SYMBOL_IDS[i]].weight > 0) return SYMBOL_IDS[i];
  }
  return SYMBOL_IDS[0];
}

/** Spins all reels independently. Pure: returns the symbols and the advanced RNG state. */
export function spinReels(rngState: number, balance: Balance): { symbols: SymbolId[]; rngState: number } {
  const symbols: SymbolId[] = [];
  let s = rngState;
  for (let i = 0; i < balance.reels; i++) {
    const r = nextRandom(s);
    s = r.state;
    symbols.push(pickSymbol(r.value, balance));
  }
  return { symbols, rngState: s };
}

/**
 * Turns three symbols into effects.
 *  - Triple: replaces the normal effects with balance.triples[symbol].
 *  - Otherwise: sum of each symbol's effects; lightning capped per spin.
 */
export function resolveCombo(symbols: SymbolId[], balance: Balance): ComboResult {
  if (symbols.length !== balance.reels) {
    throw new Error(`resolveCombo: expected ${balance.reels} symbols, got ${symbols.length}`);
  }
  const isTriple = symbols.every((s) => s === symbols[0]);
  const effect = emptyEffect();
  if (isTriple) {
    const t = balance.triples[symbols[0]];
    Object.assign(effect, emptyEffect(), stripUndefined(t));
    return { symbols: [...symbols], triple: symbols[0], effect, extraCappedBySpin: 0 };
  }
  for (const id of symbols) {
    const d = balance.symbols[id];
    effect.damage += d.damage ?? 0;
    effect.shield += d.shield ?? 0;
    effect.heal += d.heal ?? 0;
    effect.extra += d.extra ?? 0;
    effect.selfDamage += d.selfDamage ?? 0;
  }
  const cap = balance.rules.maxExtraPerMixedSpin;
  const extraCappedBySpin = Math.max(0, effect.extra - cap);
  effect.extra = Math.min(effect.extra, cap);
  return { symbols: [...symbols], triple: null, effect, extraCappedBySpin };
}

function stripUndefined(o: Partial<EffectValues>): Partial<EffectValues> {
  const out: Partial<EffectValues> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k as keyof EffectValues] = v;
  return out;
}
