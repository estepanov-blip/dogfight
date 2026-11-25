/**
 * One Durable Object class, many instances addressed by name:
 *   duel:<id>      — one duel; every mutation runs here, serialized (atomic turns)
 *   user:<tgId>    — the player's duel list (summaries)
 *   chat:<inst>    — "Чемпион чата" leaderboard for a group chat instance
 */
import { DurableObject } from 'cloudflare:workers';
import type { DuelSummary, LeaderRow, PlayerInfo } from '../src/online/protocol';
import {
  acceptDuel,
  DuelError,
  forfeitDuel,
  rematchDuel,
  spinDuel,
  touch,
  type DuelRecord,
} from './duel';
import type { TurnRecord } from '../src/engine';

export type DuelOp =
  | { type: 'accept'; user: PlayerInfo; now: number; chatInstance: string | null }
  | { type: 'spin'; userId: number; expected: number; now: number }
  | { type: 'forfeit'; userId: number; now: number }
  | { type: 'rematch'; userId: number; newId: string; seed: number; now: number }
  | { type: 'touch'; userId: number; now: number };

export type DuelOpResult =
  | { ok: true; duel: DuelRecord; prevDuel: DuelRecord; records: TurnRecord[]; stale: boolean; next: DuelRecord | null; changed: boolean }
  | { ok: false; code: string; message: string; status: number };

const MAX_LIST = 30;

/** Typed view of the RPC stub (RPC serialization widens tuples, so we re-assert the domain types). */
export interface StoreApi {
  getDuel(): Promise<DuelRecord | null>;
  putDuel(d: DuelRecord): Promise<void>;
  mutate(op: DuelOp): Promise<DuelOpResult>;
  upsertSummary(s: DuelSummary): Promise<void>;
  listSummaries(): Promise<DuelSummary[]>;
  recordResult(winner: PlayerInfo, loser: PlayerInfo, duelId: string): Promise<void>;
  leaderboard(): Promise<LeaderRow[]>;
}

export class GameStore extends DurableObject {
  // ---------- duel ----------
  async getDuel(): Promise<DuelRecord | null> {
    return (await this.ctx.storage.get<DuelRecord>('duel')) ?? null;
  }

  async putDuel(d: DuelRecord): Promise<void> {
    await this.ctx.storage.put('duel', d);
  }

  async mutate(op: DuelOp): Promise<DuelOpResult> {
    const d = await this.getDuel();
    if (!d) return { ok: false, code: 'not_found', message: 'Бой не найден', status: 404 };
    try {
      let duel = d;
      let records: TurnRecord[] = [];
      let stale = false;
      let next: DuelRecord | null = null;
      let changed = true;
      switch (op.type) {
        case 'accept': {
          const r = acceptDuel(d, op.user, op.now, op.chatInstance);
          duel = r.duel;
          changed = r.changed;
          break;
        }
        case 'spin': {
          const r = spinDuel(d, op.userId, op.expected, op.now);
          duel = r.duel;
          records = r.records;
          stale = r.stale;
          changed = !r.stale;
          break;
        }
        case 'forfeit':
          duel = forfeitDuel(d, op.userId, op.now);
          break;
        case 'rematch': {
          const r = rematchDuel(d, op.userId, op.newId, op.seed, op.now);
          duel = r.prev;
          next = r.next;
          changed = !!r.next;
          break;
        }
        case 'touch':
          duel = touch(d, op.userId, op.now);
          changed = false;
          break;
      }
      if (duel !== d) await this.putDuel(duel);
      return { ok: true, duel, prevDuel: d, records, stale, next, changed };
    } catch (e) {
      if (e instanceof DuelError) return { ok: false, code: e.code, message: e.message, status: e.status };
      throw e;
    }
  }

  // ---------- user ----------
  async upsertSummary(s: DuelSummary): Promise<void> {
    const list = (await this.ctx.storage.get<DuelSummary[]>('duels')) ?? [];
    const rest = list.filter((x) => x.id !== s.id);
    rest.unshift(s);
    rest.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.ctx.storage.put('duels', rest.slice(0, MAX_LIST));
  }

  async listSummaries(): Promise<DuelSummary[]> {
    return (await this.ctx.storage.get<DuelSummary[]>('duels')) ?? [];
  }

  // ---------- chat leaderboard ----------
  async recordResult(winner: PlayerInfo, loser: PlayerInfo, duelId: string): Promise<void> {
    const seen = (await this.ctx.storage.get<string[]>('counted')) ?? [];
    if (seen.includes(duelId)) return; // count every duel once
    const board = (await this.ctx.storage.get<Record<string, LeaderRow>>('board')) ?? {};
    const row = (p: PlayerInfo): LeaderRow =>
      (board[p.id] = { ...(board[p.id] ?? { id: p.id, wins: 0, losses: 0 }), name: p.name, photo: p.photo });
    row(winner).wins++;
    row(loser).losses++;
    await this.ctx.storage.put('board', board);
    await this.ctx.storage.put('counted', [...seen, duelId].slice(-500));
  }

  async leaderboard(): Promise<LeaderRow[]> {
    const board = (await this.ctx.storage.get<Record<string, LeaderRow>>('board')) ?? {};
    return Object.values(board)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, 20);
  }
}
