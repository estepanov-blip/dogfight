/**
 * Thin Telegram Mini App adapter. Outside Telegram every function is a no-op
 * (haptics fall back to navigator.vibrate), so the game runs in a normal browser too.
 */
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { allows_write_to_pm?: boolean } };
  platform: string;
  version?: string;
  shareMessage?: (id: string, cb?: (sent: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  isVersionAtLeast?: (v: string) => boolean;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

function webApp(): TgWebApp | null {
  try {
    const w = window.Telegram?.WebApp;
    // The script defines WebApp everywhere; platform 'unknown' means "not inside Telegram".
    return w && w.platform && w.platform !== 'unknown' ? w : null;
  } catch {
    return null;
  }
}

export const isTelegram = () => webApp() !== null;

const BG = '#120f17';

export function initTelegram() {
  const tg = webApp();
  if (!tg) return;
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* method not supported by this client version */
    }
  };
  safe(() => tg.ready());
  safe(() => tg.expand());
  safe(() => tg.disableVerticalSwipes?.()); // swipe-down must not close the fight
  safe(() => tg.setHeaderColor?.(BG));
  safe(() => tg.setBackgroundColor?.(BG));
  safe(() => tg.setBottomBarColor?.(BG));
  document.documentElement.classList.add('in-telegram');
}

export type HapticKind = 'light' | 'heavy' | 'ko' | 'win';

export function haptic(kind: HapticKind) {
  const tg = webApp();
  try {
    if (tg?.HapticFeedback) {
      if (kind === 'ko') tg.HapticFeedback.notificationOccurred('error');
      else if (kind === 'win') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred(kind === 'heavy' ? 'heavy' : 'light');
      return;
    }
    navigator.vibrate?.(kind === 'light' ? 25 : kind === 'heavy' ? 70 : 150);
  } catch {
    /* not supported */
  }
}

/** Shows Telegram's native Back button while `onBack` is set. Returns a cleanup. */
export function bindBackButton(onBack: () => void): () => void {
  const bb = webApp()?.BackButton;
  if (!bb) return () => {};
  try {
    bb.onClick(onBack);
    bb.show();
  } catch {
    return () => {};
  }
  return () => {
    try {
      bb.offClick(onBack);
      bb.hide();
    } catch {
      /* ignore */
    }
  };
}

// ---------------------------------------------------------------- online helpers

export function getInitData(): string {
  return webApp()?.initData ?? '';
}

/** Duel id from `startapp=d_<id>` (group/chat links) or `?duel=<id>` (bot buttons). */
export function getStartDuelId(): string | null {
  try {
    const sp = webApp()?.initDataUnsafe?.start_param ?? '';
    if (sp.startsWith('d_')) return sp.slice(2);
    const q = new URLSearchParams(window.location.search).get('duel');
    return q && /^[A-Za-z0-9]{6,32}$/.test(q) ? q : null;
  } catch {
    return null;
  }
}

/** Opt-in: lets the bot message the player ("твой ход"). Asked once, only when it matters. */
export function requestWriteAccess(): Promise<boolean> {
  const tg = webApp();
  if (!tg?.requestWriteAccess) return Promise.resolve(false);
  if (tg.initDataUnsafe?.user?.allows_write_to_pm) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      tg.requestWriteAccess!((ok) => resolve(!!ok));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Sends the challenge to a chat chosen by the player. Prefers the native
 * prepared-message sheet (Bot API 8.0); falls back to the t.me share link.
 */
export function shareChallenge(prepared: string | null, link: string, text: string): Promise<boolean> {
  const tg = webApp();
  return new Promise((resolve) => {
    try {
      if (prepared && tg?.shareMessage && (tg.isVersionAtLeast?.('8.0') ?? true)) {
        tg.shareMessage(prepared, (sent) => resolve(!!sent));
        return;
      }
    } catch {
      /* fall through */
    }
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
    } catch {
      /* ignore */
    }
    resolve(true);
  });
}
