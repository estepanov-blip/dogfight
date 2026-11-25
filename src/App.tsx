import { useCallback, useEffect, useState } from 'react';
import type { GameMode } from './engine';
import { parseSeed } from './engine';
import { api, detectOnline } from './online/api';
import { getStartDuelId, requestWriteAccess, shareChallenge } from './platform/telegram';
import { BattleScreen } from './ui/screens/BattleScreen';
import { DuelScreen } from './ui/screens/DuelScreen';
import { DuelsScreen } from './ui/screens/DuelsScreen';
import { LabScreen } from './ui/screens/LabScreen';
import { MenuScreen } from './ui/screens/MenuScreen';
import { FighterScreen } from './ui/screens/FighterScreen';
import { loadFighter, saveFighter } from './ui/fighterPref';

type Screen =
  | { name: 'menu' }
  | { name: 'battle'; mode: GameMode; id: number }
  | { name: 'lab' }
  | { name: 'duel'; id: string }
  | { name: 'duels' }
  | { name: 'fighters' };

function readDebugFlag(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('debug')) return q.get('debug') !== '0';
    return window.localStorage.getItem('dfc.debug') === '1';
  } catch {
    return false;
  }
}

function readSeed(): number | undefined {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    return s ? parseSeed(s) : undefined;
  } catch {
    return undefined;
  }
}

export default function App() {
  const startDuel = getStartDuelId();
  const [screen, setScreen] = useState<Screen>(startDuel ? { name: 'duel', id: startDuel } : { name: 'menu' });
  const [debug, setDebugState] = useState(readDebugFlag);
  const [online, setOnline] = useState(false);
  const [myTurns, setMyTurns] = useState(0);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fighter, setFighter] = useState<string | null>(loadFighter);
  const [bones, setBones] = useState<number | null>(null);

  const setDebug = (v: boolean) => {
    setDebugState(v);
    try {
      window.localStorage.setItem('dfc.debug', v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    void detectOnline().then(setOnline);
  }, []);

  // "твой ход" badge on the menu
  useEffect(() => {
    if (!online || screen.name !== 'menu') return;
    api
      .me()
      .then((r) => {
        setMyTurns(r.duels.filter((d) => d.status === 'active' && d.yourTurn).length);
        if (r.wallet) setBones(r.wallet.balance);
        if (r.profile?.fighter) {
          setFighter(r.profile.fighter); // server profile wins over the local cache
          saveFighter(r.profile.fighter);
        }
      })
      .catch(() => {});
  }, [online, screen.name]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const challenge = useCallback(async () => {
    if (challengeBusy) return;
    setChallengeBusy(true);
    try {
      await requestWriteAccess(); // so the bot can say "вызов принят" / "твой ход"
      const { duel, prepared } = await api.create();
      await shareChallenge(prepared, duel.link, 'Вызываю тебя на бой! 🥊 Посмотрим, кто пропустит.');
      setScreen({ name: 'duel', id: duel.id });
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Не удалось создать вызов');
    } finally {
      setChallengeBusy(false);
    }
  }, [challengeBusy]);

  const toMenu = useCallback(() => setScreen({ name: 'menu' }), []);
  const openDuel = useCallback((id: string) => setScreen({ name: 'duel', id }), []);

  return (
    <div className="app-shell">
      <div className="phone">
        {screen.name === 'menu' && (
          <MenuScreen
            debug={debug}
            setDebug={setDebug}
            onPlay={(mode) => setScreen({ name: 'battle', mode, id: Date.now() })}
            onLab={() => setScreen({ name: 'lab' })}
            online={online}
            myTurns={myTurns}
            challengeBusy={challengeBusy}
            onChallenge={challenge}
            onDuels={() => setScreen({ name: 'duels' })}
            fighter={fighter}
            bones={online ? bones : null}
            onFighters={() => setScreen({ name: 'fighters' })}
          />
        )}
        {screen.name === 'battle' && (
          <BattleScreen
            key={screen.id}
            mode={screen.mode}
            seed={readSeed()}
            debug={debug}
            onExit={toMenu}
            fighters={[fighter ?? 'shiba', 'bull']}
          />
        )}
        {screen.name === 'lab' && <LabScreen onBack={toMenu} />}
        {screen.name === 'duel' && <DuelScreen key={screen.id} id={screen.id} onExit={toMenu} onOpenDuel={openDuel} />}
        {screen.name === 'duels' && (
          <DuelsScreen onExit={toMenu} onOpenDuel={openDuel} onChallenge={challenge} challengeBusy={challengeBusy} />
        )}
        {screen.name === 'fighters' && (
          <FighterScreen
            current={fighter}
            online={online}
            onBack={toMenu}
            onSaved={(id) => {
              setFighter(id);
              saveFighter(id);
              toMenu();
            }}
          />
        )}
        {toast && (
          <div className="toast" role="alert">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
