"""Fighter Pack v0.3 migration: placeholder fighters chosen on production v0.3 (80bd54f)
must survive the update. Run `seed` against the old build, then `check` against the new build
with the same `wrangler dev --persist-to` directory.

Usage: python3 -I scripts/qa/fighter_migration_e2e.py <base_url> seed|check <state.json> [shots_dir]
"""
import hashlib, hmac, json, sys, time, urllib.parse, urllib.request
from pathlib import Path

BASE, PHASE, STATE = sys.argv[1], sys.argv[2], Path(sys.argv[3])
SHOTS = Path(sys.argv[4]) if len(sys.argv) > 4 else None
TOKEN = "123456:TEST-token"
U = {"id": 7101, "first_name": "Уля"}
V = {"id": 7202, "first_name": "Вова"}
out = []


def check(name, ok, detail=""):
    out.append({"phase": PHASE, "check": name, "result": "Passed" if ok else "Failed", "detail": str(detail)[:200]})


def init(u):
    f = {"user": json.dumps(u, separators=(",", ":"), ensure_ascii=False), "auth_date": str(int(time.time()))}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(f.items()))
    s = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    f["hash"] = hmac.new(s, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(f)


def call(u, method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": "tma " + init(u), "content-type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        return {"status": e.code, **json.loads(e.read() or b"{}")}


if PHASE == "seed":
    check("old build accepts placeholder 'kolbasa'", call(U, "POST", "/api/profile", {"fighter": "kolbasa"}).get("fighter") == "kolbasa")
    check("old build accepts placeholder 'heavy'", call(V, "POST", "/api/profile", {"fighter": "heavy"}).get("fighter") == "heavy")
    d = call(U, "POST", "/api/duels")["duel"]
    v = call(V, "POST", f"/api/duels/{d['id']}/accept")
    check("duel snapshot holds placeholder ids", v.get("fighters") == ["kolbasa", "heavy"], v.get("fighters"))
    STATE.write_text(json.dumps({"duel": d["id"]}))
else:
    st = json.loads(STATE.read_text())
    me_u = call(U, "GET", "/api/me")
    me_v = call(V, "GET", "/api/me")
    check("profile 'kolbasa' migrates to 'boxer' (Бокс)", me_u.get("profile", {}).get("fighter") == "boxer", me_u.get("profile"))
    check("profile 'heavy' migrates to 'doberman' (Добби)", me_v.get("profile", {}).get("fighter") == "doberman", me_v.get("profile"))
    check("migration is persisted (second read)", call(U, "GET", "/api/me").get("profile", {}).get("fighter") == "boxer")
    dv = call(U, "GET", f"/api/duels/{st['duel']}")
    check("started duel keeps its snapshot", dv.get("fighters") == ["kolbasa", "heavy"], dv.get("fighters"))
    # rematch / new duel takes the migrated profiles
    d2 = call(U, "POST", "/api/duels")["duel"]
    v2 = call(V, "POST", f"/api/duels/{d2['id']}/accept")
    check("new duel uses migrated fighters", v2.get("fighters") == ["boxer", "doberman"], v2.get("fighters"))
    if SHOTS:
        from playwright.sync_api import sync_playwright
        SHOTS.mkdir(parents=True, exist_ok=True)

        def fake(sp):
            return """
            window.Telegram = { WebApp: { initData: %s, platform: 'ios', version: '9.0',
              initDataUnsafe: { start_param: %s, user: %s }, ready(){}, expand(){}, disableVerticalSwipes(){},
              setHeaderColor(){}, setBackgroundColor(){}, setBottomBarColor(){}, isVersionAtLeast(){ return true; },
              HapticFeedback: { impactOccurred(){}, notificationOccurred(){} },
              BackButton: { show(){}, hide(){}, onClick(){}, offClick(){} } } };
            """ % (json.dumps(init(U)), json.dumps(sp), json.dumps(U, ensure_ascii=False))

        with sync_playwright() as p:
            b = p.chromium.launch()
            errs = []
            for name, did, want in (("old_duel_retired_ids", st["duel"], ["Бокс", "Добби"]), ("new_duel_migrated", d2["id"], ["Бокс", "Добби"])):
                ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                ctx.route("**/telegram-web-app.js", lambda r: r.fulfill(body="", content_type="text/javascript"))
                ctx.add_init_script(fake("d_" + did))
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(BASE + "/")
                pg.wait_for_selector(".fighter-img", timeout=10000)
                pg.wait_for_function("[...document.querySelectorAll('.fighter-img')].every(i => i.complete && i.naturalWidth > 0)")
                pg.wait_for_timeout(700)
                pg.screenshot(path=SHOTS / f"{name}.png")
                alts = pg.eval_on_selector_all(".fighter-img", "els => els.map(e => e.alt)")
                check(f"duel screen renders {name} as {want}", alts == want, alts)
                ctx.close()
            b.close()
            check("no page errors", not errs, errs)
print(json.dumps(out, ensure_ascii=False, indent=1))
sys.exit(0 if all(r["result"] == "Passed" for r in out) else 1)
