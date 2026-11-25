/**
 * Wire protocol shared by the client (src/online) and the duel server (server/).
 * Pure types only — no runtime code, no DOM / Workers APIs.
 */
import type { BattleState, PlayerIndex, TurnRecord } from '../engine';
import type { RatedStatus, ResultReason } from './v03';

export interface PlayerInfo {
  id: number;
  name: string;
  username?: string;
  photo?: string;
}

export type DuelStatus = 'open' | 'active' | 'over';

export interface DuelView {
  id: string;
  status: DuelStatus;
  /** Index 0 = challenger (Шиба, red corner), 1 = accepter (Буль, blue corner). */
  players: [PlayerInfo, PlayerInfo | null];
  /** Viewer's fighter index, or null for a non-participant. */
  me: PlayerIndex | null;
  /** Sanitized engine state (RNG state and seed are hidden). Null while the challenge is open. */
  battle: BattleState | null;
  yourTurn: boolean;
  createdAt: number;
  updatedAt: number;
  rematchId: string | null;
  /** t.me deep link that opens this duel in the Mini App. */
  link: string;
  // ---- v0.3 (absent fields = v0.2 server) ----
  /** 2 = v0.3 duel; null = legacy v0.2 duel (old rules, no timeout/economy/quota). */
  schema?: number | null;
  /** Character ids per side, snapshot at acceptance. */
  fighters?: [string, string];
  /** Auto-battle flags (DFC-001). */
  auto?: { me: boolean; opponent: boolean };
  /** When the current expected spin times out (ms epoch), v0.3 duels only. */
  deadline?: number | null;
  result?: DuelResultView | null;
  /** Viewer's rated head-to-head vs this opponent (filled after the fight). */
  h2h?: HeadToHead | null;
}

export interface DuelResultView {
  outcome: PlayerIndex | 'draw';
  reason: ResultReason;
  rated: RatedStatus;
  finalizedAt: number;
  /** Viewer's bones change for this duel once settled. */
  myDelta: { nominal: number; actual: number } | null;
}

export interface HeadToHead {
  wins: number;
  losses: number;
  draws: number;
  friendly: { wins: number; losses: number; draws: number };
}

export interface RivalRow extends HeadToHead {
  opponent: PlayerInfo;
  winRate: number | null;
  lastAt: number;
}

export interface LedgerEntry {
  key: string;
  nominal: number;
  actual: number;
  reason: string;
  duelId: string | null;
  at: number;
  balanceAfter: number;
}

export interface DuelSummary {
  id: string;
  status: DuelStatus;
  me: PlayerIndex;
  opponent: PlayerInfo | null;
  yourTurn: boolean;
  hp: [number, number];
  result: 'win' | 'lose' | 'draw' | null;
  updatedAt: number;
}

export interface LeaderRow {
  id: number;
  name: string;
  photo?: string;
  wins: number;
  losses: number;
  draws?: number;
  winRate?: number | null;
  /** Results imported from the v0.2 "Чемпион чата" (shown with a marker). */
  legacy?: { wins: number; losses: number } | null;
}

export interface MeResponse {
  user: PlayerInfo;
  bot: string;
  duels: DuelSummary[];
  /** v0.2 field: all-time group board. Kept for compatibility. */
  leaderboard: LeaderRow[] | null;
  // ---- v0.3 ----
  wallet?: { balance: number };
  profile?: { fighter: string | null };
  /** Group chat boards (null outside a group chat). */
  boards?: { week: LeaderRow[]; all: LeaderRow[]; weekStart: number } | null;
}

export interface RivalsResponse {
  rivals: RivalRow[];
  ledger: LedgerEntry[];
}

export interface CreateDuelResponse {
  duel: DuelView;
  /** Prepared inline message id for Telegram.WebApp.shareMessage (null if Telegram refused). */
  prepared: string | null;
}

export interface SpinResponse {
  duel: DuelView;
  records: TurnRecord[];
  /** The client's expected spin number was outdated; nothing was spun. */
  stale: boolean;
}

export interface RematchResponse {
  id: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
