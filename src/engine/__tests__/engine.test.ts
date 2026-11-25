import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  BattleOverError,
  BattleSession,
  createBattle,
  createRematch,
  parseBalance,
  pickSymbol,
  resolveCombo,
  simulate,
  spinReels,
  takeTurn,
  SYMBOL_IDS,
  type Balance,
  type BattleState,
  type SymbolId,
} from '..';
import raw from '../../../docs/balance.json';

/**
 * v0.2 combat fixture: the mechanics tests below were written for the original rules
 * (nobody starts with a shield). DEC-04's start shield has its own tests at the end.
 */
const B: Balance = { ...BALANCE, rules: { ...BALANCE.rules, secondStartShield: 0 } };
const fresh = (starter: 0 | 1 = 0) => createBattle(B, { seed: 42, starter });
const turn = (s: BattleState, forced: SymbolId[], b: Balance = B) => takeTurn(s, b, { forced });
const withHp = (s: BattleState, a: number, b: number): BattleState => ({
  ...s,
  fighters: [
    { ...s.fighters[0], hp: a },
    { ...s.fighters[1], hp: b },
  ],
});

describe('balance.json', () => {
  it('is the source of parameters and is valid', () => {
    expect(B.hp).toBe(raw.hp);
    expect(B.symbols.punch.damage).toBe(raw.symbols.punch.damage);
    expect(B.triples.critical.damage).toBe(raw.triples.critical.damage);
    expect(B.rules.maxSpins).toBe(40);
    expect(BALANCE.rules.secondStartShield).toBe(raw.rules.secondStartShield);
  });
  it('rejects broken data', () => {
    expect(() => parseBalance({ ...raw, hp: -1 })).toThrow();
    expect(() => parseBalance({ ...raw, symbols: { ...raw.symbols, punch: { weight: -5 } } })).toThrow();
    expect(() => parseBalance({ ...raw, reels: 5 })).toThrow();
  });
  it('fills default rules when absent', () => {
    const { rules: _r, ...noRules } = raw;
    expect(parseBalance(noRules).rules).toEqual({ maxSpins: 40, maxExtraTurnsInRow: 2, maxExtraPerMixedSpin: 1, secondStartShield: 0 });
  });
});

describe('weighted reels', () => {
  it('maps uniform numbers to weights', () => {
    expect(pickSymbol(0, B)).toBe('punch'); // [0,40)
    expect(pickSymbol(0.399, B)).toBe('punch');
    expect(pickSymbol(0.4, B)).toBe('critical'); // [40,55)
    expect(pickSymbol(0.55, B)).toBe('block');
    expect(pickSymbol(0.7, B)).toBe('heal');
    expect(pickSymbol(0.85, B)).toBe('extra');
    expect(pickSymbol(0.9, B)).toBe('miss');
    expect(pickSymbol(0.99999999, B)).toBe('miss');
  });
  it('is deterministic for a seed and matches weights statistically', () => {
    expect(spinReels(123, B)).toEqual(spinReels(123, B));
    let s = 7;
    const counts: Record<string, number> = {};
    const N = 60000;
    for (let i = 0; i < N / 3; i++) {
      const r = spinReels(s, B);
      s = r.rngState;
      for (const x of r.symbols) counts[x] = (counts[x] ?? 0) + 1;
    }
    for (const id of SYMBOL_IDS) expect(counts[id] / N).toBeCloseTo(B.symbols[id].weight / 100, 1);
  });
});

