"""End-to-end duel test: two fake Telegram users in two browser contexts.

Requires: `npx wrangler dev --port 8787` with .dev.vars (BOT_TOKEN=123456:TEST-token,
TG_API_BASE=http://127.0.0.1:8788) and `node scripts/qa/mock-telegram.mjs 8788 /tmp/tg-mock.jsonl`.
Usage: python3 -I scripts/qa/duel_e2e.py http://127.0.0.1:8787 /tmp/tg-mock.jsonl /tmp/duel-shots
"""
import hashlib, hmac, json, sys, time, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE, MOCK_LOG, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
TOKEN = "123456:TEST-token"
CHAT = "-4242"


def init_data(user, start_param=None, chat=True):
    fields = {"user": json.dumps(user, ensure_ascii=False, separators=(",", ":")), "auth_date": str(int(time.time()))}
    if chat:
        fields["chat_instance"] = CHAT
        fields["chat_type"] = "group"
    if start_param:
        fields["start_param"] = start_param
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(fields)


def fake_tg(init, user, start_param=None):
    return """
    window.__tg = { shared: [], back: null, write: 0 };
    const init = %s;
    window.Telegram = { WebApp: {
      initData: init, platform: 'ios', version: '9.0',
      initDataUnsafe: { start_param: %s, user: Object.assign(%s, { allows_write_to_pm: false }) },
      ready(){}, expand(){}, disableVerticalSwipes(){}, setHeaderColor(){}, setBackgroundColor(){}, setBottomBarColor(){},
      isVersionAtLeast(){ return true; },
      HapticFeedback: { impactOccurred(){}, notificationOccurred(){} },
      BackButton: { show(){}, hide(){}, onClick(f){ window.__tg.back = f; }, offClick(){} },
      shareMessage(id, cb){ window.__tg.shared.push(id); setTimeout(() => cb && cb(true), 50); },
      openTelegramLink(u){ window.__tg.shared.push(u); },
      requestWriteAccess(cb){ window.__tg.write++; cb && cb(true); },
    } };
    """ % (json.dumps(init), json.dumps(start_param), json.dumps(user, ensure_ascii=False))


def tg_calls():
    return [json.loads(l) for l in MOCK_LOG.read_text().splitlines() if l.strip()]


A = {"id": 1001, "first_name": "Саня", "username": "sanya"}
B = {"id": 2002, "first_name": "Кирилл"}
errors, report = [], {}

