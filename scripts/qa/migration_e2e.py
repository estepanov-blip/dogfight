"""QA-03 / FC-21: v0.2 -> v0.3 -> v0.2 (rollback) -> v0.3 on one persisted Durable Object state.

Phase argument:
  seed      (run against v0.2 code)  create finished / active / open duels + group board
  forward   (run against v0.3 code)  verify reads, continue legacy duel, wallet once, boards
  rollback  (run against v0.2 code)  v0.2 still reads everything and can play a v0.3 duel
  again     (run against v0.3 code)  the duel finished under v0.2 gets one result; sums stable

Usage: python3 -I scripts/qa/migration_e2e.py <base_url> <phase> <state.json>
"""
import hashlib, hmac, json, sys, time, urllib.parse, urllib.request

BASE, PHASE, STATE = sys.argv[1], sys.argv[2], sys.argv[3]
TOKEN = "123456:TEST-token"
CHAT = "-900"
P, Q = {"id": 7001, "first_name": "Петя"}, {"id": 7002, "first_name": "Ксюша"}
out = []


def check(name, ok, detail=""):
    out.append({"phase": PHASE, "check": name, "result": "Passed" if ok else "Failed", "detail": str(detail)[:200]})


def init(u):
    f = {"user": json.dumps(u, separators=(",", ":"), ensure_ascii=False), "auth_date": str(int(time.time())),
         "chat_instance": CHAT, "chat_type": "group"}
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


def who(d):
    return P if d["battle"]["current"] == 0 else Q


def spin_to_end(did, limit=100):
    d = call(P, "GET", f"/api/duels/{did}")
    for _ in range(limit):
        if d["status"] != "active":
            break
        r = call(who(d), "POST", f"/api/duels/{did}/spin", {"expected": d["battle"]["spinCount"]})
        d = r.get("duel", d) if "duel" in r else call(P, "GET", f"/api/duels/{did}")
    return d


def settle(did):
    for _ in range(20):
        d = call(P, "GET", f"/api/duels/{did}")
        if not d.get("result") or d["result"]["rated"] != "pending":
            return d
        time.sleep(0.5)
    return d


if PHASE == "seed":
    s = {}
    d = call(P, "POST", "/api/duels")["duel"]
    call(Q, "POST", f"/api/duels/{d['id']}/accept")
    fin = spin_to_end(d["id"])
    s["finished"] = d["id"]
    check("v0.2 finished duel", fin["status"] == "over")
    d2 = call(P, "POST", "/api/duels")["duel"]
    a2 = call(Q, "POST", f"/api/duels/{d2['id']}/accept")
    for _ in range(2):
        a2 = call(who(a2), "POST", f"/api/duels/{d2['id']}/spin", {"expected": a2["battle"]["spinCount"]}).get("duel", a2)
    s["active"], s["activeSpins"] = d2["id"], a2["battle"]["spinCount"]
    check("v0.2 active duel with spins", a2["status"] == "active" and a2["battle"]["spinCount"] == 2)
    d3 = call(P, "POST", "/api/duels")["duel"]
    s["open"] = d3["id"]
    me = call(P, "GET", "/api/me")
    s["board"] = me["leaderboard"]
    check("v0.2 group board has the finished duel", sum(r["wins"] for r in me["leaderboard"]) == 1, me["leaderboard"])
    s["duelCountP"] = len(me["duels"])
    json.dump(s, open(STATE, "w"))

elif PHASE == "forward":
    s = json.load(open(STATE))
    f = call(P, "GET", f"/api/duels/{s['finished']}")
    check("finished v0.2 duel readable, legacy schema, Шиба/Буль", f["status"] == "over" and f.get("schema") is None and f["fighters"] == ["shiba", "bull"], f.get("fighters"))
    a = call(P, "GET", f"/api/duels/{s['active']}")
    check("active v0.2 duel continues from its spin, no deadline", a["status"] == "active" and a["battle"]["spinCount"] == s["activeSpins"] and a["deadline"] is None)
    fin = settle(spin_to_end(s["active"])["id"])
    check("legacy duel finishes as rated=legacy with no bones", fin["result"]["rated"] == "legacy" and fin["result"]["myDelta"] is None, fin["result"])
    o = call(Q, "POST", f"/api/duels/{s['open']}/accept")
    check("open v0.2 challenge accepted after the update becomes v0.3", o.get("schema") == 2 and o["deadline"] is not None)
    w1 = [call(u, "GET", "/api/me")["wallet"]["balance"] for u in (P, Q)]
    w2 = [call(u, "GET", "/api/me")["wallet"]["balance"] for u in (P, Q)]
    check("starting 500 granted once per player (repeat = no change)", w1 == [500, 500] and w2 == w1, (w1, w2))
    led = call(P, "GET", "/api/rivals")["ledger"]
    check("no rewards for historical / legacy duels", [e["key"] for e in led] == ["start"], [e["key"] for e in led])
    me = call(P, "GET", "/api/me")
    allb = me["boards"]["all"]
    legacy_wins = sum((r.get("legacy") or {}).get("wins", 0) for r in allb)
    check("all-time board keeps v0.2 + legacy results once, marked", legacy_wins == 2 and me["boards"]["week"] == [], allb)
    check("duel list kept", len(me["duels"]) >= s["duelCountP"])
    rm = call(P, "POST", f"/api/duels/{s['finished']}/rematch")
    rd = call(P, "GET", f"/api/duels/{rm['id']}")
    check("rematch of a v0.2 duel is a v0.3 duel", rd.get("schema") == 2)
    s["v03duel"] = rm["id"]
    s["afterForward"] = {"wallet": w1, "legacyWins": legacy_wins}
    json.dump(s, open(STATE, "w"))

elif PHASE == "rollback":
    s = json.load(open(STATE))
    for k in ("finished", "active", "open", "v03duel"):
        d = call(P, "GET", f"/api/duels/{s[k]}")
        check(f"v0.2 code reads {k} duel written by v0.3", d.get("id") == s[k] and "status" in d, d.get("status"))
    me = call(P, "GET", "/api/me")
    check("v0.2 code reads duel list and board", isinstance(me.get("duels"), list) and me.get("leaderboard") is not None)
    fin = spin_to_end(s["v03duel"])
    check("v0.2 code can finish a v0.3 duel during rollback", fin["status"] == "over")

elif PHASE == "again":
    s = json.load(open(STATE))
    d = settle(s["v03duel"])
    check("duel finished under v0.2 gets exactly one result after roll-forward", d.get("result") is not None and d["result"]["rated"] in ("rated", "friendly"), d.get("result"))
    d2 = settle(s["v03duel"])
    check("repeat read does not change the result", d2["result"] == d["result"])
    w = [call(u, "GET", "/api/me")["wallet"]["balance"] for u in (P, Q)]
    check("wallets moved once by +100/-50 for that duel", sorted(w) == [450, 600], w)
    me = call(P, "GET", "/api/me")
    legacy_wins = sum((r.get("legacy") or {}).get("wins", 0) for r in me["boards"]["all"])
    check("legacy board unchanged by roll-forward", legacy_wins == s["afterForward"]["legacyWins"])

print(json.dumps(out, ensure_ascii=False, indent=1))
