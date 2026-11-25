/**
 * FC-04 / QA-02: start-shield (Q02) x shield-hold (Q04) experiment.
 * Uses simulator-only knobs (Balance.experiment); docs/balance.json is NOT modified.
 *
 *   npx tsx scripts/experiments/shield.ts [fights=10000] [seedA=11] [seedB=22] > out.json
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { BALANCE } from '../../src/engine/balance';
import { simulate } from '../../src/engine/simulate';
import type { Balance } from '../../src/engine/types';

const fights = Number(process.argv[2] ?? 10000);
const seeds = [Number(process.argv[3] ?? 11), Number(process.argv[4] ?? 22)];
const shields = [0, 10, 15, 20];
const rules: ('v0.2' | 'hold')[] = ['v0.2', 'hold'];

const sha = (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();
const configHash = createHash('sha256').update(readFileSync(new URL('../../docs/balance.json', import.meta.url))).digest('hex');

/** Wilson 95% interval for a proportion. */
function wilson(k: number, n: number) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

const cells = [];
for (const rule of rules)
  for (const s0 of shields)
    for (const seed of seeds) {
      const b: Balance = { ...BALANCE, experiment: { secondStartShield: s0, shieldHold: rule === 'hold' } };
      const r = simulate(b, { fights, seed, alternateStarter: true });
      const [lo, hi] = wilson(r.starterWins, r.decisive);
      const allStarter = r.starterWins / r.fights;
      cells.push({
        rule, startShield: s0, seed, fights,
        starterWinRate: r.starterWinRate, starterCI95: [lo, hi], starterWinsOfAll: allStarter,
        p1: r.winRate[0], p2: r.winRate[1], draws: r.drawRate,
        endReasons: r.endReasons, fightsAtMaxSpins: r.fightsAtMaxSpins,
        len: { mean: r.spinsPerFight.mean, median: r.spinsPerFight.median, p10: r.spinsPerFight.p10, p90: r.spinsPerFight.p90, min: r.spinsPerFight.min, max: r.spinsPerFight.max },
        spinsPerFighter: r.meanSpinsPerFighter,
        dmgPerSpin: r.effects.meanDamagePerSpin,
        absorbedShare: r.effects.totalAbsorbed / Math.max(1, r.effects.totalAbsorbed + r.effects.totalDamageDealt),
        overhealShare: r.effects.totalOverheal / Math.max(1, r.effects.totalHealed + r.effects.totalOverheal),
        anyTriple: r.anyTripleRate,
        winnerHp: r.meanWinnerHp, comeback: r.comebackRate,
        command: `npx tsx scripts/experiments/shield.ts ${fights} ${seeds[0]} ${seeds[1]}`,
      });
    }
console.log(JSON.stringify({ sha, configHash, engine: 'src/engine @ ' + sha.slice(0, 7), fights, seeds, cells }, null, 1));
