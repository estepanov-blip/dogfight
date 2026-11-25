import { useEffect, useRef, useState } from 'react';
import { bindBackButton } from '../../platform/telegram';
import {
  BALANCE,
  parseSeed,
  simulate,
  SYMBOL_IDS,
  totalWeight,
  type SimulationOptions,
  type SimulationReport,
} from '../../engine';
import { SYMBOL_IMG, SYMBOL_NAME } from '../presentation';

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const num = (v: number, d = 1) => v.toFixed(d);

function runInWorker(opts: SimulationOptions): Promise<SimulationReport> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../sim.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // Fallback: run on the main thread (still fast: ~0.2 s for 10k fights)
      setTimeout(() => resolve(simulate(BALANCE, opts)), 20);
      return;
    }
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.report);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(simulate(BALANCE, opts));
    };
    worker.postMessage(opts);
  });
}

export function LabScreen({ onBack }: { onBack: () => void }) {
  useEffect(() => bindBackButton(onBack), [onBack]);
  const [fights, setFights] = useState('10000');
  const [seed, setSeed] = useState('1');
  const [alternate, setAlternate] = useState(true);
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const n = Math.min(1_000_000, Math.max(1, Math.floor(Number(fights) || 10000)));
      setReport(await runInWorker({ fights: n, seed: parseSeed(seed || '1'), alternateStarter: alternate }));
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify({ balance: BALANCE, report }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dfc-sim-${report.fights}-seed${report.seed}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const tw = totalWeight(BALANCE);

  return (
    <div className="screen lab">
      <header className="lab-head">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Меню
        </button>
        <h1>Симуляция боёв</h1>
      </header>

      <div className="lab-form">
        <label>
          Боёв
          <input inputMode="numeric" value={fights} onChange={(e) => setFights(e.target.value)} />
        </label>
        <label>
          Seed
          <input value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label className="lab-check">
          <input type="checkbox" checked={alternate} onChange={(e) => setAlternate(e.target.checked)} />
          чередовать первый ход
        </label>
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Считаем…' : '▶ Запустить'}
        </button>
      </div>
      <p className="muted small">Бот против бота, тот же движок и balance.json, что и в бою.</p>
      {error && <p className="error">{error}</p>}

      {report && (
        <div className="lab-report">
          <section className="card">
            <h2>Итоги · {report.fights.toLocaleString('ru')} боёв</h2>
            <div className="winbar">
              <div className="wb-p1" style={{ width: pct(report.winRate[0]) }}>
                P1 {pct(report.winRate[0])}
              </div>
              <div className="wb-draw" style={{ width: pct(report.drawRate) }} />
              <div className="wb-p2" style={{ width: pct(report.winRate[1]) }}>
                P2 {pct(report.winRate[1])}
              </div>
            </div>
            <div className="kv-grid">
              <div><span>Ничьи</span><b>{pct(report.drawRate, 2)}</b></div>
              <div><span>Победы начавшего</span><b className={Math.abs(report.starterWinRate - 0.5) > 0.05 ? 'warn' : ''}>{pct(report.starterWinRate)}</b></div>
              <div><span>Нокаут</span><b>{report.endReasons.ko}</b></div>
              <div><span>Двойной KO</span><b>{report.endReasons.doubleKo}</b></div>
              <div><span>Лимит {BALANCE.rules.maxSpins} ходов</span><b>{report.endReasons.spinLimit}</b></div>
              <div><span>HP победителя (ср.)</span><b>{num(report.meanWinnerHp)}</b></div>
              <div><span>Камбэки*</span><b>{pct(report.comebackRate)}</b></div>
              <div><span>Время расчёта</span><b>{num(report.elapsedMs, 0)} мс</b></div>
            </div>
            <p className="muted small">* победитель отставал по HP после 6-го хода.</p>
          </section>

          <section className="card">
            <h2>Длительность (ходы = вращения)</h2>
            <div className="kv-grid">
              <div><span>Среднее</span><b>{num(report.spinsPerFight.mean, 2)}</b></div>
              <div><span>Медиана</span><b>{report.spinsPerFight.median}</b></div>
              <div><span>p10 – p90</span><b>{report.spinsPerFight.p10} – {report.spinsPerFight.p90}</b></div>
              <div><span>Мин – макс</span><b>{report.spinsPerFight.min} – {report.spinsPerFight.max}</b></div>
              <div><span>На бойца (ср.)</span><b>{num(report.meanSpinsPerFighter, 2)}</b></div>
            </div>
            <Histogram data={report.spinsPerFight.histogram} />
          </section>

          <section className="card">
            <h2>Символы и тройки</h2>
            <table className="lab-table">
              <thead>
                <tr><th /><th>Символ</th><th>Ожид.</th><th>Факт</th><th>Тройка/спин</th></tr>
              </thead>
              <tbody>
                {SYMBOL_IDS.map((id) => (
                  <tr key={id}>
                    <td><img src={SYMBOL_IMG[id]} alt="" /></td>
                    <td>{SYMBOL_NAME[id]}</td>
                    <td>{pct(BALANCE.symbols[id].weight / tw)}</td>
                    <td>{pct(report.symbolFrequency[id])}</td>
                    <td>{pct(report.tripleFrequency[id], 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Любая тройка: {pct(report.anyTripleRate, 2)} спинов.</p>
          </section>

          <section className="card">
            <h2>Частота эффектов</h2>
            <div className="kv-grid">
              <div><span>Спин с уроном</span><b>{pct(report.effects.spinsWithDamage)}</b></div>
              <div><span>Спин с критом</span><b>{pct(report.effects.spinsWithCrit)}</b></div>
              <div><span>Спин со щитом</span><b>{pct(report.effects.spinsWithShield)}</b></div>
              <div><span>Спин с лечением</span><b>{pct(report.effects.spinsWithHeal)}</b></div>
              <div><span>Спин с молнией</span><b>{pct(report.effects.spinsWithExtra)}</b></div>
              <div><span>Урон/спин (ср.)</span><b>{num(report.effects.meanDamagePerSpin)}</b></div>
              <div><span>Поглощено щитами</span><b>{pct(report.effects.totalAbsorbed / Math.max(1, report.effects.totalAbsorbed + report.effects.totalDamageDealt))}</b></div>
              <div><span>Щитов пробито</span><b>{report.effects.shieldsBroken.toLocaleString('ru')}</b></div>
              <div><span>Щитов сгорело</span><b>{report.effects.shieldsExpiredUnused.toLocaleString('ru')}</b></div>
              <div><span>Лечение впустую</span><b>{pct(report.effects.totalOverheal / Math.max(1, report.effects.totalHealed + report.effects.totalOverheal))}</b></div>
              <div><span>Доп. ходов дано</span><b>{report.effects.extraGranted.toLocaleString('ru')}</b></div>
              <div><span>Доп. ходов сгорело</span><b>{report.effects.extraWasted.toLocaleString('ru')}</b></div>
            </div>
          </section>
          <button className="btn btn-dark" onClick={exportJson}>
            Скачать отчёт JSON
          </button>
        </div>
      )}
    </div>
  );
}

function Histogram({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="histo" role="img" aria-label="Распределение длительности боёв">
      {data.map((v, i) =>
        i === 0 ? null : (
          <div key={i} className="histo-col" title={`${i} ходов: ${v}`}>
            <div className="histo-bar" style={{ height: `${(v / max) * 100}%` }} />
            {i % 5 === 0 && <span className="histo-x">{i}</span>}
          </div>
        ),
      )}
    </div>
  );
}
