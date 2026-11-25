import { useState } from 'react';
import type { GameMode } from './engine';
import { parseSeed } from './engine';
import { BattleScreen } from './ui/screens/BattleScreen';
import { LabScreen } from './ui/screens/LabScreen';
import { MenuScreen } from './ui/screens/MenuScreen';

type Screen = { name: 'menu' } | { name: 'battle'; mode: GameMode; id: number } | { name: 'lab' };

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
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [debug, setDebugState] = useState(readDebugFlag);
  const setDebug = (v: boolean) => {
    setDebugState(v);
    try {
      window.localStorage.setItem('dfc.debug', v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="app-shell">
      <div className="phone">
        {screen.name === 'menu' && (
          <MenuScreen
            debug={debug}
            setDebug={setDebug}
            onPlay={(mode) => setScreen({ name: 'battle', mode, id: Date.now() })}
            onLab={() => setScreen({ name: 'lab' })}
          />
        )}
        {screen.name === 'battle' && (
          <BattleScreen
            key={screen.id}
            mode={screen.mode}
            seed={readSeed()}
            debug={debug}
            onExit={() => setScreen({ name: 'menu' })}
          />
        )}
        {screen.name === 'lab' && <LabScreen onBack={() => setScreen({ name: 'menu' })} />}
      </div>
    </div>
  );
}
