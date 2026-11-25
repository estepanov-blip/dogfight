/**
 * Pure projections for v0.3 settlement (FC-11..15). Every function takes the
 * stored object, returns the next one and is idempotent by key, so a retried
 * or partially applied settlement converges to one result.
 */
import type { HeadToHead, LeaderRow, LedgerEntry, PlayerInfo, RivalRow } from '../src/online/protocol';
import { ECONOMY, utcWeekStart, winRate, type RatedStatus, type ResultReason } from '../src/online/v03';
import { applyFloor } from './duel';

// ---------------------------------------------------------------- pair quota (DFC-005)

export interface PairState {
  /** UTC day -> duel ids that took a rated slot (in finalization order). */
  days: Record<string, string[]>;
  /** duelId -> decision (never recomputed). */
  decisions: Record<string, { rated: boolean; slot: number | null; day: string }>;
}

export const emptyPair = (): PairState => ({ days: {}, decisions: {} });

export function pairKey(a: number, b: number): string {
  return a < b ? `pair:${a}:${b}` : `pair:${b}:${a}`;
}

/** First five finalized results of the pair per UTC day are rated; the rest friendly. */
export function claimSlot(
  s: PairState,
  duelId: string,
  day: string,
  limit: number = ECONOMY.ratedPerOpponentPerDay,
): { state: PairState; decision: PairState['decisions'][string] } {
  const existing = s.decisions[duelId];
  if (existing) return { state: s, decision: existing };
  const taken = s.days[day] ?? [];
  const decision = taken.length < limit ? { rated: true, slot: taken.length + 1, day } : { rated: false, slot: null, day };
  const days = decision.rated ? { ...s.days, [day]: [...taken, duelId] } : s.days;
  return { state: { days, decisions: { ...s.decisions, [duelId]: decision } }, decision };
}

export function ratedToday(s: PairState, day: string): number {
  return (s.days[day] ?? []).length;
}

// ---------------------------------------------------------------- wallet (DFC-002)

export interface WalletState {
  balance: number;
  startGranted: boolean;
  /** Idempotency keys of every posted operation. */
  keys: Record<string, { nominal: number; actual: number }>;
  /** Latest operations, newest first (bounded). */
  ledger: LedgerEntry[];
}

export const emptyWallet = (): WalletState => ({ balance: 0, startGranted: false, keys: {}, ledger: [] });
const LEDGER_KEEP = 100;

function post(w: WalletState, key: string, nominal: number, reason: string, duelId: string | null, at: number) {
  const actual = applyFloor(w.balance, nominal);
  const balance = w.balance + actual;
  const entry: LedgerEntry = { key, nominal, actual, reason, duelId, at, balanceAfter: balance };
  return {
    wallet: {
      ...w,
      balance,
      keys: { ...w.keys, [key]: { nominal, actual } },
      ledger: [entry, ...w.ledger].slice(0, LEDGER_KEEP),
    },
    applied: { nominal, actual },
  };
}

/** One starting grant per player, ever (also for v0.2 players on first wallet access). */
export function ensureStart(w: WalletState, at: number): WalletState {
  if (w.startGranted) return w;
  if (w.keys.start) return { ...w, startGranted: true };
  return { ...post(w, 'start', ECONOMY.startingBalance, 'start', null, at).wallet, startGranted: true };
}

/** Posts the duel result once per (duelId, player, 'result'); a repeat returns the stored amounts. */
export function postResult(
  w0: WalletState,
  duelId: string,
  playerId: number,
  nominal: number,
  reason: string,
  at: number,
): { wallet: WalletState; applied: { nominal: number; actual: number } } {
  const w = ensureStart(w0, at);
  const key = `${duelId}:${playerId}:result`;
  const done = w.keys[key];
  if (done) return { wallet: w, applied: done };
  return post(w, key, nominal, reason, duelId, at);
}

// ---------------------------------------------------------------- personal history (DFC-003)

export interface HistoryEntry {
  duelId: string;
  opponent: PlayerInfo;
  result: 'win' | 'lose' | 'draw';
  reason: ResultReason;
  rated: RatedStatus;
  at: number;
  delta: { nominal: number; actual: number } | null;
  chatInstance: string | null;
}

export type HistoryState = Record<string, HistoryEntry>;

