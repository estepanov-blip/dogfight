/**
 * One Durable Object class, many instances addressed by name:
 *   duel:<id>      — one duel; every mutation runs here, serialized (atomic turns).
 *                    Its alarm drives auto spins, reminders, timeouts, settlement
 *                    and the notification outbox (FC-06..FC-13).
 *   user:<tgId>    — duel list, wallet + ledger, personal history, profile
 *   chat:<inst>    — group results (week / all-time boards + legacy v0.2 tallies)
 *   pair:<a>:<b>   — rated-slot quota of an unordered pair (DFC-005)
 */
import { DurableObject } from 'cloudflare:workers';
import { other, type TurnRecord } from '../src/engine';
import type { DuelSummary, HeadToHead, LeaderRow, LedgerEntry, PlayerInfo, RivalRow } from '../src/online/protocol';
import { isCharacterId, normalizeFighterId, utcWeekStart } from '../src/online/v03';
import {
  acceptDuel,
  deadlineOf,
  ensureResult,
  dueReminders,
  DuelError,
  forfeitDuel,
  isV03,
  jobValid,
  markReminders,
  nextReminderAt,
  nominalDeltas,
  plannedJob,
  rematchDuel,
  setAuto,
  spinDuel,
  timeoutDuel,
  toSummary,
  touch,
  type DuelRecord,
} from './duel';
import type { Env } from './env';
import { compose, plan, reminderItems, type OutboxItem } from './notifications';
import {
  addChatEntry,
  addHistory,
  board,
  claimSlot,
  emptyPair,
  emptyWallet,
  ensureStart,
  headToHead,
  pairKey,
  postResult,
  rivals,
  type ChatEntry,
  type ChatState,
  type HistoryEntry,
  type HistoryState,
  type PairState,
  type WalletState,
} from './settlement';
import { BotApi } from './telegram';

export type DuelOp =
  | { type: 'accept'; user: PlayerInfo; now: number; chatInstance: string | null; fighters: [string | null, string | null]; origin: string }
  | { type: 'spin'; userId: number; expected: number; now: number; origin: string }
  | { type: 'forfeit'; userId: number; now: number; origin: string }
  | { type: 'rematch'; userId: number; newId: string; seed: number; now: number; fighters: [string | null, string | null]; origin: string }
  | { type: 'auto'; userId: number; on: boolean; now: number; origin: string }
  | { type: 'touch'; userId: number; now: number; origin: string }
  | { type: 'devShift'; ms: number; now: number; origin: string };

export type DuelOpResult =
  | { ok: true; duel: DuelRecord; prevDuel: DuelRecord; records: TurnRecord[]; stale: boolean; next: DuelRecord | null; changed: boolean }
  | { ok: false; code: string; message: string; status: number };

const MAX_LIST = 30;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 5 * 60_000;

/** Typed view of the RPC stub (RPC serialization widens tuples, so we re-assert the domain types). */
export interface StoreApi {
  getDuel(): Promise<DuelRecord | null>;
  putDuel(d: DuelRecord): Promise<void>;
  mutate(op: DuelOp): Promise<DuelOpResult>;
  settleNow(): Promise<DuelRecord | null>;
  upsertSummary(s: DuelSummary): Promise<void>;
  listSummaries(): Promise<DuelSummary[]>;
  wallet(now: number): Promise<{ balance: number }>;
  postResult(duelId: string, playerId: number, nominal: number, reason: string, now: number): Promise<{ nominal: number; actual: number }>;
  ledger(): Promise<LedgerEntry[]>;
  addHistory(e: HistoryEntry): Promise<void>;
  rivals(): Promise<RivalRow[]>;
  headToHead(opponentId: number): Promise<HeadToHead>;
  profile(): Promise<{ fighter: string | null }>;
  setProfile(fighter: string): Promise<{ fighter: string | null }>;
  claim(duelId: string, day: string): Promise<{ rated: boolean; slot: number | null; day: string }>;
  addChatEntry(e: ChatEntry): Promise<void>;
  addLegacyResult(winner: PlayerInfo, loser: PlayerInfo, duelId: string): Promise<void>;
  boards(now: number): Promise<{ week: LeaderRow[]; all: LeaderRow[]; weekStart: number }>;
  leaderboard(): Promise<LeaderRow[]>;
}

export class GameStore extends DurableObject<Env> {
  private stub(name: string): StoreApi {
    return this.env.STORE.getByName(name) as unknown as StoreApi;
  }

