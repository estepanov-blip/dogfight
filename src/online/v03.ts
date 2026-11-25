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
  assetKey: string;
  assetStatus: 'existing' | 'placeholder';
  priceBones: 0;
  combatProfile: 'shared';
}

/** APPROVED DFC-004: eight free fighters, identical combat stats. */
export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'shiba', name: 'Сиба', breed: 'Сиба-ину', assetKey: 'shiba', assetStatus: 'existing', priceBones: 0, combatProfile: 'shared' },
  { id: 'bull', name: 'Буль', breed: 'Бультерьер', assetKey: 'bull', assetStatus: 'existing', priceBones: 0, combatProfile: 'shared' },
  { id: 'chih', name: 'Чих', breed: 'Чихуахуа', assetKey: 'chih', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
  { id: 'puzan', name: 'Пузан', breed: 'Мопс', assetKey: 'puzan', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
  { id: 'psikh', name: 'Псих', breed: 'Хаски', assetKey: 'psikh', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
  { id: 'heavy', name: 'Тяжёлый', breed: 'Ротвейлер', assetKey: 'heavy', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
  { id: 'kolbasa', name: 'Колбаса', breed: 'Такса', assetKey: 'kolbasa', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
  { id: 'pushok', name: 'Пушок', breed: 'Померанский шпиц', assetKey: 'pushok', assetStatus: 'placeholder', priceBones: 0, combatProfile: 'shared' },
];

/** v0.2 roles: challenger was Шиба, accepter was Буль. */
export const LEGACY_ROLE_FIGHTERS: readonly [string, string] = ['shiba', 'bull'];

export function isCharacterId(id: unknown): id is string {
  return typeof id === 'string' && CHARACTERS.some((c) => c.id === id);
}

export function characterById(id: string | null | undefined): CharacterDef | null {
  return CHARACTERS.find((c) => c.id === id) ?? null;
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
