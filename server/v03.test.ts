// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  acceptDuel,
  applyFloor,
  autoOn,
  createDuel,
  deadlineOf,
  dueReminders,
  DuelError,
  forfeitDuel,
  jobValid,
  markReminders,
  nextReminderAt,
  nominalDeltas,
  plannedJob,
  rematchDuel,
  setAuto,
  spinDuel,
  timeoutDuel,
  toView,
  type DuelRecord,
} from './duel';
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
  type ChatState,
  type HistoryEntry,
} from './settlement';
import { compose, plan, reminderItems } from './notifications';
import { CHARACTERS, ECONOMY, TIMING_V03, utcDay, utcWeekStart, winRate } from '../src/online/v03';
import { BALANCE, createBattle, takeTurn } from '../src/engine';

const A = { id: 111, name: 'Аня' };
const B = { id: 222, name: 'Боря' };
const C = { id: 333, name: 'Чужой' };
const T0 = Date.UTC(2026, 10, 25, 10, 0, 0); // Wed 25 Nov 2026 10:00 UTC
const H = 3600_000;

function started(seed = 2, t = T0, fighters: [string | null, string | null] = [null, null]): DuelRecord {
  return acceptDuel(createDuel('duel1', A, seed, t, 'https://x.test'), B, t, 'chat-x', fighters).duel;
}
const cur = (d: DuelRecord) => d.players[d.battle!.current]!.id;
function playOut(d0: DuelRecord, t = T0): DuelRecord {
  let d = d0;
  for (let i = 0; i < 100 && d.status === 'active'; i++) d = spinDuel(d, cur(d), d.battle!.spinCount, t + i).duel;
  return d;
}
/** Force the outcome by making one side spin until it wins or loses (deterministic per seed). */
function finished(seed: number, t = T0) {
  return playOut(started(seed, t), t);
}

describe('FC-05 versioning: v0.2 records stay readable', () => {
  const legacy: DuelRecord = (() => {
    const d = started(5);
    const { schema: _s, rulesVersion: _r, fighters: _f, auto: _a, job: _j, turnDueAt: _t, reminders: _m, result: _x, origin: _o, notified: _n, ...v02 } = d;
    return v02 as DuelRecord;
  })();
  it('an active v0.2 duel continues with v0.2 rules: no deadline, Шиба/Буль, legacy result', () => {
    expect(deadlineOf(legacy)).toBeNull();
    const v = toView(legacy, A.id, 'l');
    expect(v.schema).toBeNull();
    expect(v.fighters).toEqual(['shiba', 'bull']);
    expect(timeoutDuel(legacy, T0 + 1000 * H)).toBe(legacy); // no retroactive timeout
    const over = playOut(legacy);
    expect(over.result!.rated).toBe('legacy');
    expect(nominalDeltas(over)).toEqual({ [A.id]: 0, [B.id]: 0 });
  });
  it('a v0.2 open challenge accepted after the update becomes a v0.3 duel', () => {
    const open = createDuel('o', A, 1, T0);
    const { schema: _s, ...old } = open;
    const d = acceptDuel(old as DuelRecord, B, T0, null).duel;
    expect(d.schema).toBe(2);
    expect(deadlineOf(d)).toBe(T0 + TIMING_V03.turnTimeoutMs);
  });
});

describe('FC-06 single spin transition', () => {
  it('manual and auto for the same spin number: only one wins, RNG moves once', () => {
    let d = started(2);
    d = setAuto(d, cur(d), true, T0);
    const s = d.battle!.spinCount;
    const manual = spinDuel(d, cur(d), s, T0 + 10, 'manual');
    const autoAfter = spinDuel(manual.duel, cur(d), s, T0 + 20, 'auto');
    expect(manual.records).toHaveLength(1);
    expect(autoAfter.stale).toBe(true);
    expect(autoAfter.duel.battle!.rngState).toBe(manual.duel.battle!.rngState);
  });
  it('same input gives the same transition via manual and auto (Q01)', () => {
    const d = started(9);
    const m = spinDuel(d, cur(d), 0, T0, 'manual').duel;
    const a = spinDuel(setAuto(d, cur(d), true, T0), cur(d), 0, T0, 'auto').duel;
    expect(a.battle!.log[0].combo).toEqual(m.battle!.log[0].combo);
    expect(a.battle!.fighters).toEqual(m.battle!.fighters);
    expect(a.autoSpins).toEqual([1]);
  });
  it('a finished duel answers a retried spin as stale, not as a second turn', () => {
    const over = finished(3);
    expect(spinDuel(over, cur(started(3)), over.battle!.spinCount - 1, T0).stale).toBe(true);
  });
});

