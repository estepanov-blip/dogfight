/**
 * Presentation mapping: engine TurnRecord -> what to show (captions, poses,
 * floating numbers). Pure functions, no React — unit-tested separately.
 */
import type { GameMode, PlayerIndex, SymbolId, TurnRecord } from '../engine';
import shibaImg from '../assets/game/shiba.png';
import bullImg from '../assets/game/bull.png';
import punchImg from '../assets/game/sym_punch.png';
import critImg from '../assets/game/sym_critical.png';
import blockImg from '../assets/game/sym_block.png';
import healImg from '../assets/game/sym_heal.png';
import extraImg from '../assets/game/sym_extra.png';
import missImg from '../assets/game/sym_miss.png';
import ringImg from '../assets/game/ring.jpg';
import chihImg from '../assets/game/fighters/chih.png';
import puzanImg from '../assets/game/fighters/puzan.png';
import psikhImg from '../assets/game/fighters/psikh.png';
import heavyImg from '../assets/game/fighters/heavy.png';
import kolbasaImg from '../assets/game/fighters/kolbasa.png';
import pushokImg from '../assets/game/fighters/pushok.png';
import { CHARACTERS, characterById } from '../online/v03';
import type { DuelView } from '../online/protocol';

export const RING_IMG = ringImg;

export const SYMBOL_IMG: Record<SymbolId, string> = {
  punch: punchImg,
  critical: critImg,
  block: blockImg,
  heal: healImg,
  extra: extraImg,
  miss: missImg,
};

export const SYMBOL_NAME: Record<SymbolId, string> = {
  punch: 'Удар',
  critical: 'Крит',
  block: 'Блок',
  heal: 'Лечение',
  extra: 'Доп. ход',
  miss: 'Промах',
};

export interface FighterLook {
  sprite: string;
  /** Source sprite faces right; flip when standing on the right side. */
  flip: boolean;
  corner: 'red' | 'blue';
  breed: string;
}

export const FIGHTER_LOOK: [FighterLook, FighterLook] = [
  { sprite: shibaImg, flip: false, corner: 'red', breed: 'Сиба' },
  { sprite: bullImg, flip: true, corner: 'blue', breed: 'Буль' },
];

/** Asset map: character id -> sprite (FC-18). Unknown ids fall back to Шиба/Буль by side. */
export const FIGHTER_SPRITES: Record<string, string> = {
  shiba: shibaImg,
  bull: bullImg,
  chih: chihImg,
  puzan: puzanImg,
  psikh: psikhImg,
  heavy: heavyImg,
  kolbasa: kolbasaImg,
  pushok: pushokImg,
};

/** Look of a character on a side: left faces right, right is mirrored; corner colour by side. */
export function lookFor(id: string | null | undefined, side: 0 | 1): FighterLook {
  const c = characterById(id);
  const fallback = FIGHTER_LOOK[side];
  return {
    sprite: (c && FIGHTER_SPRITES[c.assetKey]) || fallback.sprite,
    flip: side === 1,
    corner: side === 0 ? 'red' : 'blue',
    breed: c?.name ?? fallback.breed,
  };
}

export { CHARACTERS };

export function fighterNames(mode: GameMode): [string, string] {
  return mode === 'bot' ? ['ТЫ', 'САНЯ'] : ['СИБА', 'БУЛЬ'];
}

export type Pose =
  | 'idle'
  | 'punch'
  | 'crit'
  | 'hit'
  | 'hitHard'
  | 'blockHit'
  | 'guard'
  | 'heal'
  | 'self'
  | 'shrug'
  | 'ko'
  | 'win';

export type CaptionKind = 'hit' | 'crit' | 'block' | 'heal' | 'extra' | 'miss' | 'ko' | 'combo' | 'draw';

export interface Caption {
  text: string;
  sub?: string;
  kind: CaptionKind;
}

export type FloatKind = 'dmg' | 'heal' | 'shield' | 'block' | 'extra' | 'self' | 'info';
export interface FloatSpec {
  side: PlayerIndex;
  text: string;
  kind: FloatKind;
  big?: boolean;
}

const TRIPLE_CAPTION: Record<SymbolId, { text: string; kind: CaptionKind }> = {
  punch: { text: 'КОМБО x3!', kind: 'combo' },
  critical: { text: 'СУПЕРУДАР!', kind: 'crit' },
  block: { text: 'ПОЛНАЯ ЗАЩИТА!', kind: 'block' },
  heal: { text: 'ВОССТАНОВЛЕНИЕ!', kind: 'heal' },
  extra: { text: 'ДВОЙНОЙ ХОД!', kind: 'extra' },
  miss: { text: 'САМОУДАР!', kind: 'miss' },
};

/** The big comic caption for a spin. */
export function captionFor(r: TurnRecord): Caption {
  const hp = (n: number) => `−${n} HP`;
  if (r.combo.triple) {
    const t = TRIPLE_CAPTION[r.combo.triple];
    let sub: string | undefined;
    if (r.damageDealt > 0) sub = hp(r.damageDealt);
    else if (r.absorbed > 0) sub = 'всё в блок!';
    else if (r.selfDamage > 0) sub = hp(r.selfDamage);
    else if (r.healed > 0) sub = `+${r.healed} HP`;
    else if (r.shieldGained > 0) sub = `щит ${r.shieldGained}`;
    else if (r.extraGranted > 0) sub = `+${r.extraGranted} хода`;
    return { text: t.text, kind: t.kind, sub };
  }
  const hasCrit = r.combo.symbols.includes('critical');
  if (r.damageDealt > 0) {
    return { text: hasCrit ? 'КРИТ!' : 'ПРОПУСТИЛ!', kind: hasCrit ? 'crit' : 'hit', sub: hp(r.damageDealt) };
  }
  if (r.absorbed > 0) return { text: 'БЛОК!', kind: 'block', sub: `−${r.absorbed} в щит` };
  if (r.healed > 0) return { text: 'ХИЛ!', kind: 'heal', sub: `+${r.healed} HP` };
  if (r.shieldGained > 0) return { text: 'В ЗАЩИТУ!', kind: 'block', sub: `щит ${r.shieldGained}` };
  if (r.extraGranted > 0) return { text: 'ЕЩЁ ХОД!', kind: 'extra' };
  return { text: 'МИМО!', kind: 'miss' };
}

