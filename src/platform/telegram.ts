/**
 * Thin Telegram Mini App adapter. Outside Telegram every function is a no-op
 * (haptics fall back to navigator.vibrate), so the game runs in a normal browser too.
 */
interface TgWebApp {
  initData: string;
  platform: string;
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
