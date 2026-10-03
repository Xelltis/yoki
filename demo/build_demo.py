# 広報用のデモ画面を組む。Console.html に、本物の Code.gs を Apps Script の模型（test/mock_gas.js）ごと埋め込み、
# ブラウザの中だけで動くようにする。データは開くたびに作る架空のサンプルで、どこにも保存しない。
#   uv run trpg-tool/session-scheduler/demo/build_demo.py
# 出力: demo/卓予定_デモ.html（アプリ）と demo/卓予定_使い方.html（使い方のページの写し）
# URL の後ろに付けられるもの（& でつなぐ）: ?clean（左下の「デモ」の札を隠す。スクリーンショット用） ?theme=dark|light ?me=名前
#   ?tab=cal|recruit|avail|members|settings（最初に開く画面）
import json, pathlib, sys
sys.stdout.reconfigure(encoding="utf-8")
here = pathlib.Path(__file__).parent
app = here.parent
DEMO = "卓予定_デモ.html"
TUTORIAL = "卓予定_使い方.html"

console = (app / "Console.html").read_text(encoding="utf-8")
mock = (app / "test" / "mock_gas.js").read_text(encoding="utf-8")
code = (app / "Code.gs").read_text(encoding="utf-8")
tutorial = (app / "Tutorial.html").read_text(encoding="utf-8")

# 画面が呼ぶ関数の名前（Console.html の API_FUNCS）
i = console.index("var API_FUNCS = [")
j = console.index("];", i)
api_funcs = json.loads("[" + console[i + len("var API_FUNCS = ["):j].replace("'", '"') + "]")
assert "getConsoleData" in api_funcs and "saveSession" in api_funcs, api_funcs