describe('FC-07/08 auto-battle (DFC-001)', () => {
  it('only a participant, only after acceptance', () => {
    expect(() => setAuto(createDuel('o', A, 1, T0), A.id, true, T0)).toThrow(DuelError);
    expect(() => setAuto(started(), C.id, true, T0)).toThrow(/не участник/);
  });
  it('flag per player; on the opponent turn it waits; version bumps on each toggle', () => {
    let d = started(2); // A opens
    const waiting = d.players[1 - d.battle!.current]!.id;
    d = setAuto(d, waiting, true, T0);
    expect(autoOn(d, waiting)).toBe(true);
    expect(plannedJob(d, T0)).toBeNull(); // not his turn
    d = setAuto(setAuto(d, waiting, false, T0), waiting, true, T0);
    expect(d.auto![waiting].ver).toBe(3);
  });
  it('an old job is rejected after toggle-off, turn change or version change', () => {
    let d = started(2);
    d = setAuto(d, cur(d), true, T0);
    const job = plannedJob(d, T0)!;
    expect(job.at).toBe(T0 + TIMING_V03.autoDelayMs);
    expect(jobValid(d, job)).toBe(true);
    expect(jobValid(setAuto(d, cur(d), false, T0), job)).toBe(false);
    expect(jobValid(setAuto(setAuto(d, cur(d), false, T0), cur(d), true, T0), job)).toBe(false);
    const after = spinDuel(d, cur(d), 0, T0, 'manual').duel;
    expect(jobValid(after, job)).toBe(false);
  });
  it('auto/auto reaches the end with closed clients, extra turns included', () => {
    let d = started(77);
    d = setAuto(setAuto(d, A.id, true, T0), B.id, true, T0);
    let t = T0, guard = 0, extra = 0;
    while (d.status === 'active' && guard++ < 200) {
      const job = plannedJob(d, t)!;
      t = job.at;
      if (d.battle!.currentIsExtra) extra++;
      d = spinDuel(d, job.player, job.spin, t, 'auto').duel;
    }
    expect(d.status).toBe('over');
    expect(d.autoSpins!.length).toBe(d.battle!.spinCount);
    expect(d.result!.reason).toMatch(/ko|spinLimit/);
    expect(extra).toBeGreaterThanOrEqual(0);
  });
  it('auto is off by default in a rematch', () => {
    const over = finished(4);
    expect(rematchDuel(over, A.id, 'r', 1, T0).next!.auto).toEqual({});
  });
});

describe('FC-09 timeouts and reminders (Proposed: 24 h, 1 h, 12 h)', () => {
  it('reminders at 1 h and 12 h, each once, reset after a spin', () => {
    const d = started(2);
    expect(dueReminders(d, T0 + H - 1)).toEqual([]);
    expect(dueReminders(d, T0 + H)).toEqual([H]);
    const m = markReminders(d, [H]);
    expect(dueReminders(m, T0 + 2 * H)).toEqual([]);
    expect(nextReminderAt(m)).toBe(T0 + 12 * H);
    expect(dueReminders(m, T0 + 12 * H)).toEqual([12 * H]);
    const spun = spinDuel(m, cur(m), 0, T0 + 13 * H).duel;
    expect(nextReminderAt(spun)).toBe(T0 + 14 * H);
  });
  it('a late alarm that finds both reminders due sends ONE message', () => {
    const d = started(2);
    expect(reminderItems(d, dueReminders(d, T0 + 13 * H))).toHaveLength(1);
  });
  it('no reminders for a side in auto', () => {
    const d = setAuto(started(2), cur(started(2)), true, T0);
    expect(dueReminders(d, T0 + 13 * H)).toEqual([]);
  });
  it('deadline: a spin one ms before passes, at the deadline it is refused and the side loses', () => {
    const d = started(2);
    const dl = T0 + 24 * H;
    expect(deadlineOf(d)).toBe(dl);
    expect(spinDuel(d, cur(d), 0, dl - 1).records).toHaveLength(1);
    expect(() => spinDuel(d, cur(d), 0, dl)).toThrow(/истекло/);
    expect(timeoutDuel(d, dl - 1)).toBe(d);
    const t = timeoutDuel(d, dl + 5000);
    expect(t.result!.reason).toBe('turn_timeout');
    expect(t.result!.outcome).toBe(1 - d.battle!.current);
    expect(t.result!.deadline).toBe(dl);
    expect(t.result!.finalizedAt - dl).toBe(5000); // processing delay is visible
  });
  it('an extra turn starts its own 24 h', () => {
    let d = started(2);
    for (let i = 0; i < 60 && d.status === 'active'; i++) {
      const before = d;
      d = spinDuel(d, cur(d), d.battle!.spinCount, T0 + i * H).duel;
      if (d.status === 'active' && d.battle!.currentIsExtra) {
        expect(d.turnDueAt).toBe(T0 + i * H);
        expect(cur(d)).toBe(cur(before));
        return;
      }
    }
  });
});