describe('triples replace normal effects', () => {
  const cases: [SymbolId, Partial<Record<string, number>>][] = [
    ['punch', { damage: 40 }],
    ['critical', { damage: 75 }],
    ['block', { shield: 100 }],
    ['heal', { heal: 50 }],
    ['extra', { extra: 2 }],
    ['miss', { selfDamage: 30 }],
  ];
  for (const [id, exp] of cases) {
    it(`triple ${id}`, () => {
      const c = resolveCombo([id, id, id], B);
      expect(c.triple).toBe(id);
      expect(c.effect).toEqual({ damage: 0, shield: 0, heal: 0, extra: 0, selfDamage: 0, ...exp });
    });
  }
  it('triple punch deals exactly 40 (not 30 + 40)', () => {
    const { state, record } = turn(fresh(), ['punch', 'punch', 'punch']);
    expect(record.damageDealt).toBe(40);
    expect(state.fighters[1].hp).toBe(60);
  });
  it('triple crit deals 75', () => {
    expect(turn(fresh(), ['critical', 'critical', 'critical']).state.fighters[1].hp).toBe(25);
  });
  it('triple miss hurts the spinner by 30', () => {
    const { state, record } = turn(fresh(), ['miss', 'miss', 'miss']);
    expect(state.fighters[0].hp).toBe(70);
    expect(state.fighters[1].hp).toBe(100);
    expect(record.selfDamage).toBe(30);
  });
  it('triple heal heals 50 capped at max', () => {
    const s = withHp(fresh(), 20, 100);
    expect(turn(s, ['heal', 'heal', 'heal']).state.fighters[0].hp).toBe(70);
    const s2 = withHp(fresh(), 80, 100);
    const r = turn(s2, ['heal', 'heal', 'heal']);
    expect(r.state.fighters[0].hp).toBe(100);
    expect(r.record.healed).toBe(20);
    expect(r.record.overheal).toBe(30);
  });
});

describe('mixed combinations sum effects', () => {
  it('punch + crit + heal', () => {
    const s = withHp(fresh(), 50, 100);
    const { state, record } = turn(s, ['punch', 'critical', 'heal']);
    expect(record.damageDealt).toBe(30);
    expect(state.fighters[1].hp).toBe(70);
    expect(state.fighters[0].hp).toBe(60);
  });
  it('punch + punch + block gives 20 damage and 10 shield', () => {
    const { state } = turn(fresh(), ['punch', 'punch', 'block']);
    expect(state.fighters[1].hp).toBe(80);
    expect(state.fighters[0].shield).toBe(10);
  });
  it('block + block + heal stacks shield to 20', () => {
    expect(turn(fresh(), ['block', 'block', 'heal']).state.fighters[0].shield).toBe(20);
  });
  it('two misses + punch = 10 damage, no self-damage', () => {
    const { state, record } = turn(fresh(), ['miss', 'miss', 'punch']);
    expect(state.fighters[1].hp).toBe(90);
    expect(record.selfDamage).toBe(0);
  });
  it('heal is capped at 100 HP', () => {
    const s = withHp(fresh(), 95, 100);
    const { state, record } = turn(s, ['heal', 'heal', 'punch']);
    expect(state.fighters[0].hp).toBe(100);
    expect(record.healed).toBe(5);
    expect(record.overheal).toBe(15);
  });
  it('all 6^3 combinations resolve without NaN and respect caps', () => {
    for (const a of SYMBOL_IDS)
      for (const b of SYMBOL_IDS)
        for (const c of SYMBOL_IDS) {
          const s = withHp(fresh(), 60, 60);
          const { state } = turn(s, [a, b, c]);
          for (const f of state.fighters) {
            expect(Number.isFinite(f.hp)).toBe(true);
            expect(f.hp).toBeGreaterThanOrEqual(0);
            expect(f.hp).toBeLessThanOrEqual(100);
          }
        }
  });
});

