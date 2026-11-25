import { useState } from 'react';
import type { GameMode } from '../../engine';
import { Crown } from '../components/Crown';
import { RulesSheet } from '../components/RulesSheet';
import { FIGHTER_LOOK, RING_IMG } from '../presentation';

interface Props {
  debug: boolean;
  setDebug: (v: boolean) => void;
  onPlay: (mode: GameMode) => void;
  onLab: () => void;
  /** Duel server reachable and opened inside Telegram. */
  online: boolean;
  myTurns: number;
  challengeBusy: boolean;
  onChallenge: () => void;
  onDuels: () => void;
}

export function MenuScreen({ debug, setDebug, onPlay, onLab, online, myTurns, challengeBusy, onChallenge, onDuels }: Props) {
  const [rules, setRules] = useState(false);
  return (
    <div className="screen menu">
      <div className="menu-bg" style={{ backgroundImage: `url(${RING_IMG})` }} aria-hidden />
      <div className="doodles" aria-hidden>
        <span>🦴</span>
        <span>♛</span>
        <span>🦴</span>
        <span>✦</span>
        <span>♛</span>
      </div>
      <div className="logo">
        <Crown className="logo-crown" />
        <h1 className="logo-title" data-text="ПРОПУСТИЛ!">
          ПРОПУСТИЛ!
        </h1>
        <div className="logo-sub">DOG FIGHT CLUB</div>
      </div>

      <div className="menu-dogs" aria-hidden>
        <img className="menu-dog left" src={FIGHTER_LOOK[0].sprite} alt="" draggable={false} />
        <img className="menu-dog right flip" src={FIGHTER_LOOK[1].sprite} alt="" draggable={false} />
      </div>

      <div className="menu-actions">
        <button className="btn btn-primary btn-play" onClick={() => onPlay('bot')} autoFocus>
          Играть <span className="play-tri">▶</span>
        </button>
        {online && (
          <div className="menu-row">
            <button className="btn btn-dark btn-tile btn-tile-hot" onClick={onChallenge} disabled={challengeBusy}>
              <span className="tile-ico">📨</span>
              <span>
                {challengeBusy ? 'Готовим…' : 'Вызвать друга'}
                <small>дуэль в Telegram</small>
              </span>
            </button>
            <button className="btn btn-dark btn-tile" onClick={onDuels}>
              <span className="tile-ico">🏆</span>
              <span>
                Мои дуэли
                <small>{myTurns > 0 ? `твой ход: ${myTurns}` : 'и рейтинг чата'}</small>
              </span>
              {myTurns > 0 && <span className="badge">{myTurns}</span>}
            </button>
          </div>
        )}
        <div className="menu-row">
          <button className="btn btn-dark btn-tile" onClick={() => onPlay('local')}>
            <span className="tile-ico">👥</span>
            <span>
              Вдвоём
              <small>на одном экране</small>
            </span>
          </button>
          <button className="btn btn-dark btn-tile" onClick={() => setRules(true)}>
            <span className="tile-ico">📖</span>
            <span>
              Правила
              <small>и символы</small>
            </span>
          </button>
        </div>
        <div className="menu-row menu-debug">
          <label className="switch">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            <span className="switch-track" />
            <span>Debug режим</span>
          </label>
          {debug && (
            <button className="btn btn-ghost btn-small" onClick={onLab}>
              🧪 Симуляция боёв
            </button>
          )}
        </div>
      </div>
      <p className="build-tag">Combat Sandbox v0.1 · временный арт</p>
      {rules && <RulesSheet onClose={() => setRules(false)} />}
    </div>
  );
}
