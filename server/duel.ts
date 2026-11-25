/**
 * Duel domain: pure functions on top of the combat engine. The server is
 * authoritative — it owns the seed / RNG state and executes every spin.
 * No Workers APIs here, so this file is unit-tested with vitest.
 *
 * v0.3 (schema 2) adds: auto-battle flags, per-spin deadlines + reminders,
 * one immutable finalization with a reason, settlement bookkeeping and
 * fighter snapshots. Records without `schema` are v0.2 legacy duels and keep
 * v0.2 behaviour (no timeout, no economy / quota, Шиба vs Буль).
 */
import {
  BALANCE,
  createBattle,
  forfeit,
  other,
  takeTurn,
  timeoutLoss,
  type BattleState,
  type PlayerIndex,
  type TurnRecord,
} from '../src/engine';
import type { DuelResultView, DuelStatus, DuelSummary, DuelView, HeadToHead, PlayerInfo } from '../src/online/protocol';
import {
  DUEL_SCHEMA,
  ECONOMY,
  LEGACY_ROLE_FIGHTERS,
  TIMING_V03,
  type RatedStatus,
  type ResultReason,
} from '../src/online/v03';

export interface AutoFlag {
  on: boolean;
  /** Incremented on every confirmed toggle; a scheduled auto spin carries it. */
  ver: number;
}

export interface AutoJob {
  spin: number; // expected spinCount at execution
  player: number; // expected user id
  ver: number; // expected auto flag version
  at: number; // due time (ms)
}

export interface Settlement {
  state: 'pending' | 'done';
  steps: Record<string, boolean>;
  attempts: number;
  lastError?: string;
}

export interface DuelResult {
  outcome: PlayerIndex | 'draw';
  reason: ResultReason;
  finalizedAt: number;
  /** For turn_timeout: the deadline that expired (to measure processing delay). */
  deadline?: number;
  rated: RatedStatus;
  /** UTC day of finalization (pair quota bucket). */
  day: string;
  slot?: number;
  deltas?: Record<string, { nominal: number; actual: number }>;
  settlement: Settlement;
}

export interface DuelRecord {
  id: string;
  status: DuelStatus;
  players: [PlayerInfo, PlayerInfo | null];
  seed: number;
  battle: BattleState | null;
  createdAt: number;
  updatedAt: number;
  chatInstance: string | null;
  rematchOf: string | null;
  rematchId: string | null;
  /** userId -> last time (ms) the player looked at this duel */
  lastSeen: Record<string, number>;
  // ---- v0.3 (all optional: v0.2 records stay readable) ----
  schema?: number;
  /** Combat rules the duel started with (balance.json is the only source). */
  rulesVersion?: string;
  fighters?: [string, string];
  auto?: Record<string, AutoFlag>;
  job?: AutoJob | null;
  /** When the currently expected spin became due. */
  turnDueAt?: number;
  /** Reminder offsets already sent for spin #spin. */
  reminders?: { spin: number; sent: number[] };
  /** Spin indices executed by the auto-battle (metrics). */
  autoSpins?: number[];
  result?: DuelResult | null;
  /** Origin of the Worker that created the duel (for links in background jobs). */
  origin?: string;
  /** Notification keys already sent (server-side dedupe). */
  notified?: Record<string, number>;
}

export type DuelErrorCode =
  | 'not_found'
  | 'own_duel'
  | 'taken'
  | 'not_player'
  | 'not_your_turn'
  | 'not_active'
  | 'not_over'
  | 'turn_expired';

