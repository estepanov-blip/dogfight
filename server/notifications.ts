/**
 * Bot messages (FC-19): gender-neutral, readable without a username.
 * Pure: decides WHAT to send; the Durable Object sends from its outbox.
 */
import { other, type PlayerIndex } from '../src/engine';
import type { PlayerInfo } from '../src/online/protocol';
import { TIMING_V03 } from '../src/online/v03';
import { autoOn, isOnline, type DuelRecord } from './duel';
import { escapeHtml } from './telegram';

export type OutboxKind = 'accept' | 'turn' | 'reminder' | 'final' | 'rematch';

export interface OutboxItem {
  key: string; // dedupe key, e.g. turn:12:1001
  kind: OutboxKind;
  to: number; // telegram user id
  duelId: string; // duel to open
  /** reminder offset (ms) */
  offset?: number;
  /** who triggered it (rematch asker / turn spinner) */
  by?: number;
}

const name = (p: PlayerInfo | null | undefined) => `<b>${escapeHtml(p?.name?.trim() || 'Соперник')}</b>`;

/** Notifications caused by a state change before -> after. */
export function plan(before: DuelRecord, after: DuelRecord, op: { type: string; userId?: number }, next: DuelRecord | null, now: number): OutboxItem[] {
  const out: OutboxItem[] = [];
  const [p0, p1] = after.players;
  if (!p1) return out;
  if (op.type === 'accept' && before.status === 'open' && after.status === 'active') {
    out.push({ key: `accept:${p0.id}`, kind: 'accept', to: p0.id, duelId: after.id });
  }
  if (op.type === 'rematch' && next && op.userId !== undefined) {
    const opp = p0.id === op.userId ? p1 : p0;
    out.push({ key: `rematch:${next.id}:${opp.id}`, kind: 'rematch', to: opp.id, duelId: next.id, by: op.userId });
  }
  if (after.status === 'over' && before.status !== 'over') {
    for (const p of [p0, p1]) {
      // the actor of the final move is looking at the screen; the other side is told
      if (op.userId === p.id || isOnline(after, p.id, now)) continue;
      out.push({ key: `final:${p.id}`, kind: 'final', to: p.id, duelId: after.id });
    }
    return out;
  }
  const b = after.battle;
  if (after.status === 'active' && b && before.battle && b.spinCount > before.battle.spinCount) {
    const last = b.log[b.log.length - 1];
    if (last && last.nextActor !== null && last.nextActor !== last.actor) {
      const nextP = after.players[last.nextActor]!;
      if (!isOnline(after, nextP.id, now) && !autoOn(after, nextP.id)) {
        out.push({ key: `turn:${b.spinCount}:${nextP.id}`, kind: 'turn', to: nextP.id, duelId: after.id, by: after.players[last.actor]!.id });
      }
    }
  }
  return out;
}

export function reminderItems(d: DuelRecord, offsets: number[]): OutboxItem[] {
  if (!d.battle || !offsets.length) return [];
  const p = d.players[d.battle.current];
  if (!p) return [];
  const offset = Math.max(...offsets); // several due at once (late alarm) -> one message
  return [{ key: `remind:${d.battle.spinCount}:${offset}:${p.id}`, kind: 'reminder', to: p.id, duelId: d.id, offset }];
}

function hoursLeft(offset: number) {
  return Math.max(1, Math.round((TIMING_V03.turnTimeoutMs - offset) / 3600_000));
}

/** Text + button, composed at send time from the CURRENT record (fresh deltas). */
export function compose(item: OutboxItem, d: DuelRecord): { text: string; button: string } {
  const me: PlayerIndex = d.players[0].id === item.to ? 0 : 1;
  const opp = d.players[other(me)];
  switch (item.kind) {
    case 'accept': {
      const first = d.battle?.current === 0 ? 'Первый удар за тобой.' : `Первым бьёт ${name(d.players[1])}.`;
      return { text: `🥊 Вызов принят! На ринге: ${name(d.players[1])}. ${first}`, button: 'Открыть бой' };
    }
    case 'turn': {
      const b = d.battle!;
      const last = b.log[b.log.length - 1];
      const hit = last && last.damageDealt > 0 ? `минус ${last.damageDealt} HP тебе!` : 'ход сделан.';
      return {
        text: `👊 ${name(opp)}: ${hit} Твой ход.\nHP: у тебя ${b.fighters[me].hp} — у соперника ${b.fighters[other(me)].hp}`,
        button: 'Ударить в ответ',
      };
    }
    case 'reminder':
      return {
        text: `⏰ Твой ход в бою против ${name(opp)}. Через ${hoursLeft(item.offset ?? 0)} ч — техническое поражение.`,
        button: 'Крутить',
      };
    case 'rematch':
      return { text: `🔁 ${name(opp)} зовёт на реванш!`, button: 'Реванш?' };
    case 'final': {
      const r = d.result;
      const delta = r?.deltas?.[item.to];
      const bones = r?.rated === 'friendly' ? ' Дружеский бой — без костей.' : delta && delta.actual !== 0 ? ` ${delta.actual > 0 ? '+' : ''}${delta.actual} костей.` : '';
      if (!r || r.outcome === 'draw') return { text: `🤝 Ничья в бою против ${name(opp)}.${bones}`, button: 'Реванш?' };
      const won = r.outcome === me;
      let text: string;
      if (r.reason === 'turn_timeout') text = won ? '🏆 Победа: у соперника вышло время хода.' : '⌛ Техническое поражение: время хода вышло.';
      else if (r.reason === 'surrender' || r.reason === 'early_surrender') text = won ? '🏳 Соперник сдаётся. Победа!' : '🏳 Бой сдан.';
      else if (won) text = r.reason === 'ko' ? '🏆 Победа! Нокаут!' : '🏆 Победа по очкам!';
      else text = `💥 ПРОПУСТИЛ! Победа за ${name(opp)}.`;
      return { text: text + bones, button: won ? 'Смотреть бой' : 'Реванш?' };
    }
  }
}