with sync_playwright() as p:
    br = p.chromium.launch()

    def page_for(user, start_param=None, url="/"):
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        ctx.route("**/telegram-web-app.js", lambda r: r.fulfill(body="", content_type="text/javascript"))
        ctx.add_init_script(fake_tg(init_data(user, start_param), user, start_param))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"{user['first_name']}: {e}"))
        pg.on("console", lambda m: errors.append(f"{user['first_name']} console: {m.text}") if m.type == "error" else None)
        pg.goto(BASE + url)
        return pg

    # 1. A challenges
    a = page_for(A)
    a.get_by_role("button", name="Вызвать друга").first.wait_for(timeout=8000)
    a.screenshot(path=OUT / "01_menu_online.png")
    a.get_by_role("button", name="Вызвать друга").first.click()
    a.get_by_text("Вызов брошен!").wait_for(timeout=8000)
    a.screenshot(path=OUT / "02_waiting.png")
    shared = a.evaluate("window.__tg.shared")
    prep = [c for c in tg_calls() if c["method"] == "savePreparedInlineMessage"]
    duel_id = prep[-1]["params"]["result"]["id"]
    report["shared"] = shared
    report["share_button_url"] = prep[-1]["params"]["result"]["reply_markup"]["inline_keyboard"][0][0]["url"]

    # 2. B opens the challenge link (start_param) and accepts
    b = page_for(B, start_param="d_" + duel_id)
    b.get_by_role("button", name="Принять вызов").wait_for(timeout=8000)
    b.screenshot(path=OUT / "03_challenge.png")
    b.get_by_role("button", name="Принять вызов").click()
    b.locator(".btn-spin").wait_for(timeout=8000)
    time.sleep(0.5)
    b.screenshot(path=OUT / "04_b_started.png")

    # 3. play the whole fight; whoever's button is enabled spins
    a.wait_for_selector(".btn-spin", timeout=10000)
    spins = {"A": 0, "B": 0}
    rejected = 0
    deadline = time.time() + 240
    while time.time() < deadline:
        if a.locator(".result").count() and b.locator(".result").count():
            break
        for name, pg in (("A", a), ("B", b)):
            btn = pg.locator(".btn-spin")
            if btn.count() and btn.is_enabled():
                # triple tap: only one spin may be accepted
                pg.evaluate("for (let i=0;i<3;i++) document.querySelector('.btn-spin')?.click()")
                spins[name] += 1
                if spins[name] == 2 and name == "A":
                    time.sleep(1.4)
                    pg.screenshot(path=OUT / "05_a_fight.png")
        time.sleep(0.4)
    report["spins_clicked"] = spins
    time.sleep(1.2)
    a.screenshot(path=OUT / "06_a_result.png")
    b.screenshot(path=OUT / "07_b_result.png")
    report["a_title"] = a.locator(".result-title").inner_text()
    report["b_title"] = b.locator(".result-title").inner_text()
    report["a_log"] = a.locator(".link-btn").last.inner_text()
    report["b_log"] = b.locator(".link-btn").last.inner_text()

    # server truth via API
    duel = a.evaluate(
        "async (id) => (await fetch('/api/duels/'+id, {headers:{authorization:'tma '+Telegram.WebApp.initData}})).json()", duel_id
    )
    report["server_spins"] = duel["battle"]["spinCount"]
    report["server_outcome"] = [duel["battle"]["outcome"], duel["battle"]["endReason"]]
    report["rng_hidden"] = duel["battle"]["rngState"] == 0 and duel["battle"]["seed"] == 0

    # 4. rematch: both press, both land in the same new duel
    a.get_by_role("button", name="Реванш").click()
    a.wait_for_selector(".btn-spin", timeout=8000)
    time.sleep(7)  # B's poll notices rematchId
    report["b_rematch_label"] = b.locator(".result .btn-primary").inner_text()
    b.locator(".result .btn-primary").click()
    b.wait_for_selector(".btn-spin", timeout=8000)
    time.sleep(1)
    ids = [
        pg.evaluate("async () => (await (await fetch('/api/me', {headers:{authorization:'tma '+Telegram.WebApp.initData}})).json()).duels.map(d=>d.id)")
        for pg in (a, b)
    ]
    report["same_rematch"] = ids[0][0] == ids[1][0]
    b.screenshot(path=OUT / "08_rematch.png")

    # 5. duel list + chat leaderboard
    a.locator(".subnav .btn-ghost").first.click()
    a.get_by_role("button", name="Мои дуэли").click()
    a.wait_for_selector(".duel-item", timeout=8000)
    time.sleep(0.5)
    a.screenshot(path=OUT / "09_duels.png")
    report["leaderboard"] = a.locator(".lb-row").all_inner_texts()

    # 6. forfeit in the rematch
    b.locator(".subnav button", has_text="Сдаться").click()
    b.locator(".subnav button", has_text="Точно сдаться").click()
    b.wait_for_selector(".result", timeout=8000)
    time.sleep(1)
    report["forfeit_title_b"] = b.locator(".result-title").inner_text()
    b.screenshot(path=OUT / "10_forfeit.png")

    calls = tg_calls()
    report["tg_methods"] = sorted({c["method"] for c in calls})
    report["messages"] = [c["params"]["text"][:70] for c in calls if c["method"] == "sendMessage"]
    br.close()

report["errors"] = errors
print(json.dumps(report, ensure_ascii=False, indent=1))