export class DuelError extends Error {
  readonly code: DuelErrorCode;
  readonly status: number;
  constructor(code: DuelErrorCode, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const isV03 = (d: DuelRecord) => (d.schema ?? 1) >= DUEL_SCHEMA;

export function createDuel(id: string, challenger: PlayerInfo, seed: number, now: number, origin?: string): DuelRecord {
  return {
    id,
    status: 'open',
    players: [challenger, null],
    seed: seed >>> 0,
    battle: null,
    createdAt: now,
    updatedAt: now,
    chatInstance: null,
    rematchOf: null,
    rematchId: null,
    lastSeen: { [challenger.id]: now },
    schema: DUEL_SCHEMA,
    rulesVersion: 'v0.2',
    auto: {},
    job: null,
    result: null,
    origin,
    notified: {},
  };
}

export function playerIndex(d: DuelRecord, userId: number): PlayerIndex | null {
  if (d.players[0].id === userId) return 0;
  if (d.players[1]?.id === userId) return 1;
  return null;
}

export function currentPlayer(d: DuelRecord): PlayerInfo | null {
  if (d.status !== 'active' || !d.battle) return null;
  return d.players[d.battle.current] ?? null;
}

export function fightersOf(d: DuelRecord): [string, string] {
  return d.fighters ?? [LEGACY_ROLE_FIGHTERS[0], LEGACY_ROLE_FIGHTERS[1]];
}

export function deadlineOf(d: DuelRecord): number | null {
  if (!isV03(d) || d.status !== 'active' || d.turnDueAt === undefined) return null;
  return d.turnDueAt + TIMING_V03.turnTimeoutMs;
}

/**
 * Accepting starts the fight. Who opens is a coin flip from the hidden seed.
 * `fighters` = profile choices of challenger and accepter at this moment
 * (null = no choice -> v0.2 role defaults). An open v0.2 challenge accepted
 * after the update becomes a v0.3 duel (it was never active under v0.2).
 */
export function acceptDuel(
  d: DuelRecord,
  user: PlayerInfo,
  now: number,
  chatInstance: string | null,
  fighters: [string | null, string | null] = [null, null],
): { duel: DuelRecord; changed: boolean } {
  const idx = playerIndex(d, user.id);
  if (d.status !== 'open') {
    if (idx !== null) return { duel: d, changed: false }; // idempotent re-accept
    throw new DuelError('taken', 'Этот вызов уже принят');
  }
  if (idx === 0) throw new DuelError('own_duel', 'Нельзя принять собственный вызов');
  const starter = (d.seed & 1) as PlayerIndex;
  return {
    changed: true,
    duel: {
      ...d,
      status: 'active',
      players: [d.players[0], user],
      battle: createBattle(BALANCE, { seed: d.seed, starter }),
      chatInstance: chatInstance ?? d.chatInstance,
      updatedAt: now,
      lastSeen: { ...d.lastSeen, [user.id]: now },
      schema: DUEL_SCHEMA,
      rulesVersion: d.rulesVersion ?? 'v0.2',
      fighters: [fighters[0] ?? LEGACY_ROLE_FIGHTERS[0], fighters[1] ?? LEGACY_ROLE_FIGHTERS[1]],
      auto: d.auto ?? {},
      job: null,
      turnDueAt: now,
      reminders: { spin: 0, sent: [] },
      result: null,
      notified: d.notified ?? {},
    },
  };
}

// ---------------------------------------------------------------- finalization

function emptySettlement(): Settlement {
  return { state: 'pending', steps: {}, attempts: 0 };
}

/**
 * THE single place a duel becomes final (FC-10). Writes the result once; a
 * second finalization of a finished duel is rejected by the callers' guards.
 */
function finalize(d: DuelRecord, battle: BattleState, reason: ResultReason, now: number, deadline?: number): DuelRecord {
  if (d.result) return d;
  const outcome = battle.outcome ?? 'draw';
  const result: DuelResult = {
    outcome,
    reason,
    finalizedAt: now,
    rated: isV03(d) ? 'pending' : 'legacy',
    day: new Date(now).toISOString().slice(0, 10),
    settlement: emptySettlement(),
  };
  if (deadline !== undefined) result.deadline = deadline;
  return { ...d, battle, status: 'over', updatedAt: now, result, job: null };
}

function battleReason(b: BattleState): ResultReason {
  if (b.endReason === 'doubleKo') return 'doubleKo';
  if (b.endReason === 'spinLimit') return 'spinLimit';
  return 'ko';
}

/** Did both sides already spin at least once? (ordinary vs early surrender) */
export function bothSpun(b: BattleState): boolean {
  return b.log.some((r) => r.actor === 0) && b.log.some((r) => r.actor === 1);
}

// ---------------------------------------------------------------- the spin transition

export type SpinSource = 'manual' | 'auto';

/**
 * Single authoritative transition for one spin (FC-06). Manual requests and
 * auto jobs both go through here. `expected` = spinCount the caller saw; if it
 * is outdated nothing happens (idempotent retries, races of manual vs auto).
 */
export function spinDuel(
  d: DuelRecord,
  userId: number,
  expected: number,
  now: number,
  source: SpinSource = 'manual',
): { duel: DuelRecord; records: TurnRecord[]; stale: boolean } {
  if (d.status !== 'active' || !d.battle) {
    if (d.status === 'over' && d.battle && d.battle.spinCount !== expected) return { duel: d, records: [], stale: true };
    throw new DuelError('not_active', 'Бой ещё не начался или уже закончен');
  }
  const idx = playerIndex(d, userId);
  if (idx === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  if (d.battle.spinCount !== expected) return { duel: d, records: [], stale: true };
  const dl = deadlineOf(d);
  if (dl !== null && now >= dl) throw new DuelError('turn_expired', 'Время хода истекло');
  if (d.battle.current !== idx) throw new DuelError('not_your_turn', 'Сейчас ход соперника');
  const { state, record } = takeTurn(d.battle, BALANCE);
  let next: DuelRecord = {
    ...d,
    battle: state,
    updatedAt: now,
    lastSeen: source === 'manual' ? { ...d.lastSeen, [userId]: now } : d.lastSeen,
    job: null,
    autoSpins: source === 'auto' ? [...(d.autoSpins ?? []), record.index] : d.autoSpins,
  };
  if (state.status === 'over') next = finalize(next, state, battleReason(state), now);
  else if (isV03(d)) next = { ...next, turnDueAt: now, reminders: { spin: state.spinCount, sent: [] } };
  return { stale: false, records: [record], duel: next };
}

/** Surrender (FC-10): ordinary after both sides spun, otherwise early/technical. */
export function forfeitDuel(d: DuelRecord, userId: number, now: number): DuelRecord {
  if (d.status !== 'active' || !d.battle) throw new DuelError('not_active', 'Бой уже закончен');
  const idx = playerIndex(d, userId);
  if (idx === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  const reason: ResultReason = !isV03(d) || bothSpun(d.battle) ? 'surrender' : 'early_surrender';
  return finalize(d, forfeit(d.battle, idx), reason, now);
}

/** Turn timeout (FC-09): the side whose spin expired loses technically. No-op if not yet due. */
export function timeoutDuel(d: DuelRecord, now: number): DuelRecord {
  const dl = deadlineOf(d);
  if (dl === null || now < dl || !d.battle) return d;
  return finalize(d, timeoutLoss(d.battle, d.battle.current), 'turn_timeout', now, dl);
}

// ---------------------------------------------------------------- auto-battle (DFC-001)

export function setAuto(d: DuelRecord, userId: number, on: boolean, now: number): DuelRecord {
  if (playerIndex(d, userId) === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  if (d.status !== 'active') throw new DuelError('not_active', 'Автобой доступен только в принятом активном бою');
  const cur = d.auto?.[userId] ?? { on: false, ver: 0 };
  if (cur.on === on) return d;
  return { ...d, auto: { ...(d.auto ?? {}), [userId]: { on, ver: cur.ver + 1 } }, job: null, updatedAt: now };
}

export function autoOn(d: DuelRecord, userId: number): boolean {
  return !!d.auto?.[userId]?.on;
}

/** The auto job that should exist now (or null). Pure: depends only on state. */
export function plannedJob(d: DuelRecord, now: number): AutoJob | null {
  const p = currentPlayer(d);
  if (!p || !d.battle || !autoOn(d, p.id)) return null;
  const due = Math.max(d.turnDueAt ?? d.updatedAt, d.updatedAt) + TIMING_V03.autoDelayMs;
  return { spin: d.battle.spinCount, player: p.id, ver: d.auto![p.id].ver, at: Math.max(due, now) };
}

/** Does a stored job still match the live state (all four fields)? */
export function jobValid(d: DuelRecord, job: AutoJob): boolean {
  const p = currentPlayer(d);
  return (
    !!p &&
    !!d.battle &&
    d.battle.spinCount === job.spin &&
    p.id === job.player &&
    autoOn(d, p.id) &&
    d.auto![p.id].ver === job.ver
  );
}

/** Reminder offsets (ms after turnDueAt) still to send for the current spin. */
export function dueReminders(d: DuelRecord, now: number): number[] {
  if (!isV03(d) || d.status !== 'active' || d.turnDueAt === undefined || !d.battle) return [];
  const p = currentPlayer(d);
  if (!p || autoOn(d, p.id)) return [];
  const sent = d.reminders?.spin === d.battle.spinCount ? d.reminders.sent : [];
  return TIMING_V03.reminderOffsetsMs.filter((o) => now >= d.turnDueAt! + o && !sent.includes(o));
}

export function nextReminderAt(d: DuelRecord): number | null {
  if (!isV03(d) || d.status !== 'active' || d.turnDueAt === undefined || !d.battle) return null;
  const p = currentPlayer(d);
  if (!p || autoOn(d, p.id)) return null;
  const sent = d.reminders?.spin === d.battle.spinCount ? d.reminders.sent : [];
  const left = TIMING_V03.reminderOffsetsMs.filter((o) => !sent.includes(o));
  return left.length ? d.turnDueAt + Math.min(...left) : null;
}

export function markReminders(d: DuelRecord, offsets: number[]): DuelRecord {
  if (!d.battle) return d;
  const sent = d.reminders?.spin === d.battle.spinCount ? d.reminders.sent : [];
  return { ...d, reminders: { spin: d.battle.spinCount, sent: [...new Set([...sent, ...offsets])] } };
}

// ---------------------------------------------------------------- economy matrix (DFC-002)

/** Nominal bones change per player for a finalized duel (matrix in docs/releases/v0.3.md). */
export function nominalDeltas(d: DuelRecord): Record<string, number> {
  const r = d.result;
  const [p0, p1] = d.players;
  if (!r || !p1) return {};
  const out: Record<string, number> = { [p0.id]: 0, [p1.id]: 0 };
  if (r.rated !== 'rated' || r.outcome === 'draw') return out;
  const winner = d.players[r.outcome]!;
  const loser = d.players[other(r.outcome)]!;
  const technical = r.reason === 'turn_timeout' || r.reason === 'early_surrender';
  out[winner.id] = technical ? ECONOMY.technicalWinnerDelta : ECONOMY.winDelta;
  out[loser.id] = technical ? ECONOMY.technicalLoserDelta : ECONOMY.lossDelta;
  return out;
}

/** Apply a delta to a balance with the zero floor: returns the actual delta. */
export function applyFloor(balance: number, nominal: number): number {
  if (nominal >= 0) return nominal;
  return -Math.min(Math.max(0, balance - ECONOMY.minimumBalance), -nominal) || 0; // no -0
}

// ---------------------------------------------------------------- rematch

/**
 * Rematch after the fight. Idempotent: if the other player already asked for
 * a rematch, both land in the same new duel. The loser opens; after a draw the
 * side that did not open the previous fight opens (audit A2).
 */
export function rematchDuel(
  d: DuelRecord,
  userId: number,
  newId: string,
  seed: number,
  now: number,
  fighters: [string | null, string | null] = [null, null],
  origin?: string,
): { prev: DuelRecord; next: DuelRecord | null; id: string } {
  if (d.status !== 'over' || !d.battle || !d.players[1]) throw new DuelError('not_over', 'Реванш — только после боя');
  if (playerIndex(d, userId) === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  if (d.rematchId) return { prev: d, next: null, id: d.rematchId };
  const b = d.battle;
  const starter: PlayerIndex = b.outcome === 'draw' || b.outcome === null ? other(b.starter) : other(b.outcome);
  const next: DuelRecord = {
    id: newId,
    status: 'active',
    players: [d.players[0], d.players[1]],
    seed: seed >>> 0,
    battle: createBattle(BALANCE, { seed, starter }),
    createdAt: now,
    updatedAt: now,
    chatInstance: d.chatInstance,
    rematchOf: d.id,
    rematchId: null,
    lastSeen: { [userId]: now },
    schema: DUEL_SCHEMA,
    rulesVersion: 'v0.2',
    fighters: [fighters[0] ?? fightersOf(d)[0], fighters[1] ?? fightersOf(d)[1]],
    auto: {}, // auto is off by default, also in a rematch
    job: null,
    turnDueAt: now,
    reminders: { spin: 0, sent: [] },
    result: null,
    origin: origin ?? d.origin,
    notified: {},
  };
  return { prev: { ...d, rematchId: newId, updatedAt: now }, next, id: newId };
}

/** Marks the player as online. Throttled to one write per 10 s (polling must stay cheap). */
export function touch(d: DuelRecord, userId: number, now: number): DuelRecord {
  if (playerIndex(d, userId) === null) return d;
  if (now - (d.lastSeen[userId] ?? 0) < 10_000) return d;
  return { ...d, lastSeen: { ...d.lastSeen, [userId]: now } };
}

export function isOnline(d: DuelRecord, userId: number, now: number, windowMs = 20_000): boolean {
  return now - (d.lastSeen[userId] ?? 0) < windowMs;
}

/** Hide the RNG: a client must never be able to predict upcoming spins. */
export function sanitizeBattle(b: BattleState): BattleState {
  return { ...b, rngState: 0, seed: 0 };
}

export function resultView(d: DuelRecord, viewerId: number): DuelResultView | null {
  const r = d.result;
  if (!r) return null;
  return {
    outcome: r.outcome,
    reason: r.reason,
    rated: r.rated,
    finalizedAt: r.finalizedAt,
    myDelta: r.deltas?.[viewerId] ?? null,
  };
}

export function toView(d: DuelRecord, viewerId: number, link: string, h2h: HeadToHead | null = null): DuelView {
  const me = playerIndex(d, viewerId);
  const battle = d.battle ? sanitizeBattle(d.battle) : null;
  const opp = me === null ? null : d.players[other(me)];
  return {
    id: d.id,
    status: d.status,
    players: d.players,
    me,
    battle,
    yourTurn: !!battle && d.status === 'active' && me !== null && battle.current === me,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    rematchId: d.rematchId,
    link,
    schema: isV03(d) ? DUEL_SCHEMA : null,
    fighters: fightersOf(d),
    auto: { me: me !== null && autoOn(d, viewerId), opponent: !!opp && autoOn(d, opp.id) },
    deadline: deadlineOf(d),
    result: resultView(d, viewerId),
    h2h,
  };
}

export function toSummary(d: DuelRecord, userId: number): DuelSummary | null {
  const me = playerIndex(d, userId);
  if (me === null) return null;
  const b = d.battle;
  let result: DuelSummary['result'] = null;
  if (d.status === 'over' && b) result = b.outcome === 'draw' ? 'draw' : b.outcome === me ? 'win' : 'lose';
  return {
    id: d.id,
    status: d.status,
    me,
    opponent: d.players[me === 0 ? 1 : 0],
    yourTurn: d.status === 'active' && !!b && b.current === me,
    hp: b ? [b.fighters[0].hp, b.fighters[1].hp] : [BALANCE.hp, BALANCE.hp],
    result,
    updatedAt: d.updatedAt,
  };
}

/** Readable, unguessable id usable in Telegram start_param ([A-Za-z0-9_-]). */
export function newDuelId(random: (n: number) => Uint8Array): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = random(12);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
