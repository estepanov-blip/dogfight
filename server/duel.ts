/**
 * Duel domain: pure functions on top of the combat engine. The server is
 * authoritative — it owns the seed / RNG state and executes every spin.
 * No Workers APIs here, so this file is unit-tested with vitest.
 */
import { BALANCE, createBattle, forfeit, other, takeTurn, type BattleState, type PlayerIndex, type TurnRecord } from '../src/engine';
import type { DuelStatus, DuelSummary, DuelView, PlayerInfo } from '../src/online/protocol';

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
}

export class DuelError extends Error {
  constructor(
    readonly code: 'not_found' | 'own_duel' | 'taken' | 'not_player' | 'not_your_turn' | 'not_active' | 'not_over',
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export function createDuel(id: string, challenger: PlayerInfo, seed: number, now: number): DuelRecord {
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
  };
}

export function playerIndex(d: DuelRecord, userId: number): PlayerIndex | null {
  if (d.players[0].id === userId) return 0;
  if (d.players[1]?.id === userId) return 1;
  return null;
}

/** Accepting starts the fight. Who opens is a coin flip from the hidden seed. */
export function acceptDuel(
  d: DuelRecord,
  user: PlayerInfo,
  now: number,
  chatInstance: string | null,
): { duel: DuelRecord; changed: boolean } {
  const idx = playerIndex(d, user.id);
  if (d.status !== 'open') {
    if (idx !== null) return { duel: d, changed: false }; // idempotent re-accept
    throw new DuelError('taken', 'Этот вызов уже принял кто-то другой');
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
    },
  };
}

/**
 * One spin by `userId`. `expected` is the client's view of spinCount: if it is
 * outdated nothing happens (idempotent retries / double taps).
 */
export function spinDuel(
  d: DuelRecord,
  userId: number,
  expected: number,
  now: number,
): { duel: DuelRecord; records: TurnRecord[]; stale: boolean } {
  if (d.status !== 'active' || !d.battle) throw new DuelError('not_active', 'Бой ещё не начался или уже закончен');
  const idx = playerIndex(d, userId);
  if (idx === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  if (d.battle.spinCount !== expected) return { duel: d, records: [], stale: true };
  if (d.battle.current !== idx) throw new DuelError('not_your_turn', 'Сейчас ход соперника');
  const { state, record } = takeTurn(d.battle, BALANCE);
  return {
    stale: false,
    records: [record],
    duel: {
      ...d,
      battle: state,
      status: state.status === 'over' ? 'over' : 'active',
      updatedAt: now,
      lastSeen: { ...d.lastSeen, [userId]: now },
    },
  };
}

export function forfeitDuel(d: DuelRecord, userId: number, now: number): DuelRecord {
  if (d.status !== 'active' || !d.battle) throw new DuelError('not_active', 'Бой уже закончен');
  const idx = playerIndex(d, userId);
  if (idx === null) throw new DuelError('not_player', 'Ты не участник этого боя', 403);
  return { ...d, battle: forfeit(d.battle, idx), status: 'over', updatedAt: now };
}

/**
 * Rematch after the fight. Idempotent: if the other player already asked for
 * a rematch, both land in the same new duel. The loser opens the new fight.
 */
export function rematchDuel(
  d: DuelRecord,
  userId: number,
  newId: string,
  seed: number,
  now: number,
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

export function toView(d: DuelRecord, viewerId: number, link: string): DuelView {
  const me = playerIndex(d, viewerId);
  const battle = d.battle ? sanitizeBattle(d.battle) : null;
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
