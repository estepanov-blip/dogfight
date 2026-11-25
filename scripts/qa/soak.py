import sys, json
from playwright.sync_api import sync_playwright
base=sys.argv[1]; errors=[]; results=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":390,"height":844})
    pg.on("console", lambda m: errors.append(m.text) if m.type in ("error","warning") else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(base+"/?debug=1"); pg.get_by_role("button", name="Играть").click()
    pg.get_by_role("button", name="Debug").click(); pg.get_by_role("button", name="×4").click()
    pg.locator(".debug-drawer .icon-btn").click()
    for fight in range(8):
        for _ in range(400):
            if pg.locator(".result").count(): break
            pg.evaluate("for(let i=0;i<3;i++){const b=document.querySelector('.btn-spin'); if(b&&!b.disabled) b.click()}")
            pg.wait_for_timeout(120)
        results.append(pg.locator(".result-title").inner_text() + " | log " + pg.locator(".link-btn").inner_text())
        pg.get_by_role("button", name="Реванш").click()
    b.close()
print(json.dumps({"results":results,"errors":errors},ensure_ascii=False,indent=1))
