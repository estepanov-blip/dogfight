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
 *   POST /api/duels/:id/accept|spin|forfeit|rematch|share
 *
 * All /api/* calls except health/setup require `Authorization: tma <initData>`.
 */
import { GameStore, type DuelOp, type DuelOpResult, type StoreApi } from './store';
import { createDuel, isOnline, newDuelId, toSummary, toView, type DuelRecord } from './duel';
import { BotApi, escapeHtml, validateInitData, webhookSecret, type InitDataInfo } from './telegram';
import type { CreateDuelResponse, MeResponse, PlayerInfo, SpinResponse } from '../src/online/protocol';

export { GameStore };

export interface Env {
  BOT_TOKEN: string;
  /** Optional: mock Bot API base URL for local tests. */
  TG_API_BASE?: string;
  STORE: DurableObjectNamespace<GameStore>;
  ASSETS: Fetcher;
}

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

// ---------------------------------------------------------------- notifications
async function notify(env: Env, origin: string, to: PlayerInfo, text: string, duelId: string, button = 'Открыть бой') {
  try {
    await tg(env).call('sendMessage', {
      chat_id: to.id,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: `🥊 ${button}`, web_app: { url: `${origin}/?duel=${duelId}` } }]] },
    });
  } catch {
    // user never opened the bot / did not allow messages — opt-in by design
  }
}

async function afterChange(env: Env, origin: string, r: Extract<DuelOpResult, { ok: true }>, op: DuelOp) {
  const d = r.duel;
  await saveSummaries(env, d);
  if (r.next) await saveSummaries(env, r.next);
  const [p0, p1] = d.players;
  if (!p1) return;
  const now = Date.now();
  const name = (p: PlayerInfo) => `<b>${escapeHtml(p.name)}</b>`;
  const b = d.battle;

  if (op.type === 'accept' && r.changed && b) {
    const first = b.current === 0 ? p0 : p1;
    await notify(env, origin, p0, `🥊 Вызов принят! ${name(p1)} на ринге. ${first.id === p0.id ? 'Ты бьёшь первым.' : `Первым бьёт ${name(first)}.`}`, d.id);
    return;
  }
  if (op.type === 'rematch' && r.next) {
    const opp = p0.id === op.userId ? p1 : p0;
    const asker = p0.id === op.userId ? p0 : p1;
    await notify(env, origin, opp, `🔁 ${name(asker)} требует реванш!`, r.next.id, 'Реванш');
    return;
  }
  if (!b) return;
  if (d.status === 'over' && r.prevDuel.status !== 'over') {
    const winner = b.outcome === 'draw' || b.outcome === null ? null : d.players[b.outcome]!;
    const loser = winner ? (winner.id === p0.id ? p1 : p0) : null;
    if (winner && loser && d.chatInstance) await store(env, `chat:${d.chatInstance}`).recordResult(winner, loser, d.id);
    for (const p of [p0, p1]) {
      if (isOnline(d, p.id, now)) continue;
      const text =
        winner === null
          ? `🤝 Ничья в бою ${name(p0)} vs ${name(p1)}.`
          : winner.id === p.id
            ? `🏆 Победа${b.endReason === 'forfeit' ? '! Соперник сдался.' : b.endReason === 'ko' ? ' нокаутом!' : ' по очкам!'}`
            : `💥 ПРОПУСТИЛ! Победа за ${name(winner)}. Реванш?`;
      await notify(env, origin, p, text, d.id, 'Смотреть / реванш');
    }
    return;
  }
  if (op.type === 'spin' && r.records.length) {
    const rec = r.records[r.records.length - 1];
    if (rec.nextActor !== null && rec.nextActor !== rec.actor) {
      const nextP = d.players[rec.nextActor]!;
      if (!isOnline(d, nextP.id, now)) {
        const by = d.players[rec.actor]!;
        const hit = rec.damageDealt > 0 ? `минус ${rec.damageDealt} HP тебе!` : 'ход сделан.';
        await notify(env, origin, nextP, `👊 ${name(by)}: ${hit} Твой ход.\nHP: ты ${b.fighters[rec.nextActor].hp} — ${b.fighters[rec.actor].hp}`, d.id, 'Ударить в ответ');
      }
    }
  }
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
        caption: `🥊 <b>${escapeHtml(user.name)}</b> вызывает тебя на бой!\nУдарь в ответ, пока он не убежал.`,
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
    const [duels, leaderboard, bot] = await Promise.all([
      store(env, `user:${user.id}`).listSummaries(),
      groupChat ? store(env, `chat:${groupChat}`).leaderboard() : Promise.resolve(null),
      botUsername(env),
    ]);
    return json({ user, bot, duels, leaderboard } satisfies MeResponse);
  }

  if (path === '/api/duels' && req.method === 'POST') {
    const d = createDuel(newDuelId(random), user, randomSeed(), now);
    await store(env, `duel:${d.id}`).putDuel(d);
    await saveSummaries(env, d);
    const [prepared, bot] = await Promise.all([prepareShare(env, user, d, origin), botUsername(env)]);
    return json({ duel: toView(d, user.id, duelLink(bot, d.id)), prepared } satisfies CreateDuelResponse, 201);
  }

  const m = path.match(/^\/api\/duels\/([A-Za-z0-9]{6,32})(?:\/(accept|spin|forfeit|rematch|share))?$/);
  if (!m) return fail(404, 'not_found', 'Нет такого метода');
  const [, id, action] = m;
  const stub = store(env, `duel:${id}`);
  const bot = await botUsername(env);

  if (!action && req.method === 'GET') {
    const r = await stub.mutate({ type: 'touch', userId: user.id, now });
    if (!r.ok) return fail(r.status, r.code, r.message);
    return json(toView(r.duel, user.id, duelLink(bot, id)));
  }
  if (req.method !== 'POST') return fail(405, 'method', 'POST only');

  if (action === 'share') {
    const d = await stub.getDuel();
    if (!d) return fail(404, 'not_found', 'Бой не найден');
    return json({ prepared: await prepareShare(env, user, d, origin) });
  }

  const body = (await req.json().catch(() => ({}))) as { expected?: number };
  let op: DuelOp;
  if (action === 'accept') op = { type: 'accept', user, now, chatInstance: groupChat };
  else if (action === 'spin') op = { type: 'spin', userId: user.id, expected: Number(body.expected), now };
  else if (action === 'forfeit') op = { type: 'forfeit', userId: user.id, now };
  else {
    const newId = newDuelId(random);
    op = { type: 'rematch', userId: user.id, newId, seed: randomSeed(), now };
  }

  const r = await stub.mutate(op);
  if (!r.ok) return fail(r.status, r.code, r.message);
  if (r.next) await store(env, `duel:${r.next.id}`).putDuel(r.next);
  if (r.changed) ctx.waitUntil(afterChange(env, origin, r, op));

  if (op.type === 'rematch') return json({ id: r.duel.rematchId });
  const view = toView(r.duel, user.id, duelLink(bot, id));
  if (op.type === 'spin') return json({ duel: view, records: r.records, stale: r.stale } satisfies SpinResponse);
  return json(view);
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
