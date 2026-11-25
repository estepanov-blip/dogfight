import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SYMBOL_IDS, type SymbolId } from '../../engine';
import { SYMBOL_IMG, SYMBOL_NAME } from '../presentation';
import type { ReelView } from '../useBattle';
import { TIMING } from '../useBattle';

function filler(n: number): SymbolId[] {
  // purely cosmetic blur strip — not related to the combat RNG
  return Array.from({ length: n }, () => SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]);
}

function Reel({
  target,
  prev,
  spinKey,
  duration,
  index,
}: {
  target: SymbolId;
  prev: SymbolId;
  spinKey: number;
  duration: number;
  index: number;
}) {
  const strip = useMemo(
    () => (spinKey === 0 ? [target] : [prev, ...filler(10 + index * 4), target]),
    [spinKey],
  );
  const [phase, setPhase] = useState<'rest' | 'start' | 'go'>('rest');
  const raf = useRef(0);

  useLayoutEffect(() => {
    if (spinKey === 0) return;
    setPhase('start');
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => setPhase('go'));
    });
    const t = window.setTimeout(() => setPhase('rest'), duration + 40);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(t);
    };
  }, [spinKey, duration]);

  const n = strip.length;
  const style: React.CSSProperties =
    phase === 'rest'
      ? { transform: `translateY(-${((n - 1) / n) * 100}%)`, transition: 'none' }
      : phase === 'start'
        ? { transform: 'translateY(0)', transition: 'none' }
        : {
            transform: `translateY(-${((n - 1) / n) * 100}%)`,
            transition: `transform ${duration}ms cubic-bezier(.17,.67,.32,1.12)`,
          };

  return (
    <div className={`reel ${phase === 'go' ? 'is-spinning' : ''}`} aria-label={SYMBOL_NAME[target]}>
      <div className="reel-strip" style={style}>
        {strip.map((s, i) => (
          <div className="reel-cell" key={i}>
            <img src={SYMBOL_IMG[s]} alt="" draggable={false} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Reels({ reel, speed }: { reel: ReelView; speed: number }) {
  const k = 1 / Math.max(0.25, speed);
  return (
    <div className={`slot-machine ${reel.jackpot ? 'jackpot' : ''} ${reel.spinning ? 'spinning' : ''}`}>
      <div className="slot-lights" aria-hidden />
      <div className="slot-window">
        {reel.symbols.map((s, i) => (
          <Reel
            key={i}
            index={i}
            target={s}
            prev={reel.prev[i] ?? s}
            spinKey={reel.spinKey}
            duration={Math.round(TIMING.reelStops[i] * k)}
          />
        ))}
        <div className="slot-glass" aria-hidden />
      </div>
    </div>
  );
}