SEED = r"""
  // ---- デモの下ごしらえ（開くたびに作る。日付は今日から数える）。最初に呼ばれたときに 1 度だけ回す ----
  var seeded = false;
  function seed() {
  if (seeded) return;
  seeded = true;
  var fullData = consoleData_, fullRefresh = refreshAll_;
  consoleData_ = function () { return {}; };   // 下ごしらえの途中の返事は捨てるので、画面用データも表の描き直しもしない
  refreshAll_ = function () {};
  SS.name = '卓予定';
  WEBAPP_URL = '__TUTORIAL__';        // 「使い方」のリンクと、Discord の文に付く URL
  userEmail_ = function () { return ''; };
  setup();
  setInitialPassword({ password: 'demo-demo-demo', confirm: 'demo-demo-demo' });
  tokenOk_ = function () { return true; };   // デモでは合言葉を聞かない
  var T = function (n) { return ymd_(addDays_(new Date(), n)); };
  var me = 'ひより';
  [['ひより', 'GM が多め'], ['ソラ', ''], ['こまち', '平日は 21 時から'], ['レン', ''], ['ミナト', 'TRPG は始めたばかり'], ['ユズ', '']].forEach(function (m, k) {
    saveMember({ name: m[0], discordId: '4000000000000000' + (10 + k), note: m[1] });
  });
  saveConsoleSettings({ webhook: 'https://discord.com/api/webhooks/000000000000000000/demo' });
  setAutoNotify({ enabled: true, me: me });
  var S = function (o) {
    return saveSession(Object.assign({ extra: '', notify: false, me: me, members: [], start: '', end: '', place: '', memo: '', series: '' }, o));
  };
  var nm = new Date(); nm.setDate(1); nm.setMonth(nm.getMonth() + 1);
  var nextFrom = ymd_(nm), nextMid = ymd_(new Date(nm.getFullYear(), nm.getMonth(), 15)), nextTo = ymd_(new Date(nm.getFullYear(), nm.getMonth() + 1, 0));
  // キャンペーン（シリーズ）
  S({ name: '鉄鳴界の夜明け #1', series: '鉄鳴界の夜明け', gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], date: T(-6), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: 'キャンペーン第 1 回。キャラクター作成から' });
  S({ name: '鉄鳴界の夜明け #2', series: '鉄鳴界の夜明け', seriesEnd: T(40), gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], dates: [T(2), T(9), T(16)], date: T(2), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: '前回の続きから' });
  // 単発
  S({ name: '今夜の短編', gm: 'ユズ', members: ['ひより', 'ミナト'], date: T(0), start: '21:00', end: '23:00', status: '開催', place: 'Discord ボイス', memo: '2 時間で終わる短いシナリオ' });
  var port = S({ name: '星降る港の依頼', gm: 'ミナト', members: ['ソラ', 'レン'], date: T(1), start: '20:30', end: '23:00', status: '開催', place: 'Discord ボイス', memo: 'ミナトさんの初 GM' });
  S({ name: '連れて帰る', gm: 'ソラ', members: ['ひより', 'ミナト', 'ユズ'], date: T(5), start: '14:00', end: '18:00', status: '開催', place: 'ユドナリウムアックス', memo: '初めての人も歓迎' });
  S({ name: '灰色の図書館', gm: 'レン', members: ['こまち', 'ユズ', 'ひより'], date: T(12), start: '21:00', end: '23:30', status: '開催', place: 'Discord ボイス', memo: '' });
  // 募集
  var castle = S({ name: '雪原の古城', gm: 'こまち', status: '募集', windowFrom: nextFrom, windowTo: nextMid, memo: '3〜4 人で。ボイスあり' });
  setInterest({ id: castle.id, name: 'ソラ', level: 'want' });
  setInterest({ id: castle.id, name: 'レン', level: 'interest' });
  setInterest({ id: castle.id, name: 'ユズ', level: 'interest' });
  var camp = S({ name: '新キャンペーン顔合わせ', gm: 'ひより', status: '募集', windowFrom: nextMid, windowTo: nextTo, memo: '長いキャンペーンの相談会。見学だけでも' });
  setInterest({ id: camp.id, name: 'ミナト', level: 'want' });
  setInterest({ id: camp.id, name: 'こまち', level: 'interest' });
  // 日程調整
  var maze = S({ name: '迷宮の底へ', gm: 'レン', members: ['ひより', 'ソラ', 'こまち'], status: '調整中', windowFrom: T(18), windowTo: T(32), memo: '候補の期間のどこかで 1 回' });
  startPoll({ id: maze.id, dates: [T(19), T(21), T(24), T(26)], start: '20:00', end: '23:00', me: 'レン' });
  [['ひより', 19, '◯'], ['ひより', 21, '×'], ['ひより', 24, '◯'], ['ソラ', 19, '×'], ['ソラ', 24, '◯'], ['ソラ', 26, '◯']].forEach(function (v) {
    setPollVote({ id: maze.id, ymd: T(v[1]), name: v[0], vote: v[2] });
  });
  // メンバーの予定（都合の悪い日だけ）
  [['ソラ', [2], '×'], ['こまち', [3], '△'], ['レン', [4], '×'], ['ミナト', [0], '△']].forEach(function (b) {
    setAvailabilityBulk({ name: b[0], from: T(0), to: T(59), weekdays: b[1], mark: b[2], keep: true });
  });
  setAvailability('ひより', T(7), '×', '');
  setAvailability('ユズ', T(10), '△', '');
  setAvailNote({ name: 'ソラ', ymd: T(8), text: '21 時からなら参加できます' });
  setDayNote({ ymd: T(5), text: 'ユドナリウムの部屋は前日に作ります', me: 'ソラ' });
  // Discord に送った跡（送ったことにするだけで、どこにも届かない）
  sendDiscordStep({ kind: 'announce', id: port.id, attempt: 1, me: 'ミナト' });
  sendDiscordStep({ kind: 'ask', id: castle.id, attempt: 1, me: 'こまち', message: '' });
  consoleData_ = fullData; refreshAll_ = fullRefresh;
  }
"""

backend = "var DEMO_BACKEND = (function () {\n" + mock + "\n" + code + "\n" + SEED.replace("__TUTORIAL__", TUTORIAL) + \
    "\n  return {\n    __seed: seed,\n" + ",\n".join("    %s: %s" % (n, n) for n in api_funcs) + "\n  };\n})();\n"
backend = backend.replace("</script", "<\\/script")