describe('shield', () => {
  it('absorbs the next incoming hit and disappears', () => {
    let s = turn(fresh(), ['block', 'heal', 'miss']).state; // P0 shield 10
    expect(s.fighters[0].shield).toBe(10);
    const r = turn(s, ['punch', 'punch', 'critical']); // P1 hits 40
    expect(r.record.absorbed).toBe(10);
    expect(r.record.damageDealt).toBe(30);
    expect(r.record.shieldBroken).toBe(true);
    expect(r.state.fighters[0].hp).toBe(70);
    expect(r.state.fighters[0].shield).toBe(0);
  });
  it('does not stack across hits: second hit is unblocked', () => {
    let s = turn(fresh(), ['block', 'block', 'block']).state; // shield 100
    s = withHp(s, 100, 100);
    // force P1 to get an extra turn and hit twice
    const r1 = turn(s, ['punch', 'extra', 'punch']);
    expect(r1.record.absorbed).toBe(20);
    expect(r1.state.fighters[0].hp).toBe(100);
    expect(r1.state.current).toBe(1);
    const r2 = turn(r1.state, ['punch', 'punch', 'punch']);
    expect(r2.record.absorbed).toBe(0);
    expect(r2.state.fighters[0].hp).toBe(60);
  });
  it('a non-damaging opponent spin does not consume the shield', () => {
    let s = turn(fresh(), ['block', 'miss', 'miss']).state;
    const r = turn(s, ['heal', 'miss', 'block']);
    expect(r.state.fighters[0].shield).toBe(10);
  });
  it('expires before the owner’s next turn if unused', () => {
    let s = turn(fresh(), ['block', 'miss', 'miss']).state; // P0 shield
    s = turn(s, ['heal', 'heal', 'miss']).state; // P1 no damage
    const r = turn(s, ['miss', 'miss', 'punch']); // P0 turn
    expect(r.record.shieldExpired).toBe(10);
    expect(r.state.fighters[0].shield).toBe(0);
  });
  it('triple block fully absorbs triple crit', () => {
    let s = turn(fresh(), ['block', 'block', 'block']).state;
    const r = turn(s, ['critical', 'critical', 'critical']);
    expect(r.record.absorbed).toBe(75);
    expect(r.state.fighters[0].hp).toBe(100);
  });
  it('self-damage ignores shields', () => {
    let s = turn(fresh(), ['miss', 'heal', 'heal']).state; // P0
    s = turn(s, ['block', 'block', 'block']).state; // P1 shield
    s = turn(s, ['heal', 'miss', 'miss']).state; // P0
    const r = turn(s, ['miss', 'miss', 'miss']); // P1 self dmg, own shield already expired
    expect(r.state.fighters[1].hp).toBe(70);
  });
});

describe('extra turns', () => {
  it('single lightning gives one extra turn', () => {
    const r = turn(fresh(), ['extra', 'punch', 'punch']);
    expect(r.record.extraGranted).toBe(1);
    expect(r.state.current).toBe(0);
    expect(r.state.currentIsExtra).toBe(true);
    const r2 = turn(r.state, ['punch', 'punch', 'punch']);
    expect(r2.record.isExtraTurn).toBe(true);
    expect(r2.state.current).toBe(1);
  });
  it('two lightnings in a mixed spin still give only one', () => {
    const r = turn(fresh(), ['extra', 'extra', 'punch']);
    expect(r.record.extraGranted).toBe(1);
    expect(r.record.extraWasted).toBe(1);
  });
  it('triple lightning gives two extra turns', () => {
    let { state, record } = turn(fresh(), ['extra', 'extra', 'extra']);
    expect(record.extraGranted).toBe(2);
    expect(state.current).toBe(0);
    state = turn(state, ['punch', 'miss', 'miss']).state;
    expect(state.current).toBe(0);
    state = turn(state, ['punch', 'miss', 'miss']).state;
    expect(state.current).toBe(1);
  });
  it('never more than two extra turns in a row', () => {
    let s = fresh();
    let spinsByP0 = 0;
    for (let i = 0; i < 6 && s.current === 0; i++) {
      s = turn(s, ['extra', 'extra', 'extra']).state;
      spinsByP0++;
    }
    expect(spinsByP0).toBe(3); // 1 normal + 2 extra
    expect(s.current).toBe(1);
  });
  it('chain cap is reset when the turn passes', () => {
    let s = turn(fresh(), ['extra', 'extra', 'extra']).state;
    s = turn(s, ['extra', 'punch', 'punch']).state;
    s = turn(s, ['extra', 'punch', 'punch']).state; // cap reached -> pass
    expect(s.current).toBe(1);
    const r = turn(s, ['extra', 'punch', 'punch']);
    expect(r.record.extraGranted).toBe(1);
    expect(r.state.current).toBe(1);
  });
});

