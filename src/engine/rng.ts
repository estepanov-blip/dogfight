/**
 * Mulberry32 — tiny, fast, seedable PRNG. State is a single uint32 so it can
 * live inside the (serializable) battle state.
 */
export function nextRandom(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

/** Mutable wrapper for hot loops (simulation). */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }
  next(): number {
    const r = nextRandom(this.state);
    this.state = r.state;
    return r.value;
  }
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  return Math.floor(Math.abs(seed)) >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Accepts numbers or arbitrary strings ("sanya-123") and returns a uint32 seed. */
export function parseSeed(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return normalizeSeed(Number(trimmed));
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
