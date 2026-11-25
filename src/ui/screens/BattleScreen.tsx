import { useEffect, useState, type CSSProperties } from 'react';
import { BALANCE, type GameMode, type PlayerIndex } from '../../engine';
import { BattleLog } from '../components/BattleLog';
import { DebugDrawer } from '../components/DebugDrawer';
import { Arena } from '../components/Arena';
import { Hud } from '../components/Hud';
import { Reels } from '../components/Reels';
import { ResultOverlay } from '../components/ResultOverlay';
import { fighterNames } from '../presentation';
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
  const { state, session, view, reel, showResult } = ctl;
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

      <Arena anim={ctl} speed={speed} turnSide={turnSide} active={playing || animating} hideCaption={showResult} />

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
          me={mode === 'bot' ? 0 : null}
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