describe('end of battle', () => {
  it('KO ends the battle with a winner', () => {
    const s = withHp(fresh(), 100, 30);
    const r = turn(s, ['punch', 'punch', 'punch']);
    expect(r.state.status).toBe('over');
    expect(r.state.outcome).toBe(0);
    expect(r.state.endReason).toBe('ko');
    expect(r.state.fighters[1].hp).toBe(0);
  });
  it('self-KO by triple miss gives the win to the opponent', () => {
    const s = withHp(fresh(), 30, 100);
    const r = turn(s, ['miss', 'miss', 'miss']);
    expect(r.state.outcome).toBe(1);
  });
  it('double KO is a draw (damage and self-damage are simultaneous)', () => {
    // custom balance: a symbol that both hits and hurts the spinner
    const b = parseBalance({ ...raw, triples: { ...raw.triples, miss: { damage: 50, selfDamage: 50 } } });
    const s = withHp(createBattle(b, { seed: 1 }), 40, 40);
    const r = takeTurn(s, b, { forced: ['miss', 'miss', 'miss'] });
    expect(r.state.outcome).toBe('draw');
    expect(r.state.endReason).toBe('doubleKo');
  });
  it('spin limit: winner on HP', () => {
    let s: BattleState = { ...withHp(fresh(), 50, 60), spinCount: 39 };
    const r = turn(s, ['heal', 'miss', 'miss']); // P0 heals to 60 -> 60:60
    expect(r.state.status).toBe('over');
    expect(r.state.endReason).toBe('spinLimit');
    expect(r.state.outcome).toBe('draw');
    s = { ...withHp(fresh(), 50, 60), spinCount: 39 };
    expect(turn(s, ['miss', 'miss', 'heal']).state.outcome).toBe('draw');
    expect(turn(s, ['block', 'miss', 'miss']).state.outcome).toBe(1); // 50 vs 60
    expect(turn(s, ['heal', 'heal', 'miss']).state.outcome).toBe(0); // 70 vs 60
    expect(turn(s, ['punch', 'punch', 'miss']).state.outcome).toBe(0); // 50 vs 40
  });
  it('hard stop at 40 spins even with extra turns', () => {
    let s: BattleState = { ...fresh(), spinCount: 39 };
    const r = turn(s, ['extra', 'extra', 'extra']);
    expect(r.state.status).toBe('over');
    expect(r.record.extraGranted).toBe(0);
  });
  it('no turns after the end', () => {
    const s = withHp(fresh(), 100, 10);
    const r = turn(s, ['punch', 'miss', 'miss']);
    expect(() => turn(r.state, ['punch', 'punch', 'punch'])).toThrow(BattleOverError);
  });
  it('random battles always terminate within 40 spins', () => {
    for (let seed = 0; seed < 500; seed++) {
      let s = createBattle(B, { seed });
      while (s.status === 'playing') s = takeTurn(s, B).state;
      expect(s.spinCount).toBeLessThanOrEqual(40);
      expect(s.log.length).toBe(s.spinCount);
    }
  });
});

