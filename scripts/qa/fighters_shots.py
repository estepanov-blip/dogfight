"""Fighter Pack v0.3 — in-game screenshots of all eight fighters on a phone viewport.

Usage: python3 -I fighters_shots.py <base_url> <out_dir> [width height]

Per fighter X (local battle vs bot, `?p2=X` = mirror match, X in both corners):
  1_idle   both corners at rest (ears / gloves must not be clipped)
  2_punch  left X lands a forced punch, right X takes the hit
  3_block  right X blocks (shield)
  4_ko     right X knocked out
  5_win    result screen (left X wins)
Plus the picker and the menu. Prints a JSON summary with console errors and clipping checks.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], Path(sys.argv[2])
W, H = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (390, 844)
out.mkdir(parents=True, exist_ok=True)
IDS = ["shiba", "bull", "doberman", "shepherd", "bulldog", "chih", "pushok", "boxer"]
errors: list[str] = []
checks: dict[str, dict] = {}

# Top of the visible sprite (first row with alpha) vs. the arena top: ears must stay inside.
CLIP_JS = """
() => {
  const arena = document.querySelector('.arena').getBoundingClientRect();
  return [...document.querySelectorAll('.fighter-img')].map(img => {
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const drawnW = img.naturalWidth * k, drawnH = img.naturalHeight * k;
    const left = r.left + (r.width - drawnW) / 2, top = r.bottom - drawnH;
    return { alt: img.alt, top: Math.round(top - arena.top), left: Math.round(left - arena.left),
             right: Math.round(arena.right - (left + drawnW)), drawnH: Math.round(drawnH), arenaH: Math.round(arena.height) };
  });
}
"""


def open_debug(pg):
    pg.get_by_role("button", name="Debug").click()
    pg.wait_for_timeout(150)


def close_debug(pg):
    pg.locator(".debug-drawer .icon-btn").click()
    pg.wait_for_timeout(100)


def wait_turn(pg):
    pg.wait_for_function("!document.querySelector('.btn-spin').disabled", timeout=15000)


with sync_playwright() as p:
    b = p.chromium.launch()
    for fid in IDS:
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(f"try {{ localStorage.setItem('dfc.fighter', '{fid}') }} catch (e) {{}}")
        pg = ctx.new_page()
        pg.on("console", lambda m, f=fid: errors.append(f"{f} console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e, f=fid: errors.append(f"{f} pageerror: {e}"))
        pg.goto(f"{base}/?debug=1&seed=777&p2={fid}")
        pg.wait_for_timeout(700)
        if fid == "shiba":
            pg.screenshot(path=out / "00_menu.png")
        pg.get_by_role("button", name="Играть").click()
        pg.wait_for_function("[...document.querySelectorAll('.fighter-img')].every(i => i.complete && i.naturalWidth > 0)")
        pg.wait_for_timeout(600)
        pg.screenshot(path=out / f"{fid}_1_idle.png")
        checks[fid] = {"geometry": pg.evaluate(CLIP_JS)}

        spin = pg.locator(".btn-spin")
        wait_turn(pg)
        open_debug(pg)
        pg.get_by_role("button", name="3× Удар").click()
        close_debug(pg)
        spin.click()
        pg.wait_for_timeout(1250)
        pg.screenshot(path=out / f"{fid}_2_punch.png")

        # right corner blocks: give the bot (right) a block on its turn is not controllable,
        # so force our own Блок + Лечение + Удар and capture the left shield instead, then swap roles
        wait_turn(pg)
        open_debug(pg)
        pg.get_by_role("button", name="Блок + Лечение + Удар").click()
        close_debug(pg)
        spin.click()
        pg.wait_for_timeout(1500)
        pg.screenshot(path=out / f"{fid}_3_block.png")

        wait_turn(pg)
        open_debug(pg)
        pg.get_by_role("button", name="HP 100 : 15").click()
        pg.get_by_role("button", name="3× Удар").click()
        close_debug(pg)
        spin.click()
        pg.wait_for_timeout(2300)
        pg.screenshot(path=out / f"{fid}_4_ko.png")
        pg.wait_for_timeout(1700)
        pg.screenshot(path=out / f"{fid}_5_win.png")
        checks[fid]["result"] = pg.locator(".result-overlay, .result").first.inner_text()[:80] if pg.locator(".result-overlay, .result").count() else None

        if fid == "boxer":
            # rematch keeps the same fighters
            pg.get_by_role("button", name="Реванш").click()
            pg.wait_for_timeout(700)
            pg.screenshot(path=out / "boxer_6_rematch.png")
            checks[fid]["rematch_alts"] = pg.eval_on_selector_all(".fighter-img", "els => els.map(e => e.alt)")
        ctx.close()

    # picker
    ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"picker pageerror: {e}"))
    pg.goto(base + "/")
    pg.wait_for_timeout(500)
    pg.get_by_role("button", name="Боец").click()
    pg.wait_for_timeout(400)
    pg.get_by_role("radio", name="Батон").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=out / "01_picker.png")
    pg.get_by_role("button", name="Выбрать: Батон").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=out / "02_menu_after_pick.png")
    stored = pg.evaluate("localStorage.getItem('dfc.fighter')")
    pg.reload()
    pg.wait_for_timeout(600)
    menu_label = pg.locator(".btn-fighter").inner_text()
    ctx.close()
    b.close()

print(json.dumps({"viewport": [W, H], "stored_after_pick": stored, "menu_after_reload": menu_label,
                  "checks": checks, "errors": errors}, ensure_ascii=False, indent=1))
