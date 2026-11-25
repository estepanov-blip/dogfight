/**
 * ПРОПУСТИЛ! duel server — Cloudflare Worker.
 * Serves the built game (static assets from dist/) and the duel API on the same origin.
 *
 *   GET  /api/health              — is the server configured
 *   GET  /api/setup               — one-time: webhook, menu button, commands
 *   POST /tg/webhook              — Telegram updates (/start)
 *   GET  /api/me                  — profile, my duels, chat leaderboard
 *   POST /api/duels               — create an open challenge (+ prepared share message)
 *   GET  /api/duels/:id           — duel state
 *   POST /api/duels/:id/accept|spin|forfeit|rematch|share|auto
 *   POST /api/profile             — choose a fighter (v0.3, DFC-004)
 *   GET  /api/rivals              — "Мои соперники" + bones ledger (v0.3, DFC-003)
 *   POST /api/dev/duels/:id/shift — local tests only (DEV_MODE=1)
 *
 * All /api/* calls except health/setup require `Authorization: tma <initData>`.
 */
import { GameStore, type DuelOp, type StoreApi } from './store';
import { createDuel, newDuelId, playerIndex, toSummary, toView, type DuelRecord } from './duel';
import type { Env } from './env';
import { BotApi, escapeHtml, validateInitData, webhookSecret, type InitDataInfo } from './telegram';
import type { CreateDuelResponse, HeadToHead, MeResponse, PlayerInfo, RivalsResponse, SpinResponse } from '../src/online/protocol';
import { isCharacterId } from '../src/online/v03';
import { other } from '../src/engine';

export { GameStore };
export type { Env };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status: number, error: string, message: string) => json({ error, message }, status);

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

const tg = (env: Env) => new BotApi(env.BOT_TOKEN, env.TG_API_BASE || undefined);

let botUsernameCache: string | null = null;
async function botUsername(env: Env): Promise<string> {
  if (botUsernameCache) return botUsernameCache;
  try {
    const me = await tg(env).call<{ username: string }>('getMe');
    botUsernameCache = me.username;
    return me.username;
  } catch {
    return 'bot'; // Telegram unreachable: links degrade, the game keeps working
  }
}

const store = (env: Env, name: string) => env.STORE.getByName(name) as unknown as StoreApi;

function duelLink(bot: string, id: string) {
  return `https://t.me/${bot}?startapp=d_${id}`;
}

async function authenticate(req: Request, env: Env): Promise<InitDataInfo | null> {
  const h = req.headers.get('authorization') ?? '';
  const initData = h.startsWith('tma ') ? h.slice(4) : '';
  return validateInitData(initData, env.BOT_TOKEN, Math.floor(Date.now() / 1000));
}

