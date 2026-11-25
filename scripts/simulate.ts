/**
 * CLI: npm run simulate -- [fights] [seed]
 * Runs headless fights with the real engine and prints the report as JSON.
 */
import { BALANCE } from '../src/engine/balance';
import { simulate } from '../src/engine/simulate';

const fights = Number(process.argv[2] ?? 10000);
const seed = Number(process.argv[3] ?? 1);
const r = simulate(BALANCE, { fights, seed });
const pct = (v: number) => (v * 100).toFixed(1) + '%';
console.log(`Fights: ${r.fights}  seed: ${r.seed}  time: ${r.elapsedMs.toFixed(0)} ms`);
console.log(`Win P1/P2/draw: ${pct(r.winRate[0])} / ${pct(r.winRate[1])} / ${pct(r.drawRate)}   starter wins: ${pct(r.starterWinRate)}`);
console.log(`End: KO ${r.endReasons.ko}, double KO ${r.endReasons.doubleKo}, spin limit ${r.endReasons.spinLimit}`);
const d = r.spinsPerFight;
console.log(`Spins/fight: mean ${d.mean.toFixed(2)} median ${d.median} p10 ${d.p10} p90 ${d.p90} min ${d.min} max ${d.max}`);
console.log('Triples:', Object.fromEntries(Object.entries(r.tripleFrequency).map(([k, v]) => [k, pct(v)])), 'any', pct(r.anyTripleRate));
console.log('Effects:', JSON.stringify(r.effects, (_k, v) => (typeof v === 'number' && v < 1 && v > 0 ? +v.toFixed(4) : v)));
console.log(`Winner HP avg ${r.meanWinnerHp.toFixed(1)}  comeback ${pct(r.comebackRate)}`);