export function addHistory(h: HistoryState, e: HistoryEntry): HistoryState {
  if (h[e.duelId]) return h; // a finalized result never changes
  return { ...h, [e.duelId]: e };
}

function emptyH2H(): HeadToHead {
  return { wins: 0, losses: 0, draws: 0, friendly: { wins: 0, losses: 0, draws: 0 } };
}

function bump(t: { wins: number; losses: number; draws: number }, r: HistoryEntry['result']) {
  if (r === 'win') t.wins++;
  else if (r === 'lose') t.losses++;
  else t.draws++;
}

/** Rated results count in the personal score; friendly are shown separately; legacy v0.2 duels too. */
export function headToHead(h: HistoryState, opponentId: number): HeadToHead {
  const t = emptyH2H();
  for (const e of Object.values(h)) {
    if (e.opponent.id !== opponentId) continue;
    bump(e.rated === 'rated' ? t : t.friendly, e.result);
  }
  return t;
}

/** "Мои соперники": only opponents the player actually fought. */
export function rivals(h: HistoryState): RivalRow[] {
  const by = new Map<number, RivalRow>();
  for (const e of Object.values(h)) {
    let row = by.get(e.opponent.id);
    if (!row) {
      row = { opponent: e.opponent, ...emptyH2H(), winRate: null, lastAt: 0 };
      by.set(e.opponent.id, row);
    }
    if (e.at >= row.lastAt) {
      row.lastAt = e.at;
      row.opponent = e.opponent; // freshest name/photo
    }
    bump(e.rated === 'rated' ? row : row.friendly, e.result);
  }
  const rows = [...by.values()];
  for (const r of rows) r.winRate = winRate(r.wins, r.losses, r.draws);
  return rows.sort((a, b) => b.lastAt - a.lastAt || a.opponent.id - b.opponent.id);
}

// ---------------------------------------------------------------- chat boards (DFC-003)

export interface ChatEntry {
  duelId: string;
  at: number;
  a: PlayerInfo;
  b: PlayerInfo;
  /** 'a' | 'b' winner, or 'draw' */
  winner: 'a' | 'b' | 'draw';
  rated: RatedStatus;
}

export interface ChatState {
  entries: Record<string, ChatEntry>;
  /** v0.2 "Чемпион чата" tallies (all duels, wins/losses), kept as a marked legacy source. */
  legacy: Record<string, { id: number; name: string; photo?: string; wins: number; losses: number }>;
}

export function addChatEntry(c: ChatState, e: ChatEntry): ChatState {
  if (c.entries[e.duelId]) return c;
  return { ...c, entries: { ...c.entries, [e.duelId]: e } };
}

/** Wins desc, losses asc, then stable internal id. */
export function sortBoard(rows: LeaderRow[]): LeaderRow[] {
  return [...rows].sort((x, y) => y.wins - x.wins || x.losses - y.losses || x.id - y.id);
}

/**
 * window 'week' = rated results since Monday 00:00 UTC of `now`;
 * 'all' = all rated results + legacy v0.2 tallies (marked), counted once.
 */
export function board(c: ChatState, window: 'week' | 'all', now: number): LeaderRow[] {
  const from = window === 'week' ? utcWeekStart(now) : -Infinity;
  const rows = new Map<number, LeaderRow & { draws: number }>();
  const row = (p: PlayerInfo) => {
    let r = rows.get(p.id);
    if (!r) {
      r = { id: p.id, name: p.name, photo: p.photo, wins: 0, losses: 0, draws: 0, winRate: null, legacy: null };
      rows.set(p.id, r);
    }
    return r;
  };
  for (const e of Object.values(c.entries)) {
    if (e.rated !== 'rated' || e.at < from) continue;
    const a = row(e.a), b = row(e.b);
    if (e.winner === 'draw') {
      a.draws++;
      b.draws++;
    } else if (e.winner === 'a') {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  if (window === 'all') {
    for (const l of Object.values(c.legacy)) {
      const r = row({ id: l.id, name: l.name, photo: l.photo });
      r.wins += l.wins;
      r.losses += l.losses;
      r.legacy = { wins: l.wins, losses: l.losses };
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.winRate = winRate(r.wins, r.losses, r.draws);
  return sortBoard(out);
}
