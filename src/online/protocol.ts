/**
 * Wire protocol shared by the client (src/online) and the duel server (server/).
 * Pure types only — no runtime code, no DOM / Workers APIs.
 */
import type { BattleState, PlayerIndex, TurnRecord } from '../engine';

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
}

export interface MeResponse {
  user: PlayerInfo;
  bot: string;
  duels: DuelSummary[];
  /** Present when the Mini App was opened from a group chat. */
  leaderboard: LeaderRow[] | null;
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
