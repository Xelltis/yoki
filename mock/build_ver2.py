# /// script
# dependencies = []
# ///
"""UI 2026 案 ver2 を組む。

    uv run trpg-tool/session-scheduler/mock/build_ver2.py

デモ（demo/卓予定_デモ.html ＝ 本物の Console.html と Code.gs をブラウザだけで動かすもの）に、
mock/ver2_overlay.html を最後に差し込むだけ。原盤の中身は 1 文字も書き換えない。
デモを作り直したら、これも回し直す。
"""
import pathlib
import sys

here = pathlib.Path(__file__).resolve().parent
demo = here.parent / "demo" / "卓予定_デモ.html"
overlay = here / "ver2_overlay.html"
out = here / "卓予定_UI2026案_ver2.html"

html = demo.read_text(encoding="utf-8")
ov = overlay.read_text(encoding="utf-8")

mark = "</body>"
if html.count(mark) != 1:
    sys.exit("</body> が 1 つではありません: %d" % html.count(mark))

title_old = "<title>卓予定"
if title_old not in html:
    sys.exit("題名が見つかりません")
# 題名だけは ver2 と分かるようにする
i = html.index(title_old)
j = html.index("</title>", i)
html = html[:i] + "<title>卓予定（UI 2026 案 ver2）" + html[j:]

html = html.replace(mark, ov.rstrip() + "\n" + mark)
out.write_text(html, encoding="utf-8")
print("written %s %d bytes（デモ %d + 差し替え %d）" % (out.name, len(html), len(demo.read_text(encoding="utf-8")), len(ov)))
