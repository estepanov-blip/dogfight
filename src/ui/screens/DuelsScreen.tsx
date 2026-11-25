import { useEffect, useState } from 'react';
import { api } from '../../online/api';
import type { DuelSummary, MeResponse } from '../../online/protocol';
import { bindBackButton } from '../../platform/telegram';
import { Crown } from '../components/Crown';
import { Avatar } from './DuelScreen';

interface Props {
  onExit: () => void;
  onOpenDuel: (id: string) => void;
  onChallenge: () => void;
  challengeBusy: boolean;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function statusChip(d: DuelSummary) {
  if (d.status === 'open') return <span className="chip-st st-open">ждёт соперника</span>;
  if (d.status === 'active') return d.yourTurn ? <span className="chip-st st-turn">твой ход!</span> : <span className="chip-st st-wait">ход соперника</span>;
  if (d.result === 'win') return <span className="chip-st st-win">победа</span>;
  if (d.result === 'lose') return <span className="chip-st st-lose">поражение</span>;
  return <span className="chip-st st-draw">ничья</span>;
}

export function DuelsScreen({ onExit, onOpenDuel, onChallenge, challengeBusy }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => bindBackButton(onExit), [onExit]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .me()
        .then((r) => alive && setMe(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = window.setInterval(() => !document.hidden && load(), 8000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const duels = me?.duels ?? [];
  const order = (d: DuelSummary) => (d.status === 'active' && d.yourTurn ? 0 : d.status === 'active' ? 1 : d.status === 'open' ? 2 : 3);
  const sorted = [...duels].sort((a, b) => order(a) - order(b) || b.updatedAt - a.updatedAt);

  return (
    <div className="screen duels">
      <header className="lab-head">
        <button className="btn btn-ghost" onClick={onExit}>
          ← Меню
        </button>
        <h1>Мои дуэли</h1>
      </header>

      <button className="btn btn-primary btn-challenge" onClick={onChallenge} disabled={challengeBusy}>
        {challengeBusy ? 'Готовим вызов…' : '🥊 Вызвать друга'}
      </button>

      {me?.leaderboard && me.leaderboard.length > 0 && (
        <section className="card leaderboard">
          <h2>
            <Crown className="lb-crown" /> Чемпион чата
          </h2>
          <ol>
            {me.leaderboard.slice(0, 10).map((r, i) => (
              <li key={r.id} className={`lb-row ${r.id === me.user.id ? 'is-me' : ''} ${i === 0 ? 'first' : ''}`}>
                <span className="lb-place">{i + 1}</span>
                <Avatar p={{ id: r.id, name: r.name, photo: r.photo }} corner={i === 0 ? 'red' : 'blue'} />
                <span className="lb-name">{r.id === me.user.id ? 'Ты' : r.name}</span>
                <span className="lb-wins">
                  {r.wins} <small>{plural(r.wins, 'победа', 'победы', 'побед')}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {!me && !error && <p className="muted loading-dots">Загружаем</p>}
      {me && sorted.length === 0 && (
        <p className="muted empty">Пока ни одной дуэли. Брось вызов другу — бот позовёт тебя, когда он ответит.</p>
      )}
      <ul className="duel-list">
        {sorted.map((d) => (
          <li key={d.id}>
            <button className={`duel-item ${d.status === 'active' && d.yourTurn ? 'hot' : ''}`} onClick={() => onOpenDuel(d.id)}>
              <Avatar p={d.opponent} corner={d.me === 0 ? 'blue' : 'red'} />
              <span className="duel-main">
                <b>{d.opponent ? `vs ${d.opponent.name}` : 'Открытый вызов'}</b>
                <small>
                  {d.status === 'open' ? 'ссылка отправлена' : `HP ${d.hp[d.me]} : ${d.hp[d.me === 0 ? 1 : 0]}`}
                </small>
              </span>
              {statusChip(d)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