async function saveSummaries(env: Env, d: DuelRecord) {
  const jobs: Promise<unknown>[] = [];
  for (const p of d.players) {
    if (!p) continue;
    const s = toSummary(d, p.id);
    if (s) jobs.push(store(env, `user:${p.id}`).upsertSummary(s));
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- share message
async function prepareShare(env: Env, user: PlayerInfo, d: DuelRecord, origin: string): Promise<string | null> {
  try {
    const bot = await botUsername(env);
    const res = await tg(env).call<{ id: string }>('savePreparedInlineMessage', {
      user_id: user.id,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_bot_chats: false,
      allow_channel_chats: false,
      result: {
        type: 'photo',
        id: d.id,
        photo_url: `${origin}/share.jpg`,
        thumbnail_url: `${origin}/share.jpg`,
        caption: `🥊 <b>${escapeHtml(user.name)}</b> вызывает тебя на бой!\nПринимай вызов — посмотрим, кто пропустит.`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🥊 Принять вызов', url: duelLink(bot, d.id) }]] },
      },
    });
    return res.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- handlers
async function handleApi(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/health') {
    return json({ ok: true, configured: !!env.BOT_TOKEN });
  }
  if (path === '/api/setup') {
    if (!env.BOT_TOKEN) return fail(500, 'no_token', 'Секрет BOT_TOKEN не задан в настройках Worker');
    const bot = tg(env);
    const me = await bot.call<{ username: string }>('getMe');
    await bot.call('setWebhook', {
      url: `${origin}/tg/webhook`,
      secret_token: await webhookSecret(env.BOT_TOKEN),
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    await bot.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Драться', web_app: { url: origin } } });
    await bot.call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть ринг' }] });
    return json({
      ok: true,
      bot: `@${me.username}`,
      app: origin,
      next: `В @BotFather: /mybots → @${me.username} → Bot Settings → Configure Mini App → укажи ${origin}`,
    });
  }

  if (!env.BOT_TOKEN) return fail(503, 'no_token', 'Сервер дуэлей не настроен');
  const auth = await authenticate(req, env);
  if (!auth) return fail(401, 'unauthorized', 'Открой игру из Telegram');
  const user = auth.user;
  const now = Date.now();
  const groupChat = auth.chatType === 'group' || auth.chatType === 'supergroup' ? auth.chatInstance : null;

  if (path === '/api/me' && req.method === 'GET') {
    const me = store(env, `user:${user.id}`);
    const [duels, wallet, profile, boards, bot] = await Promise.all([
      me.listSummaries(),
      me.wallet(now), // first access grants the starting 500 once
      me.profile(),
      groupChat ? store(env, `chat:${groupChat}`).boards(now) : Promise.resolve(null),
      botUsername(env),
    ]);
    return json({ user, bot, duels, leaderboard: boards ? boards.all.slice(0, 20) : null, wallet, profile, boards } satisfies MeResponse);
  }

  if (path === '/api/profile' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { fighter?: unknown };
    if (!isCharacterId(body.fighter)) return fail(400, 'bad_fighter', 'Такого бойца нет');
    return json(await store(env, `user:${user.id}`).setProfile(body.fighter));
  }

  if (path === '/api/rivals' && req.method === 'GET') {
    const me = store(env, `user:${user.id}`);
    const [rivals, ledger] = await Promise.all([me.rivals(), me.ledger()]);
    return json({ rivals, ledger } satisfies RivalsResponse);
  }

  const dev = path.match(/^\/api\/dev\/duels\/([A-Za-z0-9]{6,32})\/shift$/);
  if (dev) {
    if (env.DEV_MODE !== '1') return fail(404, 'not_found', 'Нет такого метода');
    const body = (await req.json().catch(() => ({}))) as { ms?: number };
    const r = await store(env, `duel:${dev[1]}`).mutate({ type: 'devShift', ms: Number(body.ms) || 0, now, origin });
    return r.ok ? json({ ok: true, turnDueAt: r.duel.turnDueAt }) : fail(r.status, r.code, r.message);
  }

  if (path === '/api/duels' && req.method === 'POST') {
    const d = createDuel(newDuelId(random), user, randomSeed(), now, origin);
    await store(env, `duel:${d.id}`).putDuel(d);
    await saveSummaries(env, d);
    const [prepared, bot] = await Promise.all([prepareShare(env, user, d, origin), botUsername(env)]);
    return json({ duel: toView(d, user.id, duelLink(bot, d.id)), prepared } satisfies CreateDuelResponse, 201);
  }

  const m = path.match(/^\/api\/duels\/([A-Za-z0-9]{6,32})(?:\/(accept|spin|forfeit|rematch|share|auto))?$/);
  if (!m) return fail(404, 'not_found', 'Нет такого метода');
  const [, id, action] = m;
  const stub = store(env, `duel:${id}`);
  const bot = await botUsername(env);

  if (!action && req.method === 'GET') {
    const r = await stub.mutate({ type: 'touch', userId: user.id, now, origin });
    if (!r.ok) return fail(r.status, r.code, r.message);
    let d = r.duel;
    if (r.changed) ctx.waitUntil(saveSummaries(env, d));
    if (d.result?.settlement.state === 'pending') d = (await stub.settleNow()) ?? d; // fresh result screen
    return json(toView(d, user.id, duelLink(bot, id), await h2hFor(env, d, user.id)));
  }
  if (req.method !== 'POST') return fail(405, 'method', 'POST only');

  if (action === 'share') {
    const d = await stub.getDuel();
    if (!d) return fail(404, 'not_found', 'Бой не найден');
    return json({ prepared: await prepareShare(env, user, d, origin) });
  }

  const body = (await req.json().catch(() => ({}))) as { expected?: number; on?: boolean };
  let op: DuelOp;
  if (action === 'accept') {
    const d = await stub.getDuel();
    if (!d) return fail(404, 'not_found', 'Бой не найден');
    op = { type: 'accept', user, now, chatInstance: groupChat, fighters: await profileFighters(env, d.players[0].id, user.id), origin };
  } else if (action === 'spin') op = { type: 'spin', userId: user.id, expected: Number(body.expected), now, origin };
  else if (action === 'forfeit') op = { type: 'forfeit', userId: user.id, now, origin };
  else if (action === 'auto') op = { type: 'auto', userId: user.id, on: !!body.on, now, origin };
  else {
    const d = await stub.getDuel();
    if (!d) return fail(404, 'not_found', 'Бой не найден');
    const fighters: [string | null, string | null] = d.players[1] ? await profileFighters(env, d.players[0].id, d.players[1].id) : [null, null];
    op = { type: 'rematch', userId: user.id, newId: newDuelId(random), seed: randomSeed(), now, fighters, origin };
  }

  const r = await stub.mutate(op);
  if (!r.ok) return fail(r.status, r.code, r.message);
  if (r.next) await store(env, `duel:${r.next.id}`).putDuel(r.next);
  if (r.changed) {
    ctx.waitUntil(saveSummaries(env, r.duel));
    if (r.next) ctx.waitUntil(saveSummaries(env, r.next));
  }

  if (op.type === 'rematch') return json({ id: r.duel.rematchId });
  let d = r.duel;
  if (d.result?.settlement.state === 'pending') d = (await stub.settleNow()) ?? d;
  const view = toView(d, user.id, duelLink(bot, id), await h2hFor(env, d, user.id));
  if (op.type === 'spin') return json({ duel: view, records: r.records, stale: r.stale } satisfies SpinResponse);
  return json(view);
}

/** Profile choices at this moment (null = never chose -> v0.2 role default). */
async function profileFighters(env: Env, challengerId: number, accepterId: number): Promise<[string | null, string | null]> {
  const [a, b] = await Promise.all([store(env, `user:${challengerId}`).profile(), store(env, `user:${accepterId}`).profile()]);
  return [a.fighter, b.fighter];
}

/** Rated head-to-head for the result screen (only once the fight is over). */
async function h2hFor(env: Env, d: DuelRecord, viewerId: number): Promise<HeadToHead | null> {
  const me = playerIndex(d, viewerId);
  if (d.status !== 'over' || me === null) return null;
  const opp = d.players[other(me)];
  return opp ? store(env, `user:${viewerId}`).headToHead(opp.id) : null;
}

async function handleWebhook(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(env.BOT_TOKEN))) {
    return new Response('forbidden', { status: 403 });
  }
  const update = (await req.json().catch(() => null)) as { message?: { chat: { id: number }; text?: string } } | null;
  const msg = update?.message;
  if (msg?.text?.startsWith('/start')) {
    await tg(env)
      .call('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text:
          '🥊 <b>ПРОПУСТИЛ! Dog Fight Club</b>\n\nКрути барабаны, бей соперника, требуй реванш.\n' +
          'Вызови друга — и бот напишет, когда твой ход.',
        reply_markup: { inline_keyboard: [[{ text: '🥊 Драться', web_app: { url: url.origin } }]] },
      })
      .catch(() => {});
  }
  return new Response('ok');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, env, ctx, url);
      if (url.pathname === '/tg/webhook' && req.method === 'POST') return await handleWebhook(req, env, url);
    } catch (e) {
      return fail(500, 'server', e instanceof Error ? e.message : 'Ошибка сервера');
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
