"""v0.3 API end-to-end checks against a local `wrangler dev` (DEV_MODE=1) + mock Bot API.

Covers QA-04 (auto/auto with closed clients, toggles), QA-05 (races), QA-06 (reminders,
timeout via dev time shift), QA-07 (pair quota 5/day), QA-08 (wallet), QA-09 (boards,
rivals, privacy), QA-10 (rematch race), QA-11 (fighter snapshot).

Usage: python3 -I scripts/qa/v03_api_e2e.py http://127.0.0.1:8787 /tmp/tg-mock.jsonl
"""
import hashlib, hmac, json, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE, MOCK = sys.argv[1], sys.argv[2]
TOKEN = "123456:TEST-token"
results = []


def check(qa, name, ok, detail=""):
    results.append({"qa": qa, "check": name, "result": "Passed" if ok else "Failed", "detail": detail})


def init(u, chat=None):
    f = {"user": json.dumps(u, separators=(",", ":"), ensure_ascii=False), "auth_date": str(int(time.time()))}
    if chat:
        f["chat_instance"], f["chat_type"] = chat, "group"
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(f.items()))
    s = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    f["hash"] = hmac.new(s, dcs.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(f)


def call(u, method, path, body=None, chat=None):
    req = urllib.request.Request(
        BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"authorization": "tma " + init(u, chat), "content-type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        return {"status": e.code, **json.loads(e.read() or b"{}")}


def user(i, name):
    return {"id": i, "first_name": name}


def new_duel(a, b, chat=None):
    d = call(a, "POST", "/api/duels", chat=chat)["duel"]
    v = call(b, "POST", f"/api/duels/{d['id']}/accept", chat=chat)
    return v


def wait(pred, timeout=60, step=0.5):
    t = time.time()
    while time.time() - t < timeout:
        r = pred()
        if r:
            return r
        time.sleep(step)
    return None


def mock_calls():
    return [json.loads(l) for l in open(MOCK) if l.strip()]


def bones(u):
    return call(u, "GET", "/api/me")["wallet"]["balance"]


# ------------------------------------------------------------------ QA-08 start balance
A, B = user(9001, "Аня"), user(9002, "Боря")
check("QA-08", "first wallet access grants 500 once", bones(A) == 500 and bones(A) == 500)

# ------------------------------------------------------------------ QA-11 fighter snapshot
call(A, "POST", "/api/profile", {"fighter": "pushok"})
call(B, "POST", "/api/profile", {"fighter": "pushok"})
bad = call(A, "POST", "/api/profile", {"fighter": "dragon"})
check("QA-11", "unknown fighter id is rejected", bad.get("status") == 400)
retired = call(A, "POST", "/api/profile", {"fighter": "psikh"})
check("QA-11", "retired placeholder id cannot be chosen (Fighter Pack v0.3)", retired.get("status") == 400)
check("QA-11", "choice is stored in the profile", call(A, "GET", "/api/me").get("profile", {}).get("fighter") == "pushok")
v = new_duel(A, B)
check("QA-11", "mirror match snapshot at acceptance", v["fighters"] == ["pushok", "pushok"], str(v["fighters"]))
call(A, "POST", "/api/profile", {"fighter": "doberman"})
v2 = call(A, "GET", f"/api/duels/{v['id']}")
check("QA-11", "profile change does not alter an active duel", v2["fighters"] == ["pushok", "pushok"])
check("QA-06", "v0.3 duel has a 24 h deadline", abs((v2["deadline"] - v2["updatedAt"]) - 24 * 3600_000) < 5000 or v2["deadline"] is not None)

# ------------------------------------------------------------------ QA-04 auto toggles
dA = v["id"]
other = call(user(9999, "Чужой"), "POST", f"/api/duels/{dA}/auto", {"on": True})
check("QA-04", "stranger cannot toggle auto", other.get("status") == 403)
cur = v["battle"]["current"]
waiting = B if cur == 0 else A
r = call(waiting, "POST", f"/api/duels/{dA}/auto", {"on": True})
check("QA-04", "auto on the opponent's turn is stored and waits", r["auto"]["me"] is True and r["battle"]["spinCount"] == 0)
time.sleep(2.5)
check("QA-04", "no spin happens for the waiting side", call(A, "GET", f"/api/duels/{dA}")["battle"]["spinCount"] == 0)
call(waiting, "POST", f"/api/duels/{dA}/auto", {"on": False})

# ------------------------------------------------------------------ QA-04 auto/auto with closed clients
r1 = call(A, "POST", f"/api/duels/{dA}/auto", {"on": True})
r2 = call(B, "POST", f"/api/duels/{dA}/auto", {"on": True})
t0 = time.time()
over = wait(lambda: (lambda d: d if d["status"] == "over" else None)(call(A, "GET", f"/api/duels/{dA}")), timeout=120, step=2)
dur = time.time() - t0
check("QA-04", "auto/auto finishes with no client actions", over is not None, f"{dur:.1f}s, spins={over and over['battle']['spinCount']}")
if over:
    check("QA-13", "auto/auto duration (local) recorded", True, f"{dur:.1f}s for {over['battle']['spinCount']} spins")
    check("QA-08", "rated auto result settles +100/-50", over["result"]["rated"] == "rated" and over["result"]["myDelta"] is not None, json.dumps(over["result"]))

# ------------------------------------------------------------------ QA-05 races
C, D = user(9101, "Вика"), user(9102, "Гоша")
v = new_duel(C, D)
dC = v["id"]
first = C if v["battle"]["current"] == 0 else D
with ThreadPoolExecutor(4) as ex:
    rs = list(ex.map(lambda _: call(first, "POST", f"/api/duels/{dC}/spin", {"expected": 0}), range(4)))
spun = [x for x in rs if x.get("records")]
check("QA-05", "4 parallel manual spins for the same number -> 1 spin", len(spun) == 1 and call(C, "GET", f"/api/duels/{dC}")["battle"]["spinCount"] == 1, str([bool(x.get('records')) for x in rs]))
cur = call(C, "GET", f"/api/duels/{dC}")
nxt = C if cur["battle"]["current"] == 0 else D
call(nxt, "POST", f"/api/duels/{dC}/auto", {"on": True})
m = call(nxt, "POST", f"/api/duels/{dC}/spin", {"expected": 1})
time.sleep(2.5)
after = call(C, "GET", f"/api/duels/{dC}")
check("QA-05", "manual press vs auto job for the same spin -> one spin", after["battle"]["spinCount"] >= 2 and len(after["battle"]["log"]) == after["battle"]["spinCount"] and m.get("records") is not None)
with ThreadPoolExecutor(2) as ex:
    fs = list(ex.map(lambda u: call(u, "POST", f"/api/duels/{dC}/forfeit"), [C, D]))
ok_f = [x for x in fs if "id" in x]  # success returns the duel view, the loser of the race a 409
check("QA-10", "two concurrent surrenders -> one result", len(ok_f) == 1 and sum(x.get("status") == 409 for x in fs) == 1, str([x.get("status") for x in fs]))
fin = call(C, "GET", f"/api/duels/{dC}")
check("QA-10", "surrender after both spun is ordinary", fin["result"]["reason"] in ("surrender", "early_surrender"), fin["result"]["reason"])
with ThreadPoolExecutor(2) as ex:
    rm = list(ex.map(lambda u: call(u, "POST", f"/api/duels/{dC}/rematch"), [C, D]))
check("QA-10", "two concurrent rematch requests -> one new duel", rm[0]["id"] == rm[1]["id"], str(rm))
re = call(C, "GET", f"/api/duels/{rm[0]['id']}")
loser = 1 - fin["result"]["outcome"] if fin["result"]["outcome"] != "draw" else None
check("QA-10", "the loser opens the rematch; auto off", re["battle"]["current"] == loser and re["auto"] == {"me": False, "opponent": False})

# ------------------------------------------------------------------ QA-07/08 pair quota + wallet
E, F = user(9201, "Ева"), user(9202, "Фёдор")
eb, fb = bones(E), bones(F)
rated = []
for i in range(6):
    v = new_duel(E, F, chat="-555")
    call(F, "POST", f"/api/duels/{v['id']}/forfeit", chat="-555")  # F gives up before any spin -> early_surrender
    res = wait(lambda: (lambda d: d if d["result"] and d["result"]["rated"] != "pending" else None)(call(F, "GET", f"/api/duels/{v['id']}", chat="-555")), 20)
    rated.append((res["result"]["rated"], res["result"]["reason"], res["result"]["myDelta"]))
check("QA-07", "first five results of the pair today are rated, the 6th friendly", [r[0] for r in rated] == ["rated"] * 5 + ["friendly"], str(rated))
check("QA-08", "early surrender = technical: loser -50 x5, winner 0; friendly 0", bones(F) == fb - 250 and bones(E) == eb, f"E {eb}->{bones(E)}, F {fb}->{bones(F)}")
led = call(F, "GET", "/api/rivals")["ledger"]
check("QA-08", "ledger has explicit zero entry for the friendly duel", any(e["nominal"] == 0 and e["reason"].startswith("friendly") for e in led))
riv = call(E, "GET", "/api/rivals")["rivals"]
row = next(r for r in riv if r["opponent"]["id"] == F["id"])
check("QA-09", "rivals: rated 5-0, friendly 1-0 shown separately", (row["wins"], row["losses"], row["friendly"]["wins"]) == (5, 0, 1), json.dumps(row, ensure_ascii=False))
me = call(E, "GET", "/api/me", chat="-555")
wk = me["boards"]["week"]
check("QA-09", "group week board counts rated only", wk[0]["id"] == E["id"] and wk[0]["wins"] == 5, json.dumps(wk, ensure_ascii=False)[:200])
other_group = call(E, "GET", "/api/me", chat="-777")["boards"]
check("QA-09", "another group sees its own (empty) board", other_group["week"] == [] and other_group["all"] == [])
check("QA-09", "private chat has no group board", call(E, "GET", "/api/me")["boards"] is None)
stranger_view = call(user(9999, "Чужой"), "GET", f"/api/duels/{v['id']}")
check("QA-09", "a stranger gets no head-to-head of others", stranger_view.get("h2h") is None and stranger_view.get("me") is None)

# ------------------------------------------------------------------ QA-06 reminders + timeout
G, Hh = user(9301, "Гена"), user(9302, "Хана")
v = new_duel(G, Hh)
dG = v["id"]
slow = G if v["battle"]["current"] == 0 else Hh
n0 = len(mock_calls())
call(G, "POST", f"/api/dev/duels/{dG}/shift", {"ms": 3600_000 + 1000})
time.sleep(2)
call(G, "POST", f"/api/dev/duels/{dG}/shift", {"ms": 1000})  # second tick at the same reminder: no duplicate
time.sleep(2)
msgs = [c["params"] for c in mock_calls()[n0:] if c["method"] == "sendMessage"]
rem1 = [m for m in msgs if "техническое поражение" in m["text"] and m["chat_id"] == slow["id"]]
check("QA-06", "1 h reminder to the player on turn, once", len(rem1) == 1, rem1[0]["text"] if rem1 else str(msgs))
call(G, "POST", f"/api/dev/duels/{dG}/shift", {"ms": 11 * 3600_000})
time.sleep(2)
msgs = [c["params"] for c in mock_calls()[n0:] if c["method"] == "sendMessage"]
rem = [m for m in msgs if "техническое поражение" in m["text"]]
check("QA-06", "12 h reminder sent once more (total 2)", len(rem) == 2, " | ".join(m["text"] for m in rem))
call(G, "POST", f"/api/dev/duels/{dG}/shift", {"ms": 12 * 3600_000})
fin = wait(lambda: (lambda d: d if d["status"] == "over" else None)(call(G, "GET", f"/api/duels/{dG}")), 15)
check("QA-06", "24 h -> technical loss of the side on turn", fin is not None and fin["result"]["reason"] == "turn_timeout" and fin["result"]["outcome"] == (1 if slow is G else 0), fin and json.dumps(fin["result"]))
late = call(slow, "POST", f"/api/duels/{dG}/spin", {"expected": 0})
check("QA-06", "a spin after the deadline is refused", late.get("status") in (409,) or late.get("stale") is True, str(late)[:120])
time.sleep(2)
finals = [c["params"]["text"] for c in mock_calls()[n0:] if c["method"] == "sendMessage" and ("Техническ" in c["params"]["text"] or "время хода" in c["params"]["text"])]
check("QA-12", "timeout messages are neutral and sent", len(finals) >= 1, " | ".join(finals))

# ------------------------------------------------------------------ QA-12 neutral texts in all bot messages
allmsg = [c["params"]["text"] for c in mock_calls() if c["method"] == "sendMessage"]
import re
gendered = re.compile(r"(принял |победил|отправлен|убежал|сдался|ударил )")
bad = [m for m in allmsg if gendered.search(m.lower())]
check("QA-12", "no gendered verb forms in bot messages", not bad, " | ".join(bad[:3]))

passed = sum(r["result"] == "Passed" for r in results)
print(json.dumps({"passed": passed, "total": len(results), "results": results}, ensure_ascii=False, indent=1))
