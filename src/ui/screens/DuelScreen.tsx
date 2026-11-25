import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BALANCE, type PlayerIndex } from '../../engine';
import { api } from '../../online/api';
import type { DuelView, PlayerInfo } from '../../online/protocol';
import { bindBackButton, shareChallenge } from '../../platform/telegram';
import { Arena } from '../components/Arena';
import { BattleLog } from '../components/BattleLog';
import { Hud } from '../components/Hud';
import { Reels } from '../components/Reels';
import { ResultOverlay } from '../components/ResultOverlay';
import { useDuel } from '../useDuel';

interface Props {
  id: string;
  onExit: () => void;
  onOpenDuel: (id: string) => void;
}

function short(name: string) {
  const n = name.trim().split(/\s+/)[0] ?? name;
  return (n.length > 10 ? n.slice(0, 9) + '…' : n).toUpperCase();
}

export function duelNames(d: DuelView): [string, string] {
  const label = (i: PlayerIndex) => {
    const p = d.players[i];
    if (d.me === i) return 'ТЫ';
    return p ? short(p.name) : '???';
  };
  return [label(0), label(1)];
}

export function Avatar({ p, corner }: { p: PlayerInfo | null; corner: 'red' | 'blue' }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar corner-${corner}`}>
      {p?.photo && !broken ? (
        <img src={p.photo} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
      ) : (
        <span>{p ? p.name.slice(0, 1).toUpperCase() : '?'}</span>
      )}
    </span>
  );
}

async function share(d: DuelView) {
  let prepared: string | null = null;
  try {
    prepared = (await api.share(d.id)).prepared;
  } catch {
    /* fallback below */
  }
  await shareChallenge(prepared, d.link, 'Вызываю тебя на бой! 🥊 Ударь в ответ, пока я не убежал.');
}

export function DuelScreen({ id, onExit, onOpenDuel }: Props) {
  const [speed] = useState(1);
  const ctl = useDuel(id, speed);
  const { duel, anim, error, busy, animating, showResult, shownTurn } = ctl;
  const [logOpen, setLogOpen] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const forfeitTimer = useRef(0);

  useEffect(() => bindBackButton(onExit), [onExit]);
  useEffect(() => () => window.clearTimeout(forfeitTimer.current), []);

  if (!duel) {
    return (
      <div className="screen duel-msg">
        {error ? (
          <>
            <h2>Бой не открылся</h2>
            <p className="muted">{error}</p>
            <button className="btn btn-primary" onClick={() => ctl.reload()}>
              Ещё раз
            </button>
          </>
        ) : (
          <p className="muted loading-dots">Выходим на ринг</p>
        )}
        <button className="btn btn-ghost" onClick={onExit}>
          ← Меню
        </button>
      </div>
    );
  }

  // ---------- open challenge ----------
  if (duel.status === 'open') {
    const challenger = duel.players[0];
    if (duel.me === 0) {
      return (
        <div className="screen challenge">
          <div className="challenge-card">
            <img className="challenge-art" src={`${import.meta.env.BASE_URL}share.jpg`} alt="" />
            <h2>Вызов брошен!</h2>
            <p className="muted">
              Отправь его другу или в чат. Бой начнётся, как только кто-то нажмёт «Принять вызов» — бот сразу напишет тебе.
            </p>
            <button className="btn btn-primary" onClick={() => share(duel)}>
              📨 Отправить вызов
            </button>
            <p className="waiting-dots muted">Ждём соперника</p>
          </div>
          <button className="btn btn-ghost" onClick={onExit}>
            ← Меню
          </button>
        </div>
      );
    }
    return (
      <div className="screen challenge">
        <div className="challenge-card">
          <div className="challenge-head">
            <Avatar p={challenger} corner="red" />
            <div>
              <h2>{challenger.name} вызывает тебя на бой!</h2>
              <p className="muted">Ударь в ответ, пока он не убежал 🥊</p>
            </div>
          </div>
          <img className="challenge-art" src={`${import.meta.env.BASE_URL}share.jpg`} alt="" />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-accept" onClick={ctl.acceptChallenge} disabled={busy}>
            {busy ? 'Выходим на ринг…' : 'Принять вызов'}
          </button>
          <button className="link-btn" onClick={onExit}>
            Отклонить
          </button>
        </div>
      </div>
    );
  }

  // ---------- fight ----------
  const b = duel.battle!;
  const names = duelNames(duel);
  const playing = duel.status === 'active';
  const turnSide: PlayerIndex = shownTurn ?? b.current;
  const opponentIdx: PlayerIndex | null = duel.me === null ? null : duel.me === 0 ? 1 : 0;
  const oppName = opponentIdx !== null ? names[opponentIdx] : '';
  const canSpin = playing && duel.yourTurn && !animating && !busy;
  const shownSpin = animating && anim.lastRecord ? anim.lastRecord.index : b.spinCount + 1;

  let label = 'Крутить';
  let sub: string | null = null;
  if (duel.me === null) label = 'Ты зритель';
  else if (animating && anim.lastRecord) label = anim.lastRecord.actor === duel.me ? 'Крутим…' : `${oppName} бьёт…`;
  else if (!playing) label = 'Бой окончен';
  else if (busy) label = 'Крутим…';
  else if (!duel.yourTurn) {
    label = `Ход: ${oppName}`;
    sub = 'Можно закрыть игру — бот напишет, когда твой ход';
  }

  const firstBanner =
    playing && b.spinCount === 0 && !animating ? (b.current === duel.me ? 'Жребий: первым бьёшь ТЫ' : `Жребий: первым бьёт ${oppName}`) : null;

  const onForfeit = () => {
    if (!confirmForfeit) {
      setConfirmForfeit(true);
      forfeitTimer.current = window.setTimeout(() => setConfirmForfeit(false), 3000);
      return;
    }
    setConfirmForfeit(false);
    void ctl.forfeit();
  };

  const onRematch = async () => {
    const newId = await ctl.rematch();
    if (newId) onOpenDuel(newId);
  };

  return (
    <div
      className="screen battle mode-online"
      style={{ '--turn-color': turnSide === 0 ? 'var(--red)' : 'var(--blue)' } as CSSProperties}
    >
      <Hud
        names={names}
        hp={anim.view.hp}
        shield={anim.view.shield}
        max={BALANCE.hp}
        current={turnSide}
        playing={(playing || animating) && !showResult}
        isBot={[false, false]}
      />
      <div className="spin-counter">
        {firstBanner ?? (
          <>
            Ход {Math.min(shownSpin, BALANCE.rules.maxSpins)} / {BALANCE.rules.maxSpins}
            {playing && b.currentIsExtra && !animating && <span className="extra-badge">⚡ доп. ход</span>}
          </>
        )}
      </div>

      <Arena anim={anim} speed={speed} turnSide={turnSide} active={playing || animating} hideCaption={showResult} />

      <section className="controls">
        <Reels reel={anim.reel} speed={speed} />
        <button
          className={`btn btn-primary btn-spin ${!duel.yourTurn && playing && !animating ? 'waiting' : ''}`}
          onClick={ctl.spin}
          disabled={!canSpin}
        >
          <span className={`spin-icon ${animating || busy || (!duel.yourTurn && playing) ? 'rot' : ''}`}>⟳</span> {label}
        </button>
        {sub && <p className="spin-sub">{sub}</p>}
        {error && (
          <p className="error small" onClick={ctl.clearError}>
            {error}
          </p>
        )}
        <nav className="subnav">
          <button className="btn btn-ghost" onClick={onExit}>
            ← Меню
          </button>
          <button className="btn btn-ghost" onClick={() => setLogOpen(true)}>
            Журнал ({b.log.length})
          </button>
          {playing && duel.me !== null && (
            <button className={`btn btn-ghost ${confirmForfeit ? 'btn-danger' : ''}`} onClick={onForfeit} disabled={busy}>
              {confirmForfeit ? 'Точно сдаться?' : '🏳 Сдаться'}
            </button>
          )}
        </nav>
      </section>

      {showResult && !logOpen && (
        <ResultOverlay
          state={b}
          me={duel.me}
          names={names}
          onRematch={onRematch}
          rematchLabel={duel.rematchId ? 'Принять реванш' : 'Реванш'}
          rematchBusy={busy || duel.me === null}
          onMenu={onExit}
          onLog={() => setLogOpen(true)}
        />
      )}
      {logOpen && <BattleLog log={b.log} names={names} onClose={() => setLogOpen(false)} />}
      <div className="sr-only" aria-live="polite">
        {duel.yourTurn ? 'Твой ход' : `Ход соперника`}
      </div>
    </div>
  );
}