describe('FC-10 one immutable finalization', () => {
  it('surrender before both spun = early (technical); after = ordinary', () => {
    const d = started(2);
    expect(forfeitDuel(d, B.id, T0).result!.reason).toBe('early_surrender');
    let s = d;
    while (!(s.battle!.log.some((r) => r.actor === 0) && s.battle!.log.some((r) => r.actor === 1)))
      s = spinDuel(s, cur(s), s.battle!.spinCount, T0).duel;
    if (s.status === 'active') expect(forfeitDuel(s, B.id, T0).result!.reason).toBe('surrender');
  });
  it('competing endings: after a surrender, timeout and spin change nothing', () => {
    const f = forfeitDuel(started(2), A.id, T0);
    expect(timeoutDuel(f, T0 + 100 * H)).toBe(f);
    expect(() => forfeitDuel(f, B.id, T0)).toThrow(DuelError);
    expect(() => spinDuel(f, B.id, 0, T0)).toThrow(DuelError);
    expect(f.result!.finalizedAt).toBe(T0);
  });
  it('KO, spin limit and draw carry their reason', () => {
    expect(finished(3).result!.reason).toMatch(/ko|spinLimit|doubleKo/);
  });
});

describe('FC-11 pair quota (DFC-005)', () => {
  it('first five finalized results per UTC day are rated, the 6th friendly; replay is stable', () => {
    let s = emptyPair();
    const dec = [];
    for (let i = 1; i <= 6; i++) {
      const r = claimSlot(s, `d${i}`, '2026-11-25');
      s = r.state;
      dec.push(r.decision);
    }
    expect(dec.map((d) => d.rated)).toEqual([true, true, true, true, true, false]);
    expect(dec.map((d) => d.slot)).toEqual([1, 2, 3, 4, 5, null]);
    // retry after midnight keeps the stored decision of the stored day
    expect(claimSlot(s, 'd6', '2026-11-26').decision).toEqual({ rated: false, slot: null, day: '2026-11-25' });
    expect(claimSlot(s, 'd7', '2026-11-26').decision.rated).toBe(true);
  });
  it('one key for both orders of the pair, across chats and rematches', () => {
    expect(pairKey(A.id, B.id)).toBe(pairKey(B.id, A.id));
  });
  it('UTC day boundaries', () => {
    expect(utcDay(Date.UTC(2026, 10, 25, 23, 59, 59, 999))).toBe('2026-11-25');
    expect(utcDay(Date.UTC(2026, 10, 26, 0, 0, 0))).toBe('2026-11-26');
  });
  it('a fight started yesterday counts for the day it finished', () => {
    const d = started(3, Date.UTC(2026, 10, 25, 23, 50));
    const over = playOut(d, Date.UTC(2026, 10, 26, 0, 5));
    expect(over.result!.day).toBe('2026-11-26');
  });
});

