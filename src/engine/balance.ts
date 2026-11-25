import rawBalance from '../../docs/balance.json';
import { SYMBOL_IDS, type Balance, type EffectValues, type RulesConfig, type SymbolId } from './types';

export const DEFAULT_RULES: RulesConfig = {
  maxSpins: 40,
  maxExtraTurnsInRow: 2,
  maxExtraPerMixedSpin: 1,
  secondStartShield: 0,
};

const EFFECT_KEYS: (keyof EffectValues)[] = ['damage', 'shield', 'heal', 'extra', 'selfDamage'];

export class BalanceError extends Error {}

function isNonNegNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Validates an untrusted balance object (balance.json) and fills defaults.
 * Throws BalanceError with a readable message on bad data.
 */
export function parseBalance(raw: unknown): Balance {
  if (!raw || typeof raw !== 'object') throw new BalanceError('balance: not an object');
  const r = raw as Record<string, unknown>;
  if (!isNonNegNumber(r.hp) || r.hp <= 0) throw new BalanceError('balance.hp must be > 0');
  if (r.reels !== 3) throw new BalanceError('balance.reels: only 3 reels are supported in v0.1');
  const symbols = r.symbols as Record<string, Record<string, unknown>> | undefined;
  const triples = (r.triples ?? {}) as Record<string, Record<string, unknown>>;
  if (!symbols || typeof symbols !== 'object') throw new BalanceError('balance.symbols missing');

  const outSymbols = {} as Balance['symbols'];
  const outTriples = {} as Balance['triples'];
  let total = 0;
  for (const id of SYMBOL_IDS) {
    const s = symbols[id];
    if (!s) throw new BalanceError(`balance.symbols.${id} missing`);
    if (!isNonNegNumber(s.weight)) throw new BalanceError(`balance.symbols.${id}.weight must be >= 0`);
    total += s.weight;
    const def: Balance['symbols'][SymbolId] = { weight: s.weight };
    for (const k of EFFECT_KEYS) {
      if (s[k] !== undefined) {
        if (!isNonNegNumber(s[k])) throw new BalanceError(`balance.symbols.${id}.${k} must be >= 0`);
        def[k] = s[k];
      }
    }
    outSymbols[id] = def;
    const t = triples[id] ?? {};
    const tdef: Partial<EffectValues> = {};
    for (const k of EFFECT_KEYS) {
      if (t[k] !== undefined) {
        if (!isNonNegNumber(t[k])) throw new BalanceError(`balance.triples.${id}.${k} must be >= 0`);
        tdef[k] = t[k];
      }
    }
    outTriples[id] = tdef;
  }
  if (total <= 0) throw new BalanceError('balance: total symbol weight must be > 0');

  const rr = (r.rules ?? {}) as Record<string, unknown>;
  const rules: RulesConfig = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RulesConfig)[]) {
    if (rr[k] !== undefined) {
      if (!isNonNegNumber(rr[k]) || !Number.isInteger(rr[k])) {
        throw new BalanceError(`balance.rules.${k} must be a non-negative integer`);
      }
      rules[k] = rr[k];
    }
  }
  if (rules.maxSpins < 1) throw new BalanceError('balance.rules.maxSpins must be >= 1');

  return { hp: r.hp, reels: 3, symbols: outSymbols, triples: outTriples, rules };
}

/** The single source of combat parameters: docs/balance.json. */
export const BALANCE: Balance = parseBalance(rawBalance);

export function totalWeight(b: Balance): number {
  return SYMBOL_IDS.reduce((sum, id) => sum + b.symbols[id].weight, 0);
}

/**
 * Short id of the combat rules a battle starts with (stored on v0.3 duels).
 * v0.2 = the original rules; changes to the rules block get their own id.
 */
export function rulesVersion(b: Balance): string {
  return b.rules.secondStartShield > 0 ? `v0.3-s${b.rules.secondStartShield}` : 'v0.2';
}
