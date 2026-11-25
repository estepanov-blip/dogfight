import type { CSSProperties } from 'react';
import type { PlayerIndex } from '../../engine';
import { FIGHTER_LOOK } from '../presentation';
import type { FloatItem, PoseState } from '../useBattle';

interface Props {
  index: PlayerIndex;
  pose: PoseState;
  shield: number;
  active: boolean;
  floats: FloatItem[];
}

export function Fighter({ index, pose, shield, active, floats }: Props) {
  const look = FIGHTER_LOOK[index];
  const side = index === 0 ? 'left' : 'right';
  const style = { '--dir': index === 0 ? 1 : -1 } as CSSProperties;
  return (
    <div className={`fighter fighter-${side} corner-${look.corner} ${active ? 'is-active' : ''}`} style={style}>
      <div className="fighter-spot" aria-hidden />
      <div className={`fighter-pose pose-${pose.pose}`} key={pose.key}>
        <div className="fighter-bob">
          <img
            className={`fighter-img ${look.flip ? 'flip' : ''}`}
            src={look.sprite}
            alt={look.breed}
            draggable={false}
          />
          <div
            className={`hit-tint ${look.flip ? 'flip' : ''}`}
            style={{ maskImage: `url(${look.sprite})`, WebkitMaskImage: `url(${look.sprite})` }}
            aria-hidden
          />
          {pose.pose === 'heal' && (
            <div className="heal-fx" aria-hidden>
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} style={{ '--i': i } as CSSProperties}>+</span>
              ))}
            </div>
          )}
        </div>
        {shield > 0 && (
          <div className={`shield-bubble ${shield >= 100 ? 'full' : ''}`} aria-label={`Щит ${shield}`}>
            <b>🛡 {shield >= 100 ? '100%' : shield}</b>
          </div>
        )}
        {pose.pose === 'blockHit' && <div className="shield-flash" aria-hidden />}
      </div>
      {pose.pose === 'ko' && (
        <div className="ko-stars" aria-hidden>
          <span>★</span>
          <span>✦</span>
          <span>★</span>
        </div>
      )}
      <div className="floats" aria-hidden>
        {floats.map((f) => (
          <span key={f.id} className={`float float-${f.kind} ${f.big ? 'big' : ''}`}>
            {f.text}
          </span>
        ))}
      </div>
    </div>
  );
}