  // =================================================================== duel
  async getDuel(): Promise<DuelRecord | null> {
    return (await this.ctx.storage.get<DuelRecord>('duel')) ?? null;
  }

  async putDuel(d: DuelRecord): Promise<void> {
    await this.ctx.storage.put('duel', d);
    await this.reschedule(d);
  }

  private async outbox(): Promise<OutboxItem[]> {
    return (await this.ctx.storage.get<OutboxItem[]>('outbox')) ?? [];
  }

  private async enqueue(items: OutboxItem[]) {
    if (!items.length) return;
    const box = await this.outbox();
    const keys = new Set(box.map((i) => i.key));
    await this.ctx.storage.put('outbox', [...box, ...items.filter((i) => !keys.has(i.key))]);
  }

  async mutate(op: DuelOp): Promise<DuelOpResult> {
    const d0 = await this.getDuel();
    if (!d0) return { ok: false, code: 'not_found', message: 'Бой не найден', status: 404 };
    const repaired = ensureResult(d0);
    const d = repaired.origin ? repaired : { ...repaired, origin: op.origin };
    try {
      // A request that arrives after the deadline first applies the timeout (one transition).
      if (op.type !== 'accept' && op.type !== 'rematch' && op.type !== 'devShift') {
        const timedOut = timeoutDuel(d, op.now);
        if (timedOut !== d) {
          await this.enqueue(plan(d, timedOut, { type: 'timeout' }, null, op.now));
          await this.ctx.storage.put('duel', timedOut);
          await this.reschedule(timedOut, true);
          if (op.type !== 'touch') return { ok: false, code: 'turn_expired', message: 'Время хода истекло — техническое поражение', status: 409 };
          return { ok: true, duel: timedOut, prevDuel: d0, records: [], stale: false, next: null, changed: true };
        }
      }
      let duel = d;
      let records: TurnRecord[] = [];
      let stale = false;
      let next: DuelRecord | null = null;
      let changed = true;
      switch (op.type) {
        case 'accept': {
          const r = acceptDuel(d, op.user, op.now, op.chatInstance, op.fighters);
          duel = r.duel;
          changed = r.changed;
          break;
        }
        case 'spin': {
          const r = spinDuel(d, op.userId, op.expected, op.now, 'manual');
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
          const r = rematchDuel(d, op.userId, op.newId, op.seed, op.now, op.fighters, op.origin);
          duel = r.prev;
          next = r.next;
          changed = !!r.next;
          break;
        }
        case 'auto':
          duel = setAuto(d, op.userId, op.on, op.now);
          changed = duel !== d;
          break;
        case 'touch':
          duel = touch(d, op.userId, op.now);
          changed = false;
          break;
        case 'devShift':
          duel = devShift(d, op.ms);
          break;
      }
      if (changed) {
        const actor = op.type === 'spin' || op.type === 'forfeit' || op.type === 'rematch' || op.type === 'auto' ? op.userId : undefined;
        await this.enqueue(plan(d, duel, { type: op.type, userId: actor }, next, op.now));
      }
      if (duel !== d0) {
        await this.ctx.storage.put('duel', duel);
        await this.reschedule(duel, changed || repaired !== d0);
      }
      return { ok: true, duel, prevDuel: d0, records, stale, next, changed };
    } catch (e) {
      if (e instanceof DuelError) return { ok: false, code: e.code, message: e.message, status: e.status };
      throw e;
    }
  }

