/* ---------------------------------------------------------
 * 書き込みの順番待ち
 * シートへの書き込みは、すべてスクリプト全体で 1 本のロックの中で行う。
 * 表示の描き直し（都合表を丸ごと読んで丸ごと書き戻す。十数秒かかる）の最中に誰かが △× を付けると、
 * 古い中身で上書きされて消えていた。卓の保存（1 行まるごと書く）や削除（読んだ時点の行番号で消す）も、
 * 同時に走ると互いの書き込みを消す。ロックの中で読み直してから書けば、後の人は前の人の結果の上に書く。
 * 入れ子で呼ばれても取り直さない（LOCK_DEPTH_）
 * --------------------------------------------------------- */
let LOCK_DEPTH_ = 0;
const LOCK_WAIT_MS = 30 * 1000;
const LOCK_BUSY_MSG = 'ほかの人の操作と重なりました。少し待ってから、もう一度押してください。';

/** fn をロックの中で動かす。quiet なら、待ちきれないとき例外にせず undefined を返す（見回りと描き直し用） */
function withLock_(fn, waitMs, quiet) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) {
    if (quiet) return undefined;
    throw new Error(LOCK_BUSY_MSG);
  }
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}
