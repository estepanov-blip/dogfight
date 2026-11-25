import { useEffect, useRef, type ReactNode } from 'react';
import { battleStats, type BattleState, type PlayerIndex } from '../../engine';
import { FIGHTER_LOOK, outcomeTitle } from '../presentation';
import { Crown } from './Crown';

interface Props {
  state: BattleState;
  /** Whose point of view: 0/1, or null for neutral hot-seat. */
  me: PlayerIndex | null;
  names: [string, string];
  onRematch: () => void;
  rematchLabel?: string;
  rematchBusy?: boolean;
  /** v0.3: rated / friendly status, bones, head-to-head score. */
  children?: ReactNode;
  onMenu: () => void;
  onLog: () => void;
}

export function ResultOverlay({ state, me, names, onRematch, rematchLabel, rematchBusy, onMenu, onLog, children }: Props) {
  const rematchRef = useRef<HTMLButtonElement>(null);
  useEffect(() => rematchRef.current?.focus(), []);
  if (state.outcome === null || state.endReason === null) return null;
  const { title, kind } = outcomeTitle(state.outcome, state.endReason, me);
  const stats = battleStats(state.log);
  const winner = state.outcome === 'draw' ? null : state.outcome;
  const opp = me === null ? null : names[me === 0 ? 1 : 0];
  const how =
    state.endReason === 'ko'
      ? ' нокаутом'
      : state.endReason === 'forfeit'
        ? ' — соперник сдаётся'
        : state.endReason === 'timeout'
          ? ' — у соперника вышло время хода'
          : ' по очкам';
  const subtitle =
    winner === null
      ? state.endReason === 'doubleKo'
        ? 'Оба на полу. Реванш?'
        : `${state.spinCount} ходов — и никто не дожал`
      : me !== null
        ? winner === me
          ? state.endReason === 'ko'
            ? `Нокаут! ${opp} на полу`
            : `Победа${how}`
          : state.endReason === 'forfeit'
            ? 'Бой сдан. Реванш?'
            : state.endReason === 'timeout'
              ? 'Время хода вышло. Реванш?'
            : `Победа за ${opp}. Реванш?`
        : `${names[winner]} побеждает${how}`;

  const rows: [string, (i: 0 | 1) => string | number][] = [
    ['Урон', (i) => stats[i].damageDealt],
    ['Лечение', (i) => stats[i].healed],
    ['Блок', (i) => stats[i].blocked],
    ['Криты', (i) => stats[i].crits],
    ['Лучший удар', (i) => stats[i].biggestHit],
    ['Ходы', (i) => stats[i].spins],
  ];

  return (
    <div className="result-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className={`result result-${kind}`}>
        <Crown className="result-crown" />
        <h1 id="result-title" className="result-title" data-text={title}>
          {title}
        </h1>
        <p className="result-sub">{subtitle}</p>
        {children}
        <div className="result-stats">
          <div className="rs-head" />
          {[0, 1].map((i) => (
            <div key={i} className={`rs-head rs-name corner-${FIGHTER_LOOK[i].corner} ${winner === i ? 'winner' : ''}`}>
              {winner === i && '👑 '}
              {names[i]}
              <small>{state.fighters[i].hp} HP</small>
            </div>
          ))}
          {rows.map(([label, f]) => (
            <div className="rs-row" key={label}>
              <span className="rs-label">{label}</span>
              <span>{f(0)}</span>
              <span>{f(1)}</span>
            </div>
          ))}
        </div>
        <div className="result-actions">
          <button ref={rematchRef} className="btn btn-primary" onClick={onRematch} disabled={rematchBusy}>
            ⟳ {rematchLabel ?? 'Реванш'}
          </button>
          <button className="btn btn-dark" onClick={onMenu}>
            В главное
          </button>
        </div>
        <button className="link-btn" onClick={onLog}>
          Журнал боя ({state.log.length})
        </button>
      </div>
    </div>
  );
}