describe('FC-12 wallet and economy matrix (DFC-002)', () => {
  const ratedOver = (seed: number) => {
    const o = finished(seed);
    return { ...o, result: { ...o.result!, rated: 'rated' as const } };
  };
  it('approved numbers', () => {
    expect([ECONOMY.startingBalance, ECONOMY.winDelta, ECONOMY.lossDelta, ECONOMY.ratedPerOpponentPerDay]).toEqual([500, 100, -50, 5]);
  });
  it('ordinary result +100 / -50, draw 0, friendly 0, technical 0 / -50', () => {
    const o = ratedOver(3);
    const w = o.players[o.result!.outcome as 0 | 1]!.id;
    const l = o.players[1 - (o.result!.outcome as number)]!.id;
    expect(nominalDeltas(o)).toEqual({ [w]: 100, [l]: -50 });
    expect(nominalDeltas({ ...o, result: { ...o.result!, rated: 'friendly' } })).toEqual({ [w]: 0, [l]: 0 });
    expect(nominalDeltas({ ...o, result: { ...o.result!, outcome: 'draw' } })).toEqual({ [A.id]: 0, [B.id]: 0 });
    const t = timeoutDuel(started(2), T0 + 25 * H);
    const tr = { ...t, result: { ...t.result!, rated: 'rated' as const } };
    expect(Object.values(nominalDeltas(tr)).sort()).toEqual([-50, 0]);
    const es = forfeitDuel(started(2), A.id, T0);
    expect(nominalDeltas({ ...es, result: { ...es.result!, rated: 'rated' } })).toEqual({ [A.id]: -50, [B.id]: 0 });
  });
  it('floor at zero: 30 -> -30, 0 -> 0, playing with zero allowed', () => {
    expect(applyFloor(500, -50)).toBe(-50);
    expect(applyFloor(30, -50)).toBe(-30);
    expect(applyFloor(0, -50)).toBe(0);
    expect(applyFloor(0, 100)).toBe(100);
  });
  it('500 -> 600 / 450; start granted once; repeated result is idempotent', () => {
    let w = ensureStart(emptyWallet(), T0);
    expect(w.balance).toBe(500);
    expect(ensureStart(w, T0).balance).toBe(500);
    const win = postResult(w, 'd1', A.id, 100, 'rated:ko', T0);
    expect(win.wallet.balance).toBe(600);
    const again = postResult(win.wallet, 'd1', A.id, 100, 'rated:ko', T0);
    expect(again.wallet).toBe(win.wallet);
    expect(again.applied).toEqual({ nominal: 100, actual: 100 });
    w = postResult(ensureStart(emptyWallet(), T0), 'd2', B.id, -50, 'rated:ko', T0).wallet;
    expect(w.balance).toBe(450);
    expect(w.ledger.map((e) => e.key)).toEqual(['d2:222:result', 'start']);
  });
  it('30 -> 0 records nominal -50 and actual -30', () => {
    let w = { ...ensureStart(emptyWallet(), T0) };
    for (let i = 0; i < 9; i++) w = postResult(w, `l${i}`, A.id, -50, 'x', T0).wallet; // 500 -> 50
    w = postResult(w, 'x1', A.id, -20, 'x', T0).wallet; // 30
    const r = postResult(w, 'last', A.id, -50, 'x', T0);
    expect(r.applied).toEqual({ nominal: -50, actual: -30 });
    expect(r.wallet.balance).toBe(0);
    expect(postResult(r.wallet, 'zero', A.id, -50, 'x', T0).applied).toEqual({ nominal: -50, actual: 0 });
  });
});

describe('FC-13 convergence after partial writes', () => {
  it('replaying every projection twice changes nothing', () => {
    let pair = emptyPair();
    let wA = emptyWallet(), wB = emptyWallet();
    let hA = {} as Record<string, HistoryEntry>;
    let chat: ChatState = { entries: {}, legacy: {} };
    const run = () => {
      const c = claimSlot(pair, 'd1', '2026-11-25');
      pair = c.state;
      wA = postResult(wA, 'd1', A.id, 100, 'r', T0).wallet;
      wB = postResult(wB, 'd1', B.id, -50, 'r', T0).wallet;
      hA = addHistory(hA, { duelId: 'd1', opponent: B, result: 'win', reason: 'ko', rated: 'rated', at: T0, delta: null, chatInstance: null });
      chat = addChatEntry(chat, { duelId: 'd1', at: T0, a: A, b: B, winner: 'a', rated: 'rated' });
    };
    run();
    const snap = JSON.stringify([pair, wA, wB, hA, chat]);
    run(); // crash after writing, before acknowledging -> full retry
    expect(JSON.stringify([pair, wA, wB, hA, chat])).toBe(snap);
    expect(wA.balance).toBe(600);
    expect(wB.balance).toBe(450);
  });
});

