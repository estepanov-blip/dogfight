import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BALANCE, type GameMode, type PlayerIndex } from '../../engine';
import { BattleLog } from '../components/BattleLog';
import { DebugDrawer } from '../components/DebugDrawer';
import { Fighter } from '../components/Fighter';
import { Hud } from '../components/Hud';
import { Reels } from '../components/Reels';
import { ResultOverlay } from '../components/ResultOverlay';
import { fighterNames, RING_IMG, SYMBOL_IMG } from '../presentation';
import { useBattle } from '../useBattle';
import { bindBackButton } from '../../platform/telegram';

interface Props {
  mode: GameMode;
  seed?: number;
  debug: boolean;
  onExit: () => void;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function BattleScreen({ mode, seed, debug, onExit }: Props) {
  const [speed, setSpeed] = useState(() => (prefersReducedMotion() ? 2 : 1));
  const [botPaused, setBotPaused] = useState(false);
  const ctl = useBattle({ mode, seed, speed, botPaused });
  const { state, session, view, reel, poses, caption, floats, impact, shakeKey, flashKey, showResult } = ctl;
  const [logOpen, setLogOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const names = fighterNames(mode);
  const playing = state.status === 'playing';
  const canSpin = session.canHumanSpin();
  const botTurn = session.isBotTurn();
  const animating = session.phase === 'animating' || (state.status === 'over' && !showResult);
  // While a spin is animated, the HUD keeps showing the fighter who spun.
  const shownTurn: PlayerIndex = animating && ctl.lastRecord ? ctl.lastRecord.actor : state.current;
  const shownSpin = animating && ctl.lastRecord ? ctl.lastRecord.index : state.spinCount + 1;
  const extraNow = playing && state.currentIsExtra && session.phase === 'idle';

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

  // Telegram native Back button = exit to menu
  useEffect(() => bindBackButton(onExit), [onExit]);

  // keyboard: Space / Enter spins (the session lock rejects repeats)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || logOpen || showResult) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        ctl.spin('human');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl, logOpen, showResult]);

  let buttonLabel = 'Крутить';
  if (animating && ctl.lastRecord) buttonLabel = mode === 'bot' && ctl.lastRecord.actor === 1 ? `${names[1]} крутит…` : 'Крутим…';
  else if (!playing) buttonLabel = 'Бой окончен';
  else if (botTurn) buttonLabel = `${names[1]} крутит…`;
  else if (mode === 'local') buttonLabel = `${names[state.current]}: крутить`;

  const turnSide: PlayerIndex = shownTurn;

  return (
    <div
      className={`screen battle mode-${mode}`}
      style={{ '--turn-color': turnSide === 0 ? 'var(--red)' : 'var(--blue)' } as CSSProperties}
    >
      <Hud
        names={names}
        hp={view.hp}
        shield={view.shield}
        max={BALANCE.hp}
        current={shownTurn}
        playing={(playing || animating) && !showResult}
        isBot={[false, mode === 'bot']}
      />

      <div className="spin-counter">
        Ход {Math.min(shownSpin, BALANCE.rules.maxSpins)} / {BALANCE.rules.maxSpins}
        {extraNow && <span className="extra-badge">⚡ доп. ход</span>}
      </div>

      <main className="arena" ref={arenaRef}>
        <div className="arena-bg" style={{ backgroundImage: `url(${RING_IMG})` }} aria-hidden />
        <div className="arena-lights" aria-hidden />
        <div className="arena-floor" aria-hidden />
        <Fighter
          index={0}
          pose={poses[0]}
          shield={view.shield[0]}
          active={(playing || animating) && turnSide === 0}
          floats={floats.filter((f) => f.side === 0)}
        />
        <Fighter
          index={1}
          pose={poses[1]}
          shield={view.shield[1]}
          active={(playing || animating) && turnSide === 1}
          floats={floats.filter((f) => f.side === 1)}
        />
        {impact && (
          <div
            key={impact.key}
            className={`impact impact-${impact.side === 0 ? 'left' : 'right'} ${impact.crit ? 'crit' : ''}`}
            aria-hidden
          >
            <img src={SYMBOL_IMG.critical} alt="" />
          </div>
        )}
        {caption && !showResult && (
          <div key={`${caption.key}-${caption.text}`} className={`caption caption-${caption.kind}`} role="status" aria-live="polite">
            <div className="caption-text" data-text={caption.text}>
              {caption.text}
            </div>
            {caption.sub && <div className="caption-sub">{caption.sub}</div>}
          </div>
        )}
        {flashKey > 0 && <div key={`flash-${flashKey}`} className="crit-flash" aria-hidden />}
      </main>

      <section className="controls">
        <Reels reel={reel} speed={speed} />
        <button
          className={`btn btn-primary btn-spin ${mode === 'local' ? `turn-${turnSide}` : ''}`}
          onClick={() => ctl.spin('human')}
          disabled={!canSpin}
          aria-disabled={!canSpin}
        >
          <span className={`spin-icon ${animating || botTurn ? 'rot' : ''}`}>⟳</span> {buttonLabel}
        </button>
        <nav className="subnav">
          <button className="btn btn-ghost" onClick={onExit}>
            ← Меню
          </button>
          <button className="btn btn-ghost" onClick={() => setLogOpen(true)}>
            Журнал ({state.log.length})
          </button>
          {debug && (
            <button className="btn btn-ghost btn-debug" onClick={() => setDebugOpen((v) => !v)}>
              Debug
            </button>
          )}
        </nav>
      </section>

      {debug && debugOpen && (
        <DebugDrawer
          ctl={ctl}
          speed={speed}
          setSpeed={setSpeed}
          botPaused={botPaused}
          setBotPaused={setBotPaused}
          onClose={() => setDebugOpen(false)}
        />
      )}

      {showResult && !logOpen && (
        <ResultOverlay
          state={state}
          mode={mode}
          names={names}
          onRematch={ctl.rematch}
          onMenu={onExit}
          onLog={() => setLogOpen(true)}
        />
      )}
      {logOpen && <BattleLog log={state.log} names={names} onClose={() => setLogOpen(false)} />}
      <div className="sr-only" aria-live="polite">
        {`Ход ${state.spinCount}. ${names[0]} ${view.hp[0]} HP, ${names[1]} ${view.hp[1]} HP`}
      </div>
    </div>
  );
}