  /** Next wake-up: auto job, reminder, deadline, settlement retry or pending outbox. */
  private async reschedule(d0: DuelRecord, soon = false) {
    let d = d0;
    const now = Date.now();
    const times: number[] = [];
    if (d.status === 'active' && this.env.V03_JOBS !== 'pause') {
      const job = d.job && jobValid(d, d.job) ? d.job : plannedJob(d, now);
      const same = (a: typeof job, b: typeof job) => (!a && !b) || (!!a && !!b && a.at === b.at && a.spin === b.spin && a.ver === b.ver && a.player === b.player);
      if (!same(job, d.job ?? null)) {
        d = { ...d, job };
        await this.ctx.storage.put('duel', d);
      }
      if (job) times.push(job.at);
      const rem = nextReminderAt(d);
      if (rem !== null) times.push(rem);
      const dl = deadlineOf(d);
      if (dl !== null) times.push(dl);
    }
    if (d.result?.settlement.state === 'pending' && this.env.V03_SETTLEMENT !== 'pause') {
      const a = d.result.settlement.attempts;
      times.push(a === 0 ? now : now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (a - 1)));
    }
    if (soon || (await this.outbox()).length) times.push(now);
    if (times.length) await this.ctx.storage.setAlarm(Math.max(now, Math.min(...times)));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    let d = await this.getDuel();
    if (!d) return;
    const now = Date.now();
    if (this.env.V03_JOBS !== 'pause' && d.status === 'active') {
      const t = timeoutDuel(d, now);
      if (t !== d) {
        await this.enqueue(plan(d, t, { type: 'timeout' }, null, now));
        d = t;
        await this.ctx.storage.put('duel', d);
      } else {
        if (d.job && now >= d.job.at && jobValid(d, d.job)) {
          // auto spin: the same transition as a manual press; a stale job is a no-op
          try {
            const r = spinDuel(d, d.job.player, d.job.spin, now, 'auto');
            if (!r.stale) {
              await this.enqueue(plan(d, r.duel, { type: 'spin' }, null, now));
              d = r.duel;
              await this.ctx.storage.put('duel', d);
            }
          } catch (e) {
            if (!(e instanceof DuelError)) throw e;
          }
        }
        const due = dueReminders(d, now);
        if (due.length) {
          await this.enqueue(reminderItems(d, due));
          d = markReminders(d, due);
          await this.ctx.storage.put('duel', d);
        }
      }
    }
    if (d.result?.settlement.state === 'pending' && this.env.V03_SETTLEMENT !== 'pause') d = await this.settle(d);
    await this.flushOutbox(d);
    await this.reschedule((await this.getDuel()) ?? d);
  }

  /** Lets a request finish the settlement inline (fresh result on the result screen). */
  async settleNow(): Promise<DuelRecord | null> {
    const d = await this.getDuel();
    if (!d || d.result?.settlement.state !== 'pending' || this.env.V03_SETTLEMENT === 'pause') return d;
    const s = await this.settle(d);
    await this.reschedule(s);
    return s;
  }

  /**
   * Settlement (FC-11..15): every step is idempotent at its receiver and is
   * recorded in the duel after it succeeds, so a crash between steps converges.
   */
  private async settle(d0: DuelRecord): Promise<DuelRecord> {
    let d = d0;
    const save = async (next: DuelRecord) => {
      d = next;
      await this.ctx.storage.put('duel', d);
    };
    const step = (k: string) => !!d.result!.settlement.steps[k];
    const mark = (k: string) =>
      save({ ...d, result: { ...d.result!, settlement: { ...d.result!.settlement, steps: { ...d.result!.settlement.steps, [k]: true } } } });
    const [p0, p1] = d.players;
    try {
      if (p1) {
        // 1. rated slot of the pair (atomic in the pair object)
        if (d.result!.rated === 'pending') {
          const dec = await this.stub(pairKey(p0.id, p1.id)).claim(d.id, d.result!.day);
          await save({ ...d, result: { ...d.result!, rated: dec.rated ? 'rated' : 'friendly', slot: dec.slot ?? undefined } });
        }
        const legacy = d.result!.rated === 'legacy';
        // 2. wallets (zero entries are posted too: explicit "no bones" mark)
        if (!legacy) {
          const nominal = nominalDeltas(d);
          for (const p of [p0, p1]) {
            const k = `wallet:${p.id}`;
            if (step(k)) continue;
            const applied = await this.stub(`user:${p.id}`).postResult(d.id, p.id, nominal[p.id] ?? 0, `${d.result!.rated}:${d.result!.reason}`, d.result!.finalizedAt);
            await save({ ...d, result: { ...d.result!, deltas: { ...(d.result!.deltas ?? {}), [p.id]: applied } } });
            await mark(k);
          }
        }
        // 3. personal history
        for (const [i, p] of [p0, p1].entries()) {
          const k = `history:${p.id}`;
          if (step(k)) continue;
          const r = d.result!;
          await this.stub(`user:${p.id}`).addHistory({
            duelId: d.id,
            opponent: d.players[other(i as 0 | 1)]!,
            result: r.outcome === 'draw' ? 'draw' : r.outcome === i ? 'win' : 'lose',
            reason: r.reason,
            rated: r.rated,
            at: r.finalizedAt,
            delta: r.deltas?.[p.id] ?? null,
            chatInstance: d.chatInstance,
          });
          await mark(k);
        }
        // 4. group board
        if (d.chatInstance && !step('chat')) {
          const r = d.result!;
          const chat = this.stub(`chat:${d.chatInstance}`);
          if (r.rated === 'legacy') {
            if (r.outcome !== 'draw') await chat.addLegacyResult(d.players[r.outcome]!, d.players[other(r.outcome)]!, d.id);
          } else {
            await chat.addChatEntry({ duelId: d.id, at: r.finalizedAt, a: p0, b: p1, winner: r.outcome === 'draw' ? 'draw' : r.outcome === 0 ? 'a' : 'b', rated: r.rated });
          }
          await mark('chat');
        }
        // 5. duel lists
        if (!step('summaries')) {
          const cur = d;
          await Promise.all([p0, p1].map((p) => this.stub(`user:${p.id}`).upsertSummary(toSummary(cur, p.id)!)));
          await mark('summaries');
        }
      }
      await save({ ...d, result: { ...d.result!, settlement: { ...d.result!.settlement, state: 'done', lastError: undefined } } });
    } catch (e) {
      const s = d.result!.settlement;
      await save({ ...d, result: { ...d.result!, settlement: { ...s, attempts: s.attempts + 1, lastError: String(e).slice(0, 200) } } });
    }
    return d;
  }

  /**
   * At-most-once delivery: an item is marked and removed before sending. If the
   * network fails after Telegram accepted a message we cannot know it, so it is
   * never resent (documented ambiguity, docs/releases/v0.3.md).
   */
  private async flushOutbox(d0: DuelRecord) {
    const box = await this.outbox();
    if (!box.length) return;
    let d = d0;
    // final messages wait for the settlement (to carry the bones delta), at most a few retries
    const settling = d.result?.settlement.state === 'pending' && (d.result?.settlement.attempts ?? 0) <= 3 && this.env.V03_SETTLEMENT !== 'pause';
    const ready = box.filter((i) => i.kind !== 'final' || !settling);
    if (!ready.length) return;
    const notified = { ...(d.notified ?? {}) };
    const fresh = ready.filter((i) => !notified[i.key]);
    for (const i of fresh) notified[i.key] = Date.now();
    d = { ...d, notified };
    await this.ctx.storage.put('outbox', box.filter((i) => !ready.includes(i)));
    await this.ctx.storage.put('duel', d);
    if (!this.env.BOT_TOKEN) return;
    const bot = new BotApi(this.env.BOT_TOKEN, this.env.TG_API_BASE || undefined);
    const origin = d.origin ?? '';
    for (const item of fresh) {
      // stale items: a reminder / turn message for a spin that is no longer current
      if ((item.kind === 'reminder' || item.kind === 'turn') && (d.status !== 'active' || !d.battle || d.players[d.battle.current]?.id !== item.to)) continue;
      const target = item.kind === 'rematch' ? ((await this.stub(`duel:${item.duelId}`).getDuel()) ?? d) : d;
      const { text, button } = compose(item, target);
      try {
        await bot.call('sendMessage', {
          chat_id: item.to,
          text,
          parse_mode: 'HTML',
          ...(origin ? { reply_markup: { inline_keyboard: [[{ text: `🥊 ${button}`, web_app: { url: `${origin}/?duel=${item.duelId}` } }]] } } : {}),
        });
      } catch {
        // no consent / bot blocked: opt-in by design, never retried
      }
    }
  }

  // =================================================================== user
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

  private async walletState(): Promise<WalletState> {
    return (await this.ctx.storage.get<WalletState>('wallet')) ?? emptyWallet();
  }

  /** First wallet access grants the starting 500 exactly once (also for v0.2 players). */
  async wallet(now: number): Promise<{ balance: number }> {
    const w0 = await this.walletState();
    const w = ensureStart(w0, now);
    if (!w0.startGranted) await this.ctx.storage.put('wallet', w);
    return { balance: w.balance };
  }

  async postResult(duelId: string, playerId: number, nominal: number, reason: string, now: number) {
    const w0 = await this.walletState();
    const r = postResult(w0, duelId, playerId, nominal, reason, now);
    if (r.wallet !== w0) await this.ctx.storage.put('wallet', r.wallet);
    return r.applied;
  }

  async ledger(): Promise<LedgerEntry[]> {
    return (await this.walletState()).ledger;
  }

  private async historyState(): Promise<HistoryState> {
    return (await this.ctx.storage.get<HistoryState>('history')) ?? {};
  }

  async addHistory(e: HistoryEntry): Promise<void> {
    const h0 = await this.historyState();
    const h = addHistory(h0, e);
    if (h !== h0) await this.ctx.storage.put('history', h);
  }

  async rivals(): Promise<RivalRow[]> {
    return rivals(await this.historyState());
  }

  async headToHead(opponentId: number): Promise<HeadToHead> {
    return headToHead(await this.historyState(), opponentId);
  }

  /** Saved fighter; a retired placeholder id (Fighter Pack v0.3) is migrated to its replacement on read. */
  async profile(): Promise<{ fighter: string | null }> {
    const p = await this.ctx.storage.get<{ fighter: string | null }>('profile');
    if (!p) return { fighter: null };
    const fighter = normalizeFighterId(p.fighter);
    if (fighter !== p.fighter) {
      const migrated = { fighter };
      await this.ctx.storage.put('profile', migrated);
      return migrated;
    }
    return p;
  }

  async setProfile(fighter: string): Promise<{ fighter: string | null }> {
    if (!isCharacterId(fighter)) throw new Error('unknown fighter');
    const p = { fighter };
    await this.ctx.storage.put('profile', p);
    return p;
  }

  // =================================================================== pair
  async claim(duelId: string, day: string) {
    const s0 = (await this.ctx.storage.get<PairState>('pair')) ?? emptyPair();
    const r = claimSlot(s0, duelId, day);
    if (r.state !== s0) await this.ctx.storage.put('pair', r.state);
    return r.decision;
  }

  // =================================================================== chat
  private async chatState(): Promise<ChatState> {
    const [entries, legacy] = await Promise.all([
      this.ctx.storage.get<ChatState['entries']>('entries'),
      this.ctx.storage.get<ChatState['legacy']>('board'), // v0.2 key, read as the marked legacy source
    ]);
    return { entries: entries ?? {}, legacy: legacy ?? {} };
  }

  async addChatEntry(e: ChatEntry): Promise<void> {
    const c0 = await this.chatState();
    if (c0.entries[e.duelId]) return;
    // Rollback case: v0.2 code already counted this duel in the legacy tallies -> move it, never count twice.
    const seen = (await this.ctx.storage.get<string[]>('counted')) ?? [];
    if (seen.includes(e.duelId) && e.winner !== 'draw') {
      const b = { ...c0.legacy };
      const w = e.winner === 'a' ? e.a : e.b;
      const l = e.winner === 'a' ? e.b : e.a;
      if (b[w.id]) b[w.id] = { ...b[w.id], wins: Math.max(0, b[w.id].wins - 1) };
      if (b[l.id]) b[l.id] = { ...b[l.id], losses: Math.max(0, b[l.id].losses - 1) };
      await this.ctx.storage.put('board', b);
      await this.ctx.storage.put('counted', seen.filter((x) => x !== e.duelId));
    }
    const c = addChatEntry(c0, e);
    await this.ctx.storage.put('entries', c.entries);
  }

  /** v0.2 behaviour for legacy duels that finish after the update (counted once). */
  async addLegacyResult(winner: PlayerInfo, loser: PlayerInfo, duelId: string): Promise<void> {
    const seen = (await this.ctx.storage.get<string[]>('counted')) ?? [];
    if (seen.includes(duelId)) return;
    const b = (await this.ctx.storage.get<ChatState['legacy']>('board')) ?? {};
    const row = (p: PlayerInfo) => (b[p.id] = { ...(b[p.id] ?? { id: p.id, wins: 0, losses: 0 }), name: p.name, photo: p.photo });
    row(winner).wins++;
    row(loser).losses++;
    await this.ctx.storage.put('board', b);
    await this.ctx.storage.put('counted', [...seen, duelId].slice(-500));
  }

  async boards(now: number) {
    const c = await this.chatState();
    return { week: board(c, 'week', now), all: board(c, 'all', now), weekStart: utcWeekStart(now) };
  }

  /** v0.2 API shape: all-time board. */
  async leaderboard(): Promise<LeaderRow[]> {
    return board(await this.chatState(), 'all', Date.now()).slice(0, 20);
  }
}

/** Local tests only (DEV_MODE): pretend `ms` passed since the current turn became due. */
function devShift(d: DuelRecord, ms: number): DuelRecord {
  if (!isV03(d) || d.status !== 'active') return d;
  const lastSeen = Object.fromEntries(Object.entries(d.lastSeen).map(([k, v]) => [k, v - ms]));
  return { ...d, turnDueAt: (d.turnDueAt ?? d.updatedAt) - ms, updatedAt: d.updatedAt - ms, lastSeen, job: null };
}