export function posesFor(r: TurnRecord): { actor: Pose; target: Pose } {
  const hasCrit = r.combo.symbols.includes('critical');
  let actor: Pose = 'shrug';
  if (r.damageAttempted > 0) actor = hasCrit ? 'crit' : 'punch';
  else if (r.selfDamage > 0) actor = 'self';
  else if (r.healed > 0) actor = 'heal';
  else if (r.shieldGained > 0) actor = 'guard';
  let target: Pose = 'idle';
  if (r.damageDealt >= 30) target = 'hitHard';
  else if (r.damageDealt > 0) target = 'hit';
  else if (r.absorbed > 0) target = 'blockHit';
  return { actor, target };
}

export function floatsFor(r: TurnRecord): FloatSpec[] {
  const out: FloatSpec[] = [];
  const target = (r.actor === 0 ? 1 : 0) as PlayerIndex;
  if (r.absorbed > 0) out.push({ side: target, text: `🛡 −${r.absorbed}`, kind: 'block' });
  if (r.damageDealt > 0) out.push({ side: target, text: `−${r.damageDealt}`, kind: 'dmg', big: r.damageDealt >= 30 });
  if (r.selfDamage > 0) out.push({ side: r.actor, text: `−${r.selfDamage}`, kind: 'self', big: true });
  if (r.healed > 0) out.push({ side: r.actor, text: `+${r.healed}`, kind: 'heal' });
  if (r.combo.effect.heal > 0 && r.healed === 0) out.push({ side: r.actor, text: 'HP макс.', kind: 'info' });
  if (r.shieldGained > 0) out.push({ side: r.actor, text: `🛡 ${r.shieldGained}`, kind: 'shield' });
  if (r.extraGranted > 0) out.push({ side: r.actor, text: `⚡ +${r.extraGranted} ход`, kind: 'extra' });
  return out;
}

/** Plain-text line for the battle log. */
export function describeTurn(r: TurnRecord, names: [string, string]): string {
  const me = names[r.actor];
  const them = names[r.actor === 0 ? 1 : 0];
  const parts: string[] = [];
  if (r.shieldExpired > 0) parts.push(`щит ${r.shieldExpired} сгорел`);
  if (r.combo.triple) parts.push(`ТРОЙКА «${SYMBOL_NAME[r.combo.triple]}»`);
  if (r.damageAttempted > 0) {
    let s = `${them}: −${r.damageDealt} HP`;
    if (r.absorbed > 0) s += ` (щит поглотил ${r.absorbed})`;
    parts.push(s);
  }
  if (r.selfDamage > 0) parts.push(`${me}: самоурон −${r.selfDamage}`);
  if (r.healed > 0 || r.overheal > 0) parts.push(`+${r.healed} HP${r.overheal ? ` (сверх лимита ${r.overheal})` : ''}`);
  if (r.shieldGained > 0) parts.push(`щит ${r.shieldGained}`);
  if (r.extraGranted > 0) parts.push(`доп. ход +${r.extraGranted}`);
  if (r.extraWasted > 0) parts.push(`доп. ход сгорел ×${r.extraWasted}`);
  if (parts.length === 0) parts.push('ничего');
  return parts.join(' · ');
}

/** Result title from the point of view of `me` (null = neutral, e.g. hot-seat). */
export function outcomeTitle(
  outcome: PlayerIndex | 'draw',
  endReason: string,
  me: PlayerIndex | null,
): { title: string; kind: 'ko' | 'win' | 'lose' | 'draw' } {
  if (outcome === 'draw') return { title: endReason === 'doubleKo' ? 'ДВОЙНОЙ НОКАУТ!' : 'НИЧЬЯ!', kind: 'draw' };
  if (endReason === 'timeout') {
    if (me === null) return { title: 'ВРЕМЯ ВЫШЛО', kind: 'win' };
    return outcome === me ? { title: 'ПОБЕДА!', kind: 'win' } : { title: 'ТЕХНИЧЕСКОЕ ПОРАЖЕНИЕ', kind: 'lose' };
  }
  if (endReason === 'forfeit') {
    if (me === null) return { title: 'СДАЧА!', kind: 'win' };
    return outcome === me ? { title: 'ПОБЕДА!', kind: 'win' } : { title: 'БОЙ СДАН', kind: 'lose' };
  }
  if (endReason === 'spinLimit') {
    if (me !== null) return outcome === me ? { title: 'ПОБЕДА!', kind: 'win' } : { title: 'ПОРАЖЕНИЕ', kind: 'lose' };
    return { title: 'ПО ОЧКАМ!', kind: 'win' };
  }
  if (me !== null && outcome !== me) return { title: 'ТЕБЯ ВЫРУБИЛИ!', kind: 'lose' };
  return { title: 'НОКАУТ!', kind: 'ko' };
}

// ---------------------------------------------------------------- online duel names

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

