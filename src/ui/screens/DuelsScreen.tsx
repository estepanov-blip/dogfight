import { useEffect, useState } from 'react';
import { api } from '../../online/api';
import type { DuelSummary, LeaderRow, MeResponse, RivalsResponse } from '../../online/protocol';
import { bindBackButton } from '../../platform/telegram';
import { Crown } from '../components/Crown';
import { Avatar } from '../components/Avatar';

interface Props {
  onExit: () => void;
  onOpenDuel: (id: string) => void;
  onChallenge: () => void;
  challengeBusy: boolean;
}

type Tab = 'duels' | 'rivals' | 'chat' | 'bones';

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function statusChip(d: DuelSummary) {
  if (d.status === 'open') return <span className="chip-st st-open">ждёт соперника</span>;
  if (d.status === 'active') return d.yourTurn ? <span className="chip-st st-turn">твой ход!</span> : <span className="chip-st st-wait">ход соперника</span>;
  if (d.result === 'win') return <span className="chip-st st-win">победа</span>;
  if (d.result === 'lose') return <span className="chip-st st-lose">поражение</span>;
  return <span className="chip-st st-draw">ничья</span>;
}

const REASON: Record<string, string> = {
  start: 'Стартовый бонус',
  ko: 'нокаут',
  spinLimit: 'по очкам',
  doubleKo: 'двойной нокаут',
  surrender: 'сдача',
  early_surrender: 'ранняя сдача',
  turn_timeout: 'таймаут хода',
};

function ledgerLabel(reason: string) {
  if (reason === 'start') return REASON.start;
  const [rated, why] = reason.split(':');
  return `${rated === 'rated' ? 'Рейтинговый бой' : rated === 'friendly' ? 'Дружеский бой' : 'Бой'} · ${REASON[why] ?? why}`;
}

