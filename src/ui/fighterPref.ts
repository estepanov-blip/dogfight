import { isCharacterId } from '../online/v03';

const KEY = 'dfc.fighter';

/** Local cache of the chosen fighter (bot / hot-seat modes, offline). Server profile wins online. */
export function loadFighter(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isCharacterId(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveFighter(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: choice lives for this session only */
  }
}
