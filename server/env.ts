import type { GameStore } from './store';

export interface Env {
  BOT_TOKEN: string;
  /** Optional: mock Bot API base URL for local tests. */
  TG_API_BASE?: string;
  /** Release flags for rollback (docs/releases/v0.3.md): 'pause' stops the job. */
  V03_SETTLEMENT?: string;
  V03_JOBS?: string;
  /** '1' enables /api/dev/* (local tests only, never set in production). */
  DEV_MODE?: string;
  STORE: DurableObjectNamespace<GameStore>;
  ASSETS: Fetcher;
}