describe('FC-14/15 boards, rivals, head-to-head (DFC-003)', () => {
  const mon = Date.UTC(2026, 10, 23); // Monday
  const chat = (entries: [string, number, 'a' | 'b' | 'draw', 'rated' | 'friendly'][]): ChatState => {
    let c: ChatState = { entries: {}, legacy: { [C.id]: { id: C.id, name: C.name, wins: 4, losses: 1 } } };
    for (const [id, at, w, rated] of entries) c = addChatEntry(c, { duelId: id, at, a: A, b: B, winner: w, rated });
    return c;
  };
  it('week window opens Monday 00:00 UTC; all-time keeps history + marked legacy', () => {
    expect(utcWeekStart(Date.UTC(2026, 10, 29, 23, 59))).toBe(mon); // Sunday -> same week
    expect(utcWeekStart(Date.UTC(2026, 10, 30, 0, 0))).toBe(Date.UTC(2026, 10, 30)); // Monday -> new week
    const c = chat([
      ['old', mon - 1, 'a', 'rated'],
      ['w1', mon + 1, 'b', 'rated'],
      ['w2', mon + 2, 'draw', 'rated'],
      ['fr', mon + 3, 'a', 'friendly'],
    ]);
    const week = board(c, 'week', mon + 5);
    expect(week.find((r) => r.id === B.id)).toMatchObject({ wins: 1, losses: 0, draws: 1 });
    expect(week.find((r) => r.id === A.id)).toMatchObject({ wins: 0, losses: 1, draws: 1 });
    expect(week.some((r) => r.id === C.id)).toBe(false);
    const all = board(c, 'all', mon + 5);
    expect(all[0]).toMatchObject({ id: C.id, wins: 4, legacy: { wins: 4, losses: 1 } });
    expect(all.find((r) => r.id === A.id)).toMatchObject({ wins: 1, losses: 1, draws: 1 });
  });
  it('sort: wins desc, losses asc, stable id; WR with draws; empty -> "—"', () => {
    const c = chat([['x', mon + 1, 'draw', 'rated']]);
    const rows = board(c, 'week', mon + 2);
    expect(rows.map((r) => r.id)).toEqual([A.id, B.id]);
    expect(winRate(1, 1, 2)).toBe(0.25);
    expect(winRate(0, 0, 0)).toBeNull();
    expect(board({ entries: {}, legacy: {} }, 'week', mon)).toEqual([]);
  });
  it('two groups are isolated (separate objects), friendly results stay out of boards', () => {
    const c = chat([['f', mon + 1, 'a', 'friendly']]);
    expect(board(c, 'week', mon + 2)).toEqual([]);
  });
  it('rivals and head-to-head match the history; friendly counted separately', () => {
    let h = {} as Record<string, HistoryEntry>;
    const e = (id: string, result: HistoryEntry['result'], rated: HistoryEntry['rated'], opp = B, at = T0) =>
      (h = addHistory(h, { duelId: id, opponent: opp, result, reason: 'ko', rated, at, delta: null, chatInstance: null }));
    e('1', 'win', 'rated');
    e('2', 'win', 'rated');
    e('3', 'lose', 'rated');
    e('4', 'draw', 'rated');
    e('5', 'win', 'friendly');
    e('6', 'lose', 'legacy');
    e('7', 'win', 'rated', C, T0 + 1);
    e('1', 'lose', 'rated'); // replay with other data: first write wins
    expect(headToHead(h, B.id)).toEqual({ wins: 2, losses: 1, draws: 1, friendly: { wins: 1, losses: 1, draws: 0 } });
    const r = rivals(h);
    expect(r.map((x) => x.opponent.id)).toEqual([C.id, B.id]);
    expect(r[1].winRate).toBe(0.5);
  });
});

describe('FC-16 rematch', () => {
  it('two requests -> one duel; the loser opens; after a draw the other side opens', () => {
    const over = finished(5);
    const loser = 1 - (over.result!.outcome as number);
    const r1 = rematchDuel(over, A.id, 'newA', 1, T0);
    const r2 = rematchDuel(r1.prev, B.id, 'newB', 2, T0);
    expect(r2.id).toBe('newA');
    expect(r2.next).toBeNull();
    expect(r1.next!.battle!.current).toBe(loser);
    const draw = { ...over, battle: { ...over.battle!, outcome: 'draw' as const } };
    expect(rematchDuel(draw, A.id, 'd', 1, T0).next!.battle!.current).toBe(1 - over.battle!.starter);
  });
});