STUB = r"""
// google.script.run の代わり。呼ばれた関数を、この画面の中の Code.gs（DEMO_BACKEND）で動かす。
// 行き来は JSON を通し、本物と同じく少し遅れて返す
var google = { script: { host: { close: function () {} }, run: null } };
(function () {
  var names = Object.keys(DEMO_BACKEND).filter(function (n) { return n !== '__seed'; });
  function runner() {
    var ok = function () {}, ng = function () {};
    var r = { withSuccessHandler: function (f) { ok = f; return r; }, withFailureHandler: function (f) { ng = f; return r; } };
    names.forEach(function (n) {
      r[n] = function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          if (window.__hang) return;   // 返事が返ってこないときを試すため（デモの確認用）
          var res;
          try { DEMO_BACKEND.__seed(); res = DEMO_BACKEND[n].apply(null, args); }
          catch (e) { ng(new Error(String(e && e.message || e))); return; }
          ok(res === undefined ? undefined : JSON.parse(JSON.stringify(res)));
        }, 120);
      };
    });
    return r;
  }
  google.script.run = {
    withSuccessHandler: function (f) { return runner().withSuccessHandler(f); },
    withFailureHandler: function (f) { return runner().withFailureHandler(f); }
  };
})();
"""

# 開くたびに最初の状態から。?me= と ?theme= は、スクリーンショットを撮るときのため。画面が読む前（head の頭）で入れる
PARAMS = r"""<script>
(function () {
  var q = new URLSearchParams(location.search);
  try {
    localStorage.removeItem('taku.cache');
    localStorage.removeItem('taku.tab');   // 最初はカレンダー。?tab=recruit などで最初の画面を選べる
    if (q.get('tab')) localStorage.setItem('taku.tab', q.get('tab'));
    if (q.get('me')) localStorage.setItem('taku.me', q.get('me'));
    else if (!localStorage.getItem('taku.me')) localStorage.setItem('taku.me', 'ひより');
    if (q.get('theme') === 'dark' || q.get('theme') === 'light') localStorage.setItem('taku.theme', q.get('theme'));
  } catch (e) {}
})();
</script>
"""

BADGE = r"""
  <style>
    /* デモ: シートとログアウトは無い */
    #sheetLink, #stSheetLink, #logoutBtn, #stLogout { display: none !important; }
    .demo-badge { position: fixed; left: max(12px, env(safe-area-inset-left)); bottom: 12px; z-index: 60; display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 8px 6px 14px; border-radius: 999px; background: var(--toast); color: var(--toast-text); font-size: 12px; font-weight: 600; box-shadow: var(--shadow-lg); }
    .demo-badge button { font: inherit; font-size: 12px; height: 28px; padding: 0 10px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--toast-text) 16%, transparent); color: inherit; cursor: pointer; }
    @media (max-width: 600px) { .demo-badge { bottom: calc(var(--nav-h, 64px) + 12px + env(safe-area-inset-bottom)); } }
  </style>
  <div class="demo-badge" id="demoBadge" role="note">デモ画面・操作は保存されません<button type="button" id="demoReset">最初に戻す</button></div>
  <script>
    (function () {
      if (new URLSearchParams(location.search).has('clean')) document.getElementById('demoBadge').remove();
      else document.getElementById('demoReset').onclick = function () { try { localStorage.removeItem('taku.cache'); } catch (e) {} location.reload(); };
    })();
  </script>
"""

anchor = "<script>\n    var D = null;"
assert console.count(anchor) == 1
out = console.replace(anchor, "<script>\n" + backend + STUB + "</script>\n  " + anchor, 1)
assert out.count("</body>") == 1
out = out.replace("</body>", BADGE + "</body>", 1)
assert out.count("<head>") == 1
out = out.replace("<head>", "<head>\n" + PARAMS, 1)
(here / DEMO).write_text(out, encoding="utf-8")

# 使い方のページの「アプリを開く」をデモ画面へ向ける（本物は doGet が末尾に足している）
tut = tutorial.rstrip() + "\n<script>window.APP_URL = " + json.dumps(DEMO) + ";</script>\n"
(here / TUTORIAL).write_text(tut, encoding="utf-8")
print("written", DEMO, len(out), "/", TUTORIAL, len(tut))