function Board({ rows, meId }: { rows: LeaderRow[]; meId: number }) {
  if (!rows.length) return <p className="muted empty">Пока нет рейтинговых результатов за этот период.</p>;
  return (
    <ol>
      {rows.slice(0, 20).map((r, i) => (
        <li key={r.id} className={`lb-row ${r.id === meId ? 'is-me' : ''} ${i === 0 ? 'first' : ''}`}>
          <span className="lb-place">{i + 1}</span>
          <Avatar p={{ id: r.id, name: r.name, photo: r.photo }} corner={i === 0 ? 'red' : 'blue'} />
          <span className="lb-name">
            {r.id === meId ? 'Ты' : r.name}
            <small>
              {r.wins}–{r.losses}–{r.draws ?? 0} · WR {pct(r.winRate)}
              {r.legacy && ` · v0.2: ${r.legacy.wins}–${r.legacy.losses}`}
            </small>
          </span>
          <span className="lb-wins">
            {r.wins} <small>{plural(r.wins, 'победа', 'победы', 'побед')}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DuelsScreen({ onExit, onOpenDuel, onChallenge, challengeBusy }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [riv, setRiv] = useState<RivalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('duels');
  const [win, setWin] = useState<'week' | 'all'>('week');

  useEffect(() => bindBackButton(onExit), [onExit]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .me()
        .then((r) => alive && setMe(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
      api
        .rivals()
        .then((r) => alive && setRiv(r))
        .catch(() => {}); // v0.2 server: tab stays empty
    };
    load();
    const t = window.setInterval(() => !document.hidden && load(), 8000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const duels = me?.duels ?? [];
  const order = (d: DuelSummary) => (d.status === 'active' && d.yourTurn ? 0 : d.status === 'active' ? 1 : d.status === 'open' ? 2 : 3);
  const sorted = [...duels].sort((a, b) => order(a) - order(b) || b.updatedAt - a.updatedAt);
  const boards = me?.boards ?? null;
  const tabs: [Tab, string][] = [
    ['duels', 'Дуэли'],
    ['rivals', 'Соперники'],
    ...(boards ? ([['chat', 'Чат']] as [Tab, string][]) : []),
    ['bones', 'Кости'],
  ];

  return (
    <div className="screen duels">
      <header className="lab-head">
        <button className="btn btn-ghost" onClick={onExit}>
          ← Меню
        </button>
        <h1>Мои дуэли</h1>
        {me?.wallet && <span className="bones-inline">🦴 {me.wallet.balance}</span>}
      </header>

      <button className="btn btn-primary btn-challenge" onClick={onChallenge} disabled={challengeBusy}>
        {challengeBusy ? 'Готовим вызов…' : '🥊 Вызвать друга'}
      </button>

      <nav className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {!me && !error && <p className="muted loading-dots">Загружаем</p>}

      {tab === 'duels' && (
        <>
          {me && sorted.length === 0 && (
            <p className="muted empty">Пока ни одной дуэли. Брось вызов другу — бот напишет, когда вызов примут.</p>
          )}
          <ul className="duel-list">
            {sorted.map((d) => (
              <li key={d.id}>
                <button className={`duel-item ${d.status === 'active' && d.yourTurn ? 'hot' : ''}`} onClick={() => onOpenDuel(d.id)}>
                  <Avatar p={d.opponent} corner={d.me === 0 ? 'blue' : 'red'} />
                  <span className="duel-main">
                    <b>{d.opponent ? `vs ${d.opponent.name}` : 'Открытый вызов'}</b>
                    <small>{d.status === 'open' ? 'ссылка отправлена' : `HP ${d.hp[d.me]} : ${d.hp[d.me === 0 ? 1 : 0]}`}</small>
                  </span>
                  {statusChip(d)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'rivals' && (
        <section className="card leaderboard">
          <h2>Мои соперники</h2>
          {!riv?.rivals.length && <p className="muted empty">Здесь появятся те, с кем ты уже дрался.</p>}
          <ol>
            {riv?.rivals.map((r) => (
              <li key={r.opponent.id} className="lb-row">
                <Avatar p={r.opponent} corner="blue" />
                <span className="lb-name">
                  {r.opponent.name}
                  <small>
                    WR {pct(r.winRate)} · ничьих {r.draws}
                    {r.friendly.wins + r.friendly.losses + r.friendly.draws > 0 &&
                      ` · дружеских ${r.friendly.wins}:${r.friendly.losses}${r.friendly.draws ? `:${r.friendly.draws}` : ''}`}
                  </small>
                </span>
                <span className="lb-wins h2h">
                  {r.wins} : {r.losses}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tab === 'chat' && boards && me && (
        <section className="card leaderboard">
          <h2>
            <Crown className="lb-crown" /> Чемпион чата
          </h2>
          <div className="seg">
            <button className={`tab ${win === 'week' ? 'on' : ''}`} onClick={() => setWin('week')}>
              Неделя
            </button>
            <button className={`tab ${win === 'all' ? 'on' : ''}`} onClick={() => setWin('all')}>
              Всё время
            </button>
          </div>
          <p className="muted small">
            {win === 'week'
              ? `С понедельника ${new Date(boards.weekStart).toISOString().slice(0, 10)} (UTC), только рейтинговые бои`
              : 'Все рейтинговые бои + результаты v0.2 (отмечены)'}
          </p>
          <Board rows={win === 'week' ? boards.week : boards.all} meId={me.user.id} />
        </section>
      )}

      {tab === 'bones' && (
        <section className="card leaderboard">
          <h2>🦴 Кости: {me?.wallet?.balance ?? '—'}</h2>
          <p className="muted small">+100 за победу, −50 за поражение в рейтинговом бою. Баланс не уходит ниже нуля, играть можно и с нулём.</p>
          <ol className="ledger">
            {riv?.ledger.map((e) => (
              <li key={e.key} className="lb-row">
                <span className="lb-name">
                  {ledgerLabel(e.reason)}
                  <small>
                    {new Date(e.at).toLocaleString('ru')}
                    {e.actual !== e.nominal && ` · начислено ${e.actual} из ${e.nominal}`}
                  </small>
                </span>
                <span className={`lb-wins ${e.actual > 0 ? 'plus' : e.actual < 0 ? 'minus' : ''}`}>
                  {e.actual > 0 ? '+' : ''}
                  {e.actual}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
