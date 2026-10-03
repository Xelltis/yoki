# /// script
# dependencies = ["playwright==1.62.0"]
# ///
# 広報用デモのスクリーンショットを image/卓予定デモ/ に撮る（?clean で札なし、吹き出しとスクロールバーは隠す。PC は 2 倍、スマホは 3 倍の解像度）
#   uv run trpg-tool/session-scheduler/demo/take_screenshots.py
import pathlib, sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8")
demo = pathlib.Path(r"C:/Users/enoki/Desktop/DICEHEDGESYSTEM/trpg-tool/session-scheduler/demo/卓予定_デモ.html")
out = pathlib.Path(r"C:/Users/enoki/Desktop/DICEHEDGESYSTEM/image/卓予定デモ")
out.mkdir(parents=True, exist_ok=True)
HIDE = "#toast { display: none !important; } html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }"

def open_page(b, w, h, scale, query):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale)
    pg = ctx.new_page()
    pg.goto(demo.as_uri() + "?clean" + query)
    pg.wait_for_function("window.D && D.sessions && D.sessions.length > 0", timeout=20000)
    pg.add_style_tag(content=HIDE)
    pg.wait_for_timeout(900)
    return ctx, pg

def day_of(pg, name):
    return pg.evaluate("(D.sessions.filter(s => s.name === %r)[0] || {}).date" % name)

shots = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ("light", "dark"):
        # PC
        ctx, pg = open_page(b, 1440, 900, 2, "&theme=" + theme)
        pg.evaluate("selectDay(%r)" % day_of(pg, "連れて帰る")); pg.wait_for_timeout(300)
        f = out / f"PC_カレンダー_{theme}.png"; pg.screenshot(path=str(f)); shots.append(f)
        if theme == "light":
            pg.evaluate("window.scrollTo(0, 0)")
            pg.click("#newSession"); pg.wait_for_timeout(400)
            f = out / "PC_卓の登録.png"; pg.screenshot(path=str(f)); shots.append(f)
            pg.click("#formClose"); pg.wait_for_timeout(200)
            for tab, label in (("recruit", "募集・調整"), ("avail", "メンバーの予定"), ("settings", "設定")):
                pg.click(f"nav.tabs button[data-tab={tab}]"); pg.wait_for_timeout(400)
                f = out / f"PC_{label}.png"; pg.screenshot(path=str(f)); shots.append(f)
        ctx.close()
        # スマホ
        ctx, pg = open_page(b, 390, 844, 3, "&theme=" + theme)
        f = out / f"スマホ_カレンダー_{theme}.png"; pg.screenshot(path=str(f)); shots.append(f)
        if theme == "light":
            pg.click("nav.tabs button[data-tab=recruit]"); pg.wait_for_timeout(400)
            f = out / "スマホ_募集・調整.png"; pg.screenshot(path=str(f)); shots.append(f)
            pg.click("nav.tabs button[data-tab=avail]"); pg.wait_for_timeout(400)
            f = out / "スマホ_メンバーの予定.png"; pg.screenshot(path=str(f)); shots.append(f)
        ctx.close()
    b.close()
for f in shots:
    print(f.name, f.stat().st_size // 1024, "KB")