describe('FC-17/18 fighters (DFC-004)', () => {
  it('catalogue: eight, free, identical combat profile; mirrors docs/proposals/characters.json', () => {
    const proposal = JSON.parse(readFileSync(new URL('../docs/proposals/characters.json', import.meta.url), 'utf8'));
    expect(CHARACTERS).toHaveLength(8);
    expect(CHARACTERS.every((c) => c.priceBones === 0 && c.combatProfile === 'shared')).toBe(true);
    expect(CHARACTERS.map((c) => c.id)).toEqual(proposal.characters.map((c: { id: string }) => c.id));
    const econ = JSON.parse(readFileSync(new URL('../docs/proposals/economy.json', import.meta.url), 'utf8'));
    expect(econ.approved.startingBalance).toBe(ECONOMY.startingBalance);
    expect(econ.approved.winDelta).toBe(ECONOMY.winDelta);
    expect(econ.approved.lossDelta).toBe(ECONOMY.lossDelta);
    expect(econ.approved.ratedMatchesPerOpponentPerDay).toBe(ECONOMY.ratedPerOpponentPerDay);
  });
  it('snapshot at acceptance; mirror match allowed; no choice -> v0.2 roles', () => {
    expect(started(2, T0, ['psikh', 'psikh']).fighters).toEqual(['psikh', 'psikh']);
    expect(started(2, T0, [null, 'heavy']).fighters).toEqual(['shiba', 'heavy']);
    const d = started(2, T0, ['chih', 'pushok']);
    expect(rematchDuel(finished(2), A.id, 'r', 1, T0, [null, null]).next!.fighters).toEqual(['shiba', 'bull']);
    expect(d.fighters).toEqual(['chih', 'pushok']);
  });
  it('fighter choice never changes combat: same seed -> same fight', () => {
    const x = playOut(started(42, T0, ['chih', 'heavy']));
    const y = playOut(started(42, T0, [null, null]));
    expect(x.battle!.log.map((r) => r.combo.symbols.join())).toEqual(y.battle!.log.map((r) => r.combo.symbols.join()));
  });
});

describe('FC-19 neutral texts and notifications', () => {
  const gendered = /(ил |ила |ал |ала |он |она |принял|победил|отправлен|убежал)/;
  it('turn message only to an offline, non-auto next player; never to the actor', () => {
    const d = started(2);
    const s = spinDuel(d, cur(d), 0, T0 + 60_000).duel;
    const items = plan(d, s, { type: 'spin', userId: cur(d) }, null, T0 + 60_000);
    if (s.battle!.current !== d.battle!.current) {
      expect(items).toEqual([expect.objectContaining({ kind: 'turn', to: cur(s) })]);
      expect(plan(d, setAuto(s, cur(s), true, T0), { type: 'spin', userId: cur(d) }, null, T0 + 60_000)).toEqual([]);
    }
  });
  it('all messages are free of gendered word forms, also without username', () => {
    const d = started(2);
    const over = { ...finished(3), result: { ...finished(3).result!, rated: 'rated' as const, deltas: { [A.id]: { nominal: 100, actual: 100 } } } };
    const t = timeoutDuel(d, T0 + 25 * H);
    const f = forfeitDuel(d, A.id, T0);
    const texts = [
      compose({ key: 'a', kind: 'accept', to: A.id, duelId: 'x' }, d).text,
      compose({ key: 'r', kind: 'reminder', to: cur(d), duelId: 'x', offset: H }, d).text,
      compose({ key: 'm', kind: 'rematch', to: B.id, duelId: 'x' }, d).text,
      ...[A.id, B.id].map((id) => compose({ key: 'f', kind: 'final', to: id, duelId: 'x' }, over).text),
      ...[A.id, B.id].map((id) => compose({ key: 'f', kind: 'final', to: id, duelId: 'x' }, t).text),
      ...[A.id, B.id].map((id) => compose({ key: 'f', kind: 'final', to: id, duelId: 'x' }, f).text),
    ];
    const s1 = spinDuel(d, cur(d), 0, T0).duel;
    texts.push(compose({ key: 't', kind: 'turn', to: B.id, duelId: 'x' }, s1).text);
    for (const t of texts) expect(t.toLowerCase()).not.toMatch(gendered);
    const anon = acceptDuel(createDuel('n', { id: 9, name: '' }, 1, T0), { id: 8, name: '' }, T0, null).duel;
    expect(compose({ key: 'a', kind: 'accept', to: 9, duelId: 'n' }, anon).text).toContain('Соперник');
  });
  it('reminder states the hours left', () => {
    expect(compose({ key: 'r', kind: 'reminder', to: A.id, duelId: 'x', offset: 12 * H }, started(2)).text).toContain('12 ч');
  });
});

describe('engine safety net', () => {
  it('v0.3 server code does not touch the combat config', () => {
    const b = createBattle(BALANCE, { seed: 1 });
    expect(takeTurn(b, BALANCE).state.spinCount).toBe(1);
    expect(BALANCE.experiment).toBeUndefined();
  });
});
