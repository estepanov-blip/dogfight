import type { CSSProperties } from 'react';
import type { PlayerIndex } from '../../engine';

function HpBar({ hp, max, side }: { hp: number; max: number; side: 'left' | 'right' }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'danger';
  return (
    <div className={`hpbar hpbar-${side} tone-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp}>
      <div className="hpbar-ghost" style={{ width: `${pct}%` }} />
      <div className="hpbar-fill" style={{ width: `${pct}%` }} />
      <div className="hpbar-shine" />
    </div>
  );
}

interface HudProps {
  names: [string, string];
  hp: [number, number];
  shield: [number, number];
  max: number;
  current: PlayerIndex;
  playing: boolean;
  isBot: [boolean, boolean];
}

export function Hud({ names, hp, shield, max, current, playing, isBot }: HudProps) {
  const side = (i: PlayerIndex) => (
    <div className={`hud-side hud-${i === 0 ? 'left' : 'right'} ${playing && current === i ? 'is-turn' : ''}`}>
      <div className="hud-name">
        {i === 1 && isBot[1] && <span className="bot-tag">бот</span>}
        <span>{names[i]}</span>
        {playing && current === i && <span className="turn-dot" aria-label="ходит" />}
      </div>
      <HpBar hp={hp[i]} max={max} side={i === 0 ? 'left' : 'right'} />
      <div className="hud-hp">
        <span className="hp-num" key={hp[i]}>{hp[i]} HP</span>
        {shield[i] > 0 && <span className="hud-shield">🛡 {shield[i] >= 100 ? '100%' : shield[i]}</span>}
      </div>
    </div>
  );
  return (
    <header className="hud">
      {side(0)}
      <div className="vs" style={{ '--r': '-8deg' } as CSSProperties}>
        VS
      </div>
      {side(1)}
    </header>
  );
}
