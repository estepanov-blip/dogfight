"""Headless smoke test + screenshots. Usage: python3 -I shots.py <base_url> <out_dir>"""
import sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    pg.goto(base + "/?debug=1&seed=12345")
    pg.wait_for_timeout(900)
    pg.screenshot(path=out / "01_menu.png")

    pg.get_by_role("button", name="Играть").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=out / "02_battle_start.png")

    spin = pg.locator(".btn-spin")
    # double click spam -> only one spin must happen
    spin.click()
    pg.evaluate("document.querySelector('.btn-spin').click(); document.querySelector('.btn-spin').click()")
    pg.wait_for_timeout(450)
    pg.screenshot(path=out / "03_spinning.png")
    pg.wait_for_timeout(950)
    pg.screenshot(path=out / "04_impact.png")
    counter = pg.locator(".spin-counter").inner_text()

    # Debug: force triple crit
    pg.wait_for_timeout(2500)  # bot turn passes
    pg.get_by_role("button", name="Debug").click()
    pg.wait_for_timeout(200)
    pg.screenshot(path=out / "05_debug.png")
    pg.get_by_role("button", name="3× Крит").click()
    pg.locator(".debug-drawer .icon-btn").click()
    # wait until human can spin
    pg.wait_for_function("!document.querySelector('.btn-spin').disabled", timeout=8000)
    spin.click()
    pg.wait_for_timeout(1350)
    pg.screenshot(path=out / "06_crit.png")

    # set HP low and KO
    pg.wait_for_function("!document.querySelector('.btn-spin').disabled", timeout=8000)
    pg.get_by_role("button", name="Debug").click()
    pg.get_by_role("button", name="HP 100 : 15").click()
    pg.get_by_role("button", name="3× Удар").click()
    pg.locator(".debug-drawer .icon-btn").click()
    spin.click()
    pg.wait_for_timeout(2300)
    pg.screenshot(path=out / "07_ko.png")
    pg.wait_for_timeout(1600)
    pg.screenshot(path=out / "08_result.png")

    pg.get_by_role("button", name="Журнал боя").click()
    pg.wait_for_timeout(300)
    pg.screenshot(path=out / "09_log.png")
    pg.locator(".sheet .icon-btn").click()
    pg.get_by_role("button", name="Реванш").click()
    pg.wait_for_timeout(400)
    rematch_hp = pg.locator(".hud-hp").all_inner_texts()
    pg.screenshot(path=out / "10_rematch.png")

    # shield + heal visuals
    pg.wait_for_function("!document.querySelector('.btn-spin').disabled", timeout=10000)
    pg.get_by_role("button", name="Debug").click()
    pg.get_by_role("button", name="Блок + Лечение + Удар").click()
    pg.locator(".debug-drawer .icon-btn").click()
    pg.get_by_role("button", name="Debug").click()
    pg.get_by_role("button", name="HP 15 : 100").click()
    pg.locator(".debug-drawer .icon-btn").click()
    spin.click()
    pg.wait_for_timeout(1500)
    pg.screenshot(path=out / "11_heal_shield.png")

    # Lab
    pg.get_by_role("button", name="← Меню").click()
    pg.get_by_role("button", name="Симуляция боёв").click()
    pg.get_by_role("button", name="▶ Запустить").click()
    pg.wait_for_selector(".lab-report", timeout=20000)
    pg.wait_for_timeout(200)
    pg.screenshot(path=out / "12_lab.png", full_page=True)
    lab_text = pg.locator(".lab-report .card").first.inner_text()

    # Local 2P + rules
    pg.get_by_role("button", name="← Меню").click()
    pg.get_by_role("button", name="Правила").click()
    pg.wait_for_timeout(300)
    pg.screenshot(path=out / "13_rules.png")
    pg.locator(".sheet .icon-btn").click()
    pg.get_by_role("button", name="Вдвоём").click()
    pg.wait_for_timeout(300)
    pg.screenshot(path=out / "14_local.png")

    # small phone
    pg.set_viewport_size({"width": 360, "height": 640})
    pg.wait_for_timeout(300)
    pg.screenshot(path=out / "15_small.png")
    # desktop
    pg.set_viewport_size({"width": 1280, "height": 860})
    pg.wait_for_timeout(300)
    pg.screenshot(path=out / "16_desktop.png")
    b.close()

print(json.dumps({"counter_after_spam": counter, "rematch_hp": rematch_hp, "lab": lab_text[:300], "errors": errors}, ensure_ascii=False, indent=1))
