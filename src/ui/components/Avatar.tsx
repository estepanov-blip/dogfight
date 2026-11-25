import { useState } from 'react';
import type { PlayerInfo } from '../../online/protocol';

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

