/**
 * DEC-04: v0.2 rules (secondStartShield 0) vs the working docs/balance.json, same seeds.
 *   npx tsx scripts/experiments/compare-config.ts 10000 1 2 11 22 > out.json
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { BALANCE } from '../../src/engine/balance';
import { simulate } from '../../src/engine/simulate';
import type { Balance } from '../../src/engine/types';

const fights = Number(process.argv[2] ?? 10000);
const seeds = process.argv.slice(3).map(Number);
const sha = execSync('git rev-parse HEAD').toString().trim();
const configHash = createHash('sha256').update(readFileSync(new URL('../../docs/balance.json', import.meta.url))).digest('hex');
const before: Balance = { ...BALANCE, rules: { ...BALANCE.rules, secondStartShield: 0 } };
const wilson = (k: number, n: number) => {
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
};
const rows = [];
for (const [label, b] of [['v0.2 (щит 0)', before], ['balance.json (щит ' + BALANCE.rules.secondStartShield + ')', BALANCE]] as const)
  for (const seed of seeds.length ? seeds : [1, 2]) {
    const r = simulate(b, { fights, seed });
    rows.push({
      label, seed, starter: r.starterWinRate, ci: wilson(r.starterWins, r.decisive), p1: r.winRate[0], p2: r.winRate[1], draws: r.drawRate,
      mean: r.spinsPerFight.mean, median: r.spinsPerFight.median, p10: r.spinsPerFight.p10, p90: r.spinsPerFight.p90, max: r.spinsPerFight.max,
      at40: r.fightsAtMaxSpins, limit: r.endReasons.spinLimit, comeback: r.comebackRate, winnerHp: r.meanWinnerHp,
      absorbed: r.effects.totalAbsorbed / (r.effects.totalAbsorbed + r.effects.totalDamageDealt),
    });
  }
console.log(JSON.stringify({ sha, configHash, fights, command: `npx tsx scripts/experiments/compare-config.ts ${fights} ${seeds.join(' ')}`, rows }, null, 1));
