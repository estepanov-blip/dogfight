/**
 * FC-03 baseline: raw data around the 40-spin limit for the v0.2 engine.
 * npx tsx scripts/audit/v02-baseline.ts 10000 1 2
 */
import { BALANCE } from '../../src/engine/balance';
import { createBattle, takeTurn } from '../../src/engine/battle';
import { simulate } from '../../src/engine/simulate';
import { normalizeSeed } from '../../src/engine/rng';

const fights = Number(process.argv[2] ?? 10000);
const seeds = process.argv.slice(3).map(Number);
for (const seed of seeds.length ? seeds : [1, 2]) {
  const r = simulate(BALANCE, { fights, seed });
  // replay the exact same per-fight seeds to inspect fights that reached 39/40 spins
  let s = normalizeSeed(seed);
  const at = { len39: 0, len40: 0, koOn40: 0, limitOn40: 0 };
  for (let i = 0; i < fights; i++) {
    s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) + 0x9e3779b9) >>> 0;
    let st = createBattle(BALANCE, { seed: s, starter: (i % 2) as 0 | 1 });
    while (st.status === 'playing') st = takeTurn(st, BALANCE, { skipLog: true }).state;
    if (st.spinCount === 39) at.len39++;
    if (st.spinCount === 40) {
      at.len40++;
      if (st.endReason === 'spinLimit') at.limitOn40++;
      else at.koOn40++;
    }
  }
  console.log(JSON.stringify({ seed, fights, max: r.spinsPerFight.max, endReasons: r.endReasons, histogram39: r.spinsPerFight.histogram[39], histogram40: r.spinsPerFight.histogram[40], ...at, starterWinRate: +r.starterWinRate.toFixed(4) }));
}
