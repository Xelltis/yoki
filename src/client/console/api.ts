// サーバーとのやり取り（POST /api/g/:id/:fn）と、Discord への送信
import { type ConsoleData, type DiscordReason, type DiscordStepResult, RPC_FUNCS, type RpcName, type RpcResult } from '../../shared/api';
import { $, toast } from './dom';
import { applyData, loadingMsg, showGone } from './load';
import { D, sync } from './state';

/** このグループの ID（URL の /g/:id/） */
export const GROUP_ID = (location.pathname.match(/^\/g\/([^/]+)\//) || [])[1] || '';
/** サーバーの返事を待つ上限（ミリ秒） */
const API_WAIT = 45000;

export type Failure = { message: string };
/** 呼び出し。handler を付けてから、関数の名前で呼ぶ */
export type Call<R> = {
  withSuccessHandler(f: (r: R) => void): Call<R>;
  withFailureHandler(f: (e: Failure) => void): Call<R>;
} & { [K in RpcName]: (form?: object) => void };

/** ログインし直す。続くときは止める（Discord の設定の誤りなどで、行き来を繰り返さないように） */
function loginAgain(): void {
  let n = 0;
  try { n = +(sessionStorage.getItem('taku.relogin') || 0) || 0; sessionStorage.setItem('taku.relogin', String(n + 1)); } catch { /* 使えない端末 */ }
  if (n >= 2) { $('loading').hidden = false; loadingMsg('ログインできませんでした。入口から開き直してください。', false); return; }
  location.href = '/auth/login?return_to=' + encodeURIComponent(location.pathname);
}

/**
 * サーバーを呼ぶ。使い方: api().withSuccessHandler(f).withFailureHandler(g).saveSession(form)
 * 返事の型 R は、読み込み（getConsoleData）なら ConsoleData、Discord への送信なら DiscordStepResult、ほかは RpcResult。
 * サーバーが「AUTH:」で断ったら（ログインが切れた・Discord サーバーの控えが古い）、ログインし直してこの画面へ戻る。
 * 「ADMIN:」は管理者だけの操作。失敗として、その旨の文を返す。「GONE:」はグループが消された（入口へ案内して、読むのをやめる）
 */
export function api<R = RpcResult>(): Call<R> {
  let okF: ((r: R) => void) | null = null, ngF: ((e: Failure) => void) | null = null;
  const run = (name: RpcName, form?: object) => {
    // 書き込みは数えておく。返事待ちのあいだは自動更新をせず、古いデータで描き戻さない
    const write = name !== 'getConsoleData';
    if (write) { sync.pending++; sync.epoch++; }
    let settled = false;
    const settle = () => { if (settled) return; settled = true; if (write) sync.pending = Math.max(0, sync.pending - 1); };
    // 返事が返ってこないまま終わると、押せなくしたボタンが戻らない。API_WAIT で打ち切って失敗として返す
    const ctl = new AbortController();
    let over = false;
    const timer = setTimeout(() => {
      over = true; ctl.abort(); settle();
      if (ngF) ngF({ message: 'サーバーから返事がありません。通信を確かめて、もう一度お試しください。' });
      afterWrites();
    }, API_WAIT);
    fetch('/api/g/' + encodeURIComponent(GROUP_ID) + '/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form || {}), signal: ctl.signal, credentials: 'same-origin',
    }).then((res) => res.json().catch(() => ({})).then((body: unknown) => ({ ok: res.ok, body: body as Record<string, unknown> })))
      .then((r) => {
        if (over) return;
        clearTimeout(timer); settle();
        if (r.ok) {
          try { sessionStorage.removeItem('taku.relogin'); } catch { /* 使えない端末 */ }
          if (okF) okF(r.body as R);
          afterWrites();
          return;
        }
        let msg = String((r.body && r.body.error) || 'うまくいきませんでした。');
        if (msg.startsWith('AUTH:')) { loginAgain(); return; }
        if (msg.startsWith('GONE:')) { showGone(msg.replace(/^GONE:\s*/, '')); return; }
        msg = msg.replace(/^ADMIN:\s*/, '');
        if (ngF) ngF({ message: msg }); else toast(msg);
        afterWrites();
      })
      .catch(() => {
        if (over) return;
        clearTimeout(timer); settle();
        if (ngF) ngF({ message: '通信できませんでした。通信を確かめて、もう一度お試しください。' });
        afterWrites();
      });
  };
  const calls = {} as { [K in RpcName]: (form?: object) => void };
  RPC_FUNCS.forEach((name) => { calls[name] = (form) => run(name, form); });
  const o: Call<R> = Object.assign(calls, {
    withSuccessHandler(f: (r: R) => void) { okF = f; return o; },
    withFailureHandler(f: (e: Failure) => void) { ngF = f; return o; },
  });
  return o;
}

/** 読み直す。読んでいるあいだに別の書き込みが始まったら、その返事のあとで読み直す */
export function refetch(after?: () => void): void {
  const ep = sync.epoch;
  api<ConsoleData>().withSuccessHandler((d) => {
    if (ep !== sync.epoch) { sync.stale = true; return; }
    applyData(d);
    if (after) after();
  }).withFailureHandler((e) => { toast('読み込めませんでした: ' + e.message); }).getConsoleData();
}
/** 書き込みの返事には最新のデータが同梱されている。あればそれを使い、2 往復目をしない */
export function takeData(res: { data?: ConsoleData } | null | undefined, after?: () => void): void {
  if (res && res.data) {
    // ほかにも返事待ちの書き込みがあるなら、まだ描かない（押した瞬間の表示が一度戻るのを防ぐ）。最後の返事か読み直しで描く
    if (sync.pending > 0) { sync.stale = true; return; }
    applyData(res.data);
    if (after) after();
  } else refetch(after);
}
/** 返事待ちの書き込みが無くなったら、途中で描くのを見送った分を読み直す */
export function afterWrites(): void { if (!sync.pending && sync.stale && D) { sync.stale = false; refetch(); } }

/** 届かなかった送り先 */
type Failed = { label: string; reason: DiscordReason | null; text: string };
/** Discord への送信の結果。最後の送り先の返事に、届いた先・届かなかった先を足したもの */
export type SendResult = Partial<DiscordStepResult> & { sent: string[]; failed: Failed[]; partial: boolean };

/**
 * Discord へ送る。送り先が何か所かあれば（シリーズのチャンネルと基本のチャンネル）、1 か所ずつ順に送る。
 * 1 か所ごとにサーバーへ 1 回ずつ頼み、429 や 5xx なら秒を数えながら送り直す。
 * status(text) に進み具合が届く。done(ok, r) で終わる。ok は、すべての送り先に届いたとき true
 */
export function discordSend(form: Record<string, unknown>, status: (t: string) => void, done: (ok: boolean, r: SendResult) => void): void {
  let attempt = 1, maxTries = 3, to = 0, count = 1;
  const labels: string[] = [], sent: string[] = [], failed: Failed[] = [], got: Partial<DiscordStepResult> = {};
  const KEEP = ['data', 'asked', 'notified'] as const;   // 届いた返事に付いてくるもの。最後の送り先で失敗しても渡す
  const set = (t: string) => { if (typeof status === 'function') status(t); };
  const where = () => count > 1 ? '［' + (to + 1) + '/' + count + (labels[to] ? ' ' + labels[to] : '') + '］' : '';
  const finish = (r: Partial<DiscordStepResult>) => {
    const out: SendResult = { ...r, sent, failed, partial: sent.length > 0 && failed.length > 0 };
    KEEP.forEach((k) => { if (got[k] !== undefined && out[k] === undefined) Object.assign(out, { [k]: got[k] }); });
    if (count > 1) {
      if (!failed.length) set('Discord の ' + count + ' か所に送りました（' + sent.join('、') + '）。');
      else set((sent.length ? sent.join('、') + ' には届きました。' : '') + failed.map((f) => f.label + ' には届きませんでした（' + (f.reason ? f.reason.label : f.text) + '）').join('。') + '。');
    }
    done(!failed.length, out);
  };
  const next = (r: DiscordStepResult) => {
    if (to + 1 < count) { to++; attempt = 1; step(); } else finish(r);
  };
  const step = () => {
    set(where() + 'Discord に送信中…（' + attempt + ' 回目／最大 ' + maxTries + ' 回）');
    form.attempt = attempt; form.to = to;
    api<DiscordStepResult>().withSuccessHandler((r) => {
      if (r.maxTries) maxTries = r.maxTries;
      if (r.targetCount) count = r.targetCount;
      if (r.targetLabel) labels[to] = r.targetLabel;
      const name = labels[to] || 'Discord';
      if (r.ok) {
        sent.push(name);
        KEEP.forEach((k) => { if (r[k] !== undefined) Object.assign(got, { [k]: r[k] }); });
        set(where() + 'Discord に送りました' + (attempt > 1 ? '（' + attempt + ' 回目で成功）' : '') + '。');
        next(r);
        return;
      }
      const rs = r.reason || { kind: '', label: '原因不明', text: '', advice: '', toolFault: true };
      if (!r.retryable) {
        set(where() + '送信失敗（' + rs.label + '）: ' + rs.text + ' ' + rs.advice + (rs.toolFault ? '' : '　このツールの不具合ではありません。') +
          '　［詳細: ' + (r.raw || r.result) + '、' + attempt + ' 回試行］');
        failed.push({ label: name, reason: rs, text: r.raw || r.result });
        next(r);
        return;
      }
      const why = rs.label + 'のため、受け取りを断られました' + (rs.toolFault ? '' : '（ツールの不具合ではありません）');
      let left = Math.max(1, Math.ceil((r.waitMs || 3000) / 1000));
      attempt++;
      set(where() + why + '。' + left + ' 秒後に ' + attempt + ' 回目を送ります…');
      const timer = setInterval(() => {
        left--;
        if (left <= 0) { clearInterval(timer); step(); } else set(where() + why + '。' + left + ' 秒後に ' + attempt + ' 回目を送ります…');
      }, 1000);
    }).withFailureHandler((e) => {
      set(where() + 'Discord に送れませんでした: ' + e.message);
      failed.push({ label: labels[to] || 'Discord', reason: null, text: e.message });
      finish({ result: e.message });
    }).sendDiscordStep(form);
  };
  step();
}
/** 失敗の吹き出し。種類を先に出し、ツールの不具合でなければそう書く。一部だけ届いたときは、届いた先も添える */
export function failToast(r: SendResult): string {
  const f = r && r.failed && r.failed[0], part = !!(r && r.partial);
  const rs = f ? f.reason : r && r.reason;
  if (!rs) return (part && f ? f.label + ' に届きませんでした: ' : '送信失敗: ') + ((f && f.text) || (r && (r.raw || r.result)) || '不明');
  return (part && f ? f.label + ' に届きませんでした（' : '送信失敗（') + rs.label + '）' + (rs.toolFault ? '' : '。ツールの不具合ではありません') +
    (part ? '。' + r.sent.join('、') + ' には届きました' : '。管理画面の「送信の記録」に詳細があります');
}
