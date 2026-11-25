import { getInitData, isTelegram } from '../platform/telegram';
import type { CreateDuelResponse, DuelView, MeResponse, RematchResponse, SpinResponse } from './protocol';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        authorization: `tma ${getInitData()}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверь интернет.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'http', data?.message ?? `Ошибка сервера (${res.status})`);
  return data as T;
}

export const api = {
  me: () => request<MeResponse>('GET', '/me'),
  create: () => request<CreateDuelResponse>('POST', '/duels'),
  duel: (id: string) => request<DuelView>('GET', `/duels/${id}`),
  accept: (id: string) => request<DuelView>('POST', `/duels/${id}/accept`),
  spin: (id: string, expected: number) => request<SpinResponse>('POST', `/duels/${id}/spin`, { expected }),
  forfeit: (id: string) => request<DuelView>('POST', `/duels/${id}/forfeit`),
  rematch: (id: string) => request<RematchResponse>('POST', `/duels/${id}/rematch`),
  share: (id: string) => request<{ prepared: string | null }>('POST', `/duels/${id}/share`),
};

/** Duels need Telegram (identity) and the duel server (same origin). */
export async function detectOnline(): Promise<boolean> {
  if (!isTelegram() || !getInitData()) return false;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.configured;
  } catch {
    return false;
  }
}
