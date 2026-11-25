import { useState } from 'react';
import { parseSeed, SYMBOL_IDS, type SymbolId } from '../../engine';
import { SYMBOL_IMG, SYMBOL_NAME } from '../presentation';
import type { BattleController } from '../useBattle';

interface Props {
  ctl: BattleController;
  speed: number;
  setSpeed: (s: number) => void;
  botPaused: boolean;
  setBotPaused: (b: boolean) => void;
  onClose: () => void;
}

const PRESETS: { label: string; s: SymbolId[] }[] = [
  ...SYMBOL_IDS.map((id) => ({ label: `3× ${SYMBOL_NAME[id]}`, s: [id, id, id] as SymbolId[] })),
  { label: 'Крит + Удар + Удар', s: ['critical', 'punch', 'punch'] },
  { label: 'Блок + Лечение + Удар', s: ['block', 'heal', 'punch'] },
  { label: '⚡ + ⚡ + Удар', s: ['extra', 'extra', 'punch'] },
  { label: 'Промах ×2 + Удар', s: ['miss', 'miss', 'punch'] },
];

export function DebugDrawer({ ctl, speed, setSpeed, botPaused, setBotPaused, onClose }: Props) {
  const { session, state } = ctl;
  const [combo, setCombo] = useState<SymbolId[]>(['punch', 'punch', 'punch']);
  const [seedText, setSeedText] = useState(String(state.seed));
  const [, bump] = useState(0);
  const forced = session.forcedNext;

  const force = (s: SymbolId[]) => {
    session.setForcedNext(s);
    bump((x) => x + 1);
  };

  return (
    <aside className="debug-drawer" aria-label="Debug">
      <div className="sheet-head">
        <h2>Debug</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>

      <div className="dbg-grid">
        <div className="dbg-kv"><span>seed</span><b>{state.seed}</b></div>
        <div className="dbg-kv"><span>ход</span><b>{state.spinCount}/{session.balance.rules.maxSpins}</b></div>
        <div className="dbg-kv"><span>фаза</span><b>{session.phase}</b></div>
        <div className="dbg-kv"><span>отклонено кликов</span><b>{session.rejectedClicks}</b></div>
        <div className="dbg-kv"><span>серия доп.</span><b>{state.streakExtraGranted} (ждёт {state.pendingExtra})</b></div>
        <div className="dbg-kv"><span>щиты</span><b>{state.fighters[0].shield} / {state.fighters[1].shield}</b></div>
      </div>

      <h3>Принудительная комбинация (следующий спин)</h3>
      <div className="dbg-combo">
        {combo.map((s, i) => (
          <select
            key={i}
            value={s}
            onChange={(e) => setCombo((c) => c.map((x, j) => (j === i ? (e.target.value as SymbolId) : x)))}
            aria-label={`Барабан ${i + 1}`}
          >
            {SYMBOL_IDS.map((id) => (
              <option key={id} value={id}>
                {SYMBOL_NAME[id]}
              </option>
            ))}
          </select>
        ))}
        <button className="btn btn-small btn-primary" onClick={() => force(combo)}>
          Задать
        </button>
      </div>
      <div className="dbg-presets">
        {PRESETS.map((p) => (
          <button key={p.label} className="chip-btn" onClick={() => force(p.s)}>
            {p.s.map((s, i) => (
              <img key={i} src={SYMBOL_IMG[s]} alt="" />
            ))}
            <span>{p.label}</span>
          </button>
        ))}
      </div>
      {forced && (
        <p className="dbg-note">
          Следующий спин: <b>{forced.map((s) => SYMBOL_NAME[s]).join(' · ')}</b>{' '}
          <button
            className="link-btn"
            onClick={() => {
              session.setForcedNext(null);
              bump((x) => x + 1);
            }}
          >
            сбросить
          </button>
        </p>
      )}

      <h3>HP и состояние</h3>
      <div className="dbg-row">
        <button className="chip-btn" onClick={() => ctl.debugSetHp([10, 10])}>HP 10 : 10</button>
        <button className="chip-btn" onClick={() => ctl.debugSetHp([100, 15])}>HP 100 : 15</button>
        <button className="chip-btn" onClick={() => ctl.debugSetHp([15, 100])}>HP 15 : 100</button>
        <button className="chip-btn" onClick={() => ctl.debugSetHp([100, 100])}>HP 100 : 100</button>
      </div>

      <h3>Seed RNG</h3>
      <div className="dbg-row">
        <input value={seedText} onChange={(e) => setSeedText(e.target.value)} aria-label="seed" />
        <button className="btn btn-small btn-dark" onClick={() => ctl.restart(parseSeed(seedText))}>
          Новый бой с seed
        </button>
      </div>

      <h3>Скорость и бот</h3>
      <div className="dbg-row">
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} className={`chip-btn ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
            ×{s}
          </button>
        ))}
        {session.mode === 'bot' && (
          <button className={`chip-btn ${botPaused ? 'on' : ''}`} onClick={() => setBotPaused(!botPaused)}>
            {botPaused ? '▶ Бот на паузе' : '⏸ Пауза бота'}
          </button>
        )}
      </div>
    </aside>
  );
}
