# /// script
# dependencies = ["mini-racer"]
# ///
# Code.gs を Apps Script のモック上で通しで動かす。
#   uv run trpg-tool/session-scheduler/test/run_test.py
import sys, pathlib
from py_mini_racer import MiniRacer

here = pathlib.Path(__file__).parent
code = (here.parent / "Code.gs").read_text(encoding="utf-8")
mock = (here / "mock_gas.js").read_text(encoding="utf-8")
test = (here / "test_scheduler.js").read_text(encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
r = MiniRacer()
r.eval(mock)
try:
    r.eval(code)
except Exception as e:
    print("Code.gs の読み込みで失敗:", e)
    sys.exit(1)
status = 0
try:
    r.eval(test)
except Exception as e:
    print("テスト中に例外:", e)
    status = 1
print(r.eval("OUT.join(String.fromCharCode(10))"))

# HTML 内の <script> を構文だけ検査する（DOM は無いので実行はしない）
import re, json
for html_name in ("Console.html", "Tutorial.html"):
    html = (here.parent / html_name).read_text(encoding="utf-8")
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    for i, body in enumerate(scripts):
        try:
            r.eval("new Function(" + json.dumps(body) + ")")
            print(f"ok - {html_name} script#{i} の構文")
        except Exception as e:
            print(f"NG - {html_name} script#{i}: {e}")
            status = 1
sys.exit(status)
