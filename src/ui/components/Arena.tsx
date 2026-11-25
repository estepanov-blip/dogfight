import { useEffect, useRef } from 'react';
import type { PlayerIndex } from '../../engine';
import { RING_IMG, SYMBOL_IMG } from '../presentation';
import type { Animator } from '../useAnimator';
import { Fighter } from './Fighter';

interface Props {
  anim: Animator;
  speed: number;
  turnSide: PlayerIndex;
  active: boolean;
  hideCaption?: boolean;
}

/** Ring + fighters + combat FX. Shared by local battles and online duels. */
export function Arena({ anim, speed, turnSide, active, hideCaption }: Props) {
  const { view, poses, caption, floats, impact, shakeKey, flashKey } = anim;
  // screen shake via WAAPI so fighters are not remounted mid-animation
  const arenaRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (shakeKey === 0 || !arenaRef.current?.animate) return;
    const a = 7;
    arenaRef.current.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: `translate(${-a}px,${a / 2}px) rotate(-0.6deg)` },
        { transform: `translate(${a}px,${-a / 2}px) rotate(0.6deg)` },
        { transform: `translate(${-a / 2}px,${a / 3}px)` },
        { transform: `translate(${a / 3}px,0)` },
        { transform: 'translate(0,0)' },
      ],
      { duration: 380 / Math.max(0.5, speed), easing: 'ease-out' },
    );
  }, [shakeKey, speed]);

  return (
    <main className="arena" ref={arenaRef}>
      <div className="arena-bg" style={{ backgroundImage: `url(${RING_IMG})` }} aria-hidden />
      <div className="arena-lights" aria-hidden />
      <div className="arena-floor" aria-hidden />
      {([0, 1] as PlayerIndex[]).map((i) => (
        <Fighter
          key={i}
          index={i}
          pose={poses[i]}
          shield={view.shield[i]}
          active={active && turnSide === i}
          floats={floats.filter((f) => f.side === i)}
        />
      ))}
      {impact && (
        <div
          key={impact.key}
          className={`impact impact-${impact.side === 0 ? 'left' : 'right'} ${impact.crit ? 'crit' : ''}`}
          aria-hidden
        >
          <img src={SYMBOL_IMG.critical} alt="" />
        </div>
      )}
      {caption && !hideCaption && (
        <div key={`${caption.key}-${caption.text}`} className={`caption caption-${caption.kind}`} role="status" aria-live="polite">
          <div className="caption-text" data-text={caption.text}>
            {caption.text}
          </div>
          {caption.sub && <div className="caption-sub">{caption.sub}</div>}
        </div>
      )}
      {flashKey > 0 && <div key={`flash-${flashKey}`} className="crit-flash" aria-hidden />}
    </main>
  );
}
