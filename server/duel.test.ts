// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  acceptDuel,
  createDuel,
  DuelError,
  forfeitDuel,
  newDuelId,
  rematchDuel,
  spinDuel,
  toSummary,
  toView,
  touch,
  type DuelRecord,
} from './duel';
import { signInitData, validateInitData, webhookSecret } from './telegram';

const A = { id: 111, name: 'Саня' };
const B = { id: 222, name: 'Кирилл' };
const C = { id: 333, name: 'Чужой' };
const T0 = 1_700_000_000_000;

function started(seed = 7): DuelRecord {
  return acceptDuel(createDuel('duel1', A, seed, T0), B, T0 + 1, 'chat-x').duel;
}
function playOut(d: DuelRecord): DuelRecord {
  let cur = d;
  for (let i = 0; i < 100 && cur.status === 'active'; i++) {
    const who = cur.players[cur.battle!.current]!.id;
    cur = spinDuel(cur, who, cur.battle!.spinCount, T0 + 10 + i).duel;
  }
  return cur;
}

describe('duel lifecycle', () => {
  it('open challenge -> accept starts the battle', () => {
    const d = createDuel('duel1', A, 7, T0);
    expect(d.status).toBe('open');
    expect(d.battle).toBeNull();
    const r = acceptDuel(d, B, T0 + 5, 'chat-x');
    expect(r.changed).toBe(true);
    expect(r.duel.status).toBe('active');
    expect(r.duel.players[1]).toEqual(B);
    expect(r.duel.chatInstance).toBe('chat-x');
    expect(r.duel.battle!.fighters.map((f) => f.hp)).toEqual([100, 100]);
  });
  it('coin flip for the first move comes from the hidden seed', () => {
    expect(started(2).battle!.current).toBe(0);
    expect(started(3).battle!.current).toBe(1);
  });
  it('cannot accept own challenge; third player cannot take a started duel; re-accept is idempotent', () => {
    expect(() => acceptDuel(createDuel('x', A, 1, T0), A, T0, null)).toThrow(DuelError);
    const d = started();
    expect(() => acceptDuel(d, C, T0, null)).toThrow(/уже принял/);
    expect(acceptDuel(d, B, T0, null).changed).toBe(false);
  });
  it('only the current player can spin; stale expected values do nothing', () => {
    const d = started(2); // A opens
    expect(() => spinDuel(d, B.id, 0, T0)).toThrow(/ход соперника/);
    expect(() => spinDuel(d, C.id, 0, T0)).toThrow(/не участник/);
    const r = spinDuel(d, A.id, 0, T0);
    expect(r.records).toHaveLength(1);
    expect(r.duel.battle!.spinCount).toBe(1);
    // the same request again (double tap / retry) is ignored
    const again = spinDuel(r.duel, A.id, 0, T0);
    expect(again.stale).toBe(true);
    expect(again.records).toHaveLength(0);
    expect(again.duel).toBe(r.duel);
  });
  it('server-side fight is deterministic for a seed and always ends', () => {
    const a = playOut(started(42));
    const b = playOut(started(42));
    expect(a.status).toBe('over');
    expect(a.battle!.log.map((r) => r.combo.symbols.join())).toEqual(b.battle!.log.map((r) => r.combo.symbols.join()));
    expect(() => spinDuel(a, A.id, a.battle!.spinCount, T0)).toThrow(DuelError);
  });
  it('forfeit gives the win to the opponent', () => {
    const d = forfeitDuel(started(), B.id, T0);
    expect(d.status).toBe('over');
    expect(d.battle!.outcome).toBe(0);
    expect(d.battle!.endReason).toBe('forfeit');
  });
  it('rematch: both players land in the same new duel; loser opens', () => {
    const over = playOut(started(5));
    const loser = over.battle!.outcome === 0 ? 1 : 0;
    const r1 = rematchDuel(over, A.id, 'newA', 99, T0);
    expect(r1.next!.status).toBe('active');
    expect(r1.next!.battle!.current).toBe(loser);
    const r2 = rematchDuel(r1.prev, B.id, 'newB', 100, T0);
    expect(r2.next).toBeNull();
    expect(r2.id).toBe('newA');
    expect(() => rematchDuel(started(), A.id, 'z', 1, T0)).toThrow(/только после боя/);
  });
});

describe('views never leak the RNG', () => {
  it('sanitizes seed and rngState, computes yourTurn', () => {
    const d = started(2);
    const v = toView(d, A.id, 'link');
    expect(v.battle!.rngState).toBe(0);
    expect(v.battle!.seed).toBe(0);
    expect(v.me).toBe(0);
    expect(v.yourTurn).toBe(true);
    expect(toView(d, B.id, 'link').yourTurn).toBe(false);
    expect(toView(d, C.id, 'link').me).toBeNull();
    const big = started(3_141_592_654);
    expect(JSON.stringify(toView(big, A.id, 'link'))).not.toContain('3141592654');
  });
  it('summaries per player', () => {
    const over = playOut(started(5));
    const sa = toSummary(over, A.id)!;
    const sb = toSummary(over, B.id)!;
    expect([sa.result, sb.result].sort()).toEqual(['lose', 'win']);
    expect(sa.opponent).toEqual(B);
    expect(toSummary(over, C.id)).toBeNull();
  });
  it('touch is throttled', () => {
    const d = started();
    expect(touch(d, B.id, T0 + 2000)).toBe(d);
    expect(touch(d, B.id, T0 + 20_000)).not.toBe(d);
  });
  it('ids are start_param safe', () => {
    let n = 0;
    const id = newDuelId((k) => Uint8Array.from({ length: k }, () => n++ * 37));
    expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
  });
});

describe('Telegram initData', () => {
  const token = '123456:TEST-token';
  const user = JSON.stringify({ id: 111, first_name: 'Саня', username: 'sanya' });
  it('accepts a correctly signed payload', async () => {
    const now = 1_800_000_000;
    const init = await signInitData({ user, auth_date: String(now - 60), chat_instance: '-777', chat_type: 'group', start_param: 'd_abc' }, token);
    const info = await validateInitData(init, token, now);
    expect(info?.user).toEqual({ id: 111, name: 'Саня', username: 'sanya', photo: undefined });
    expect(info?.chatInstance).toBe('-777');
    expect(info?.startParam).toBe('d_abc');
  });
  it('rejects tampering, wrong token and stale data', async () => {
    const now = 1_800_000_000;
    const init = await signInitData({ user, auth_date: String(now - 60) }, token);
    expect(await validateInitData(init.replace('111', '112'), token, now)).toBeNull();
    expect(await validateInitData(init, '999:other', now)).toBeNull();
    expect(await validateInitData(init, token, now + 3 * 24 * 3600)).toBeNull();
    expect(await validateInitData('', token, now)).toBeNull();
  });
  it('webhook secret is stable and header-safe', async () => {
    const s = await webhookSecret(token);
    expect(s).toMatch(/^[0-9a-f]{48}$/);
    expect(await webhookSecret(token)).toBe(s);
  });
});
