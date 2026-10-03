// google.script.run の代わり。呼ばれた関数を、この画面の中のサーバー側（src/server を埋め込んだ DEV_BACKEND）で動かす。
// 行き来は JSON を通し、本物と同じく少し遅れて返す
var google = { script: { host: { close: function () {} }, run: null } };
(function () {
  var names = Object.keys(DEV_BACKEND).filter(function (n) { return n !== '__seed'; });
  function runner() {
    var ok = function () {}, ng = function () {};
    var r = { withSuccessHandler: function (f) { ok = f; return r; }, withFailureHandler: function (f) { ng = f; return r; } };
    names.forEach(function (n) {
      r[n] = function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          if (window.__hang) return;   // 返事が返ってこないときを試すため（確認用）
          var res;
          try { DEV_BACKEND.__seed(); res = DEV_BACKEND[n].apply(null, args); }
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
