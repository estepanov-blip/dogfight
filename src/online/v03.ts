/**
 * Fight Club Update v0.3 — shared constants (client + server). Pure data.
 *
 * Approved (DFC-001..005) values are marked APPROVED. Everything else is the
 * release spec's working hypothesis (status Proposed, docs/releases/v0.3.md) and
 * may change after an owner decision. Combat numbers are NOT here: they come
 * only from docs/balance.json.
 *
 * The catalogue mirrors docs/proposals/characters.json and the economy mirrors
 * docs/proposals/economy.json; a unit test keeps them in sync.
 */

export const ECONOMY = {
  startingBalance: 500, // APPROVED DFC-002
  winDelta: 100, // APPROVED DFC-002
  lossDelta: -50, // APPROVED DFC-002
  ratedPerOpponentPerDay: 5, // APPROVED DFC-005
  // Approved by the owner 2026-11-25 (DEC-02/03); minimum balance and draw stay as specified
  drawDelta: 0,
  minimumBalance: 0,
  technicalWinnerDelta: 0,
  technicalLoserDelta: -50,
} as const;

/** Timings approved by the owner 2026-11-25 (DEC-01). */
export const TIMING_V03 = {
  turnTimeoutMs: 24 * 3600_000,
  reminderOffsetsMs: [1 * 3600_000, 12 * 3600_000],
  autoDelayMs: 1000,
} as const;

/** Duel record schema. Absent = v0.2 legacy record. */
export const DUEL_SCHEMA = 2;

export type ResultReason = 'ko' | 'doubleKo' | 'spinLimit' | 'surrender' | 'early_surrender' | 'turn_timeout';
export type RatedStatus = 'pending' | 'rated' | 'friendly' | 'legacy';

export interface CharacterDef {
  id: string;
  name: string;
  breed: string;
  /** Sprite/avatar file key: src/assets/game/fighters/<assetKey>.webp, avatars/<assetKey>.webp. */
  assetKey: string;
  assetStatus: 'existing' | 'final' | 'placeholder';
  /** Sprite framing: full body (v0.2 art) or waist-up (Fighter Pack v0.3, cut at the shorts). */
  frame: 'full' | 'waist';
  priceBones: 0;
  combatProfile: 'shared';
}

/**
 * APPROVED DFC-004 + Fighter Pack v0.3 (2026-11-26): eight free fighters, identical combat stats.
 * Сиба and Буль are unchanged. Чих and Пух keep their v0.3 ids (`chih`, `pushok`) with the
 * new pack art (manifest ids chihuahua / pomeranian). Order = order in the picker.
 */
export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'shiba', name: 'Сиба', breed: 'Сиба-ину', assetKey: 'shiba', assetStatus: 'existing', frame: 'full', priceBones: 0, combatProfile: 'shared' },
  { id: 'bull', name: 'Буль', breed: 'Бультерьер', assetKey: 'bull', assetStatus: 'existing', frame: 'full', priceBones: 0, combatProfile: 'shared' },
  { id: 'doberman', name: 'Добби', breed: 'Доберман', assetKey: 'doberman', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
  { id: 'shepherd', name: 'Овчар', breed: 'Немецкая овчарка', assetKey: 'shepherd', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
  { id: 'bulldog', name: 'Батон', breed: 'Английский бульдог', assetKey: 'bulldog', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
  { id: 'chih', name: 'Чих', breed: 'Чихуахуа', assetKey: 'chihuahua', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
  { id: 'pushok', name: 'Пух', breed: 'Померанский шпиц', assetKey: 'pomeranian', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
  { id: 'boxer', name: 'Бокс', breed: 'Боксёр', assetKey: 'boxer', assetStatus: 'final', frame: 'waist', priceBones: 0, combatProfile: 'shared' },
];

/**
 * Placeholder fighters from v0.3 (live 2026-11-25..26) that the pack replaced. Saved profiles and
 * duel snapshots may still hold these ids: they are shown as (and re-saved as) the mapped fighter.
 */
export const RETIRED_FIGHTERS: Readonly<Record<string, string>> = {
  puzan: 'bulldog', // Пузан (мопс) -> Батон
  psikh: 'shepherd', // Псих (хаски) -> Овчар
  heavy: 'doberman', // Тяжёлый (ротвейлер) -> Добби
  kolbasa: 'boxer', // Колбаса (такса) -> Бокс
};

/** v0.2 roles: challenger was Шиба, accepter was Буль. */
export const LEGACY_ROLE_FIGHTERS: readonly [string, string] = ['shiba', 'bull'];

/** Selectable now (strict: retired ids are not accepted for new choices). */
export function isCharacterId(id: unknown): id is string {
  return typeof id === 'string' && CHARACTERS.some((c) => c.id === id);
}

/** Current id for a stored id: retired ids map to their replacement; unknown -> null. */
export function normalizeFighterId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  if (isCharacterId(id)) return id;
  return RETIRED_FIGHTERS[id] ?? null;
}

export function characterById(id: string | null | undefined): CharacterDef | null {
  const n = normalizeFighterId(id);
  return CHARACTERS.find((c) => c.id === n) ?? null;
}

// ---------------------------------------------------------------- UTC calendar

/** UTC day key [00:00, 24:00): 'YYYY-MM-DD'. */
export function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Start (ms) of the UTC week containing ts; weeks start Monday 00:00 UTC. */
export function utcWeekStart(ts: number): number {
  const d = new Date(ts);
  const day = d.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

/** WR = wins / (wins + losses + draws); null when there are no games ("—"). */
export function winRate(w: number, l: number, d: number): number | null {
  const n = w + l + d;
  return n === 0 ? null : w / n;
}