describe('determinism & rematch', () => {
  it('same seed -> same fight', () => {
    const run = (seed: number) => {
      let s = createBattle(B, { seed });
      while (s.status === 'playing') s = takeTurn(s, B).state;
      return s.log.map((r) => r.combo.symbols.join());
    };
    expect(run(2024)).toEqual(run(2024));
    expect(run(2024)).not.toEqual(run(2025));
  });
  it('rematch resets HP/shields/log and swaps the starter', () => {
    let s = withHp(fresh(0), 100, 10);
    s = turn(s, ['block', 'heal', 'miss']).state;
    s = turn(s, ['punch', 'miss', 'miss']).state;
    const r = createRematch(s, B, 99);
    expect(r.fighters).toEqual([
      { hp: 100, shield: 0 },
      { hp: 100, shield: 0 },
    ]);
    expect(r.log).toEqual([]);
    expect(r.spinCount).toBe(0);
    expect(r.status).toBe('playing');
    expect(r.starter).toBe(1);
    expect(r.current).toBe(1);
    expect(r.seed).toBe(99);
  });
  it('takeTurn does not mutate the input state', () => {
    const s = fresh();
    const snapshot = JSON.stringify(s);
    turn(s, ['critical', 'critical', 'critical']);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('BattleSession input lock', () => {
  it('rejects a second click while animating', () => {
    const ses = new BattleSession(B, 'local', 5);
    expect(ses.trySpin()).not.toBeNull();
    expect(ses.trySpin()).toBeNull();
    expect(ses.trySpin()).toBeNull();
    expect(ses.state.spinCount).toBe(1);
    expect(ses.rejectedClicks).toBe(2);
    ses.finishAnimation();
    expect(ses.trySpin()).not.toBeNull();
    expect(ses.state.spinCount).toBe(2);
  });
  it('human cannot spin on the bot’s turn, bot cannot spin on human’s', () => {
    const ses = new BattleSession(B, 'bot', 5);
    ses.forcedNext = ['punch', 'punch', 'miss'];
    expect(ses.trySpin('bot')).toBeNull();
    expect(ses.trySpin('human')).not.toBeNull();
    ses.finishAnimation();
    expect(ses.isBotTurn()).toBe(true);
    expect(ses.trySpin('human')).toBeNull();
    expect(ses.trySpin('bot')).not.toBeNull();
  });
  it('forced combo applies once', () => {
    const ses = new BattleSession(B, 'local', 5);
    ses.forcedNext = ['critical', 'critical', 'critical'];
    const r = ses.trySpin()!;
    expect(r.forced).toBe(true);
    expect(r.damageDealt).toBe(75);
    expect(ses.forcedNext).toBeNull();
  });
  it('rematch from session', () => {
    const ses = new BattleSession(B, 'bot', 5);
    ses.forcedNext = ['critical', 'critical', 'critical'];
    ses.trySpin();
    ses.finishAnimation();
    ses.rematch(77);
    expect(ses.phase).toBe('idle');
    expect(ses.state.fighters[1].hp).toBe(100);
    expect(ses.state.starter).toBe(1);
  });
});

describe('simulation', () => {
  it('10 000 fights produce a consistent report', () => {
    const r = simulate(B, { fights: 10000, seed: 1 });
    expect(r.wins[0] + r.wins[1] + r.draws).toBe(10000);
    expect(r.endReasons.ko + r.endReasons.doubleKo + r.endReasons.spinLimit).toBe(10000);
    expect(r.spinsPerFight.max).toBeLessThanOrEqual(40);
    expect(r.spinsPerFight.histogram.reduce((a, b) => a + b, 0)).toBe(10000);
    const freqSum = Object.values(r.symbolFrequency).reduce((a, b) => a + b, 0);
    expect(freqSum).toBeCloseTo(1, 6);
    expect(r.symbolFrequency.punch).toBeCloseTo(0.4, 1);
    // P(triple) = sum w^3 = .064+.003375*3+.000125+.001 ≈ 0.0753
    expect(r.anyTripleRate).toBeCloseTo(0.0753, 1);
    expect(simulate(B, { fights: 500, seed: 9 }).wins).toEqual(simulate(B, { fights: 500, seed: 9 }).wins);
  });
});

describe('FC-04 simulator-only experiment knobs (production default = v0.2)', () => {
  const hold: Balance = { ...B, experiment: { shieldHold: true } };
  it('balance.json never enables experiments', () => {
    expect(B.experiment).toBeUndefined();
    expect(parseBalance({ ...raw, experiment: { shieldHold: true } }).experiment).toBeUndefined();
  });
  it('start shield goes to the non-starter only', () => {
    const b: Balance = { ...B, experiment: { secondStartShield: 15 } };
    expect(createBattle(b, { seed: 1, starter: 0 }).fighters.map((f) => f.shield)).toEqual([0, 15]);
    expect(createBattle(b, { seed: 1, starter: 1 }).fighters.map((f) => f.shield)).toEqual([15, 0]);
  });
  it('v0.2: own shield burns before own extra turn', () => {
    const r = turn(fresh(), ['block', 'extra', 'miss']);
    expect(r.state.current).toBe(0);
    const r2 = turn(r.state, ['miss', 'miss', 'heal']);
    expect(r2.record.shieldExpired).toBe(10);
    expect(r2.state.fighters[0].shield).toBe(0);
  });
  it('hold: shield survives own extra turn and a zero-damage enemy spin', () => {
    let s = turn(fresh(), ['block', 'extra', 'miss'], hold).state;
    s = turn(s, ['miss', 'miss', 'heal'], hold).state; // own extra turn, no new shield
    expect(s.fighters[0].shield).toBe(10);
    s = turn(s, ['heal', 'miss', 'miss'], hold).state; // enemy deals 0
    expect(s.fighters[0].shield).toBe(10);
    s = turn(s, ['miss', 'heal', 'miss'], hold).state; // own spin without shield keeps it
    expect(s.fighters[0].shield).toBe(10);
    const r = turn(s, ['critical', 'miss', 'miss'], hold); // positive hit consumes it whole
    expect(r.record.absorbed).toBe(10);
    expect(r.state.fighters[0].shield).toBe(0);
  });
  it('hold: a new shield replaces (never stacks); self-damage ignores it', () => {
    let s = turn(fresh(), ['block', 'block', 'extra'], hold).state; // 20 + extra turn
    expect(s.fighters[0].shield).toBe(20);
    s = turn(s, ['block', 'miss', 'miss'], hold).state; // replaced by 10, not 30
    expect(s.fighters[0].shield).toBe(10);
    s = turn(s, ['heal', 'heal', 'heal'], hold).state; // P1
    const r = turn(s, ['miss', 'miss', 'miss'], hold); // P0 self-damage 30
    expect(r.state.fighters[0].hp).toBe(70);
    expect(r.state.fighters[0].shield).toBe(10);
  });
});

describe('DEC-04 start shield 10 for the second fighter (docs/balance.json)', () => {
  it('is read from balance.json and validated', () => {
    expect(BALANCE.rules.secondStartShield).toBe(10);
    expect(() => parseBalance({ ...raw, rules: { ...raw.rules, secondStartShield: -1 } })).toThrow();
    expect(() => parseBalance({ ...raw, rules: { ...raw.rules, secondStartShield: 2.5 } })).toThrow();
  });
  it('the fighter who spins second starts with shield 10; the starter with none', () => {
    expect(createBattle(BALANCE, { seed: 1, starter: 0 }).fighters.map((f) => f.shield)).toEqual([0, 10]);
    expect(createBattle(BALANCE, { seed: 1, starter: 1 }).fighters.map((f) => f.shield)).toEqual([10, 0]);
  });
  it('absorbs the first positive hit and is gone; v0.2 burning rule still applies on own turn', () => {
    const s = createBattle(BALANCE, { seed: 1, starter: 0 });
    const r = takeTurn(s, BALANCE, { forced: ['punch', 'punch', 'miss'] });
    expect(r.record.absorbed).toBe(10);
    expect(r.state.fighters[1]).toEqual({ hp: 90, shield: 0 });
    const z = takeTurn(s, BALANCE, { forced: ['heal', 'miss', 'miss'] }); // no damage -> shield kept
    expect(z.state.fighters[1].shield).toBe(10);
    const own = takeTurn(z.state, BALANCE, { forced: ['miss', 'miss', 'heal'] }); // P1's own turn
    expect(own.record.shieldExpired).toBe(10);
  });
  it('rematch moves the start shield to the new second fighter', () => {
    const s = createBattle(BALANCE, { seed: 1, starter: 0 });
    expect(createRematch(s, BALANCE, 2).fighters.map((f) => f.shield)).toEqual([10, 0]);
  });
});
