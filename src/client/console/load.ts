// 読み込み・この端末の控え・自動更新
import type { ConsoleData } from '../../shared/api';
import { afterWrites, api, GROUP_ID } from './api';
import { hhmm } from './dates';
import { $, esc, load, mi, toast } from './dom';
import { buildStatic, renderAll } from './render';
import { D, type Inflight, setD, sync } from './state';
import { showTab } from './tabs';

/** 読み込み中の骨組み（読み込みに失敗したあと、もう一度読むときに戻す） */
let skeleton = '';
export function loadingMsg(text: string, retry: boolean, link?: { href: string; label: string }): void {
  $('loading').innerHTML = '<div class="msg"><p>' + esc(text) + '</p>' + (retry ? '<button type="button" class="btn primary" id="loadRetry">' + mi('refresh', 'sm') + 'もう一度読み込む</button>' : '') +
    (link ? '<a class="btn primary" href="' + esc(link.href) + '">' + esc(link.label) + '</a>' : '') + '</div>';
  if (retry) $('loadRetry').onclick = () => { $('loading').innerHTML = skeleton; reload(false); };
}
/** グループが消された（ほかのタブや、ほかの管理者が消した）。控えを消し、読むのをやめ、入口へ案内する */
export function showGone(text: string): void {
  sync.stopped = true;
  clearCache();
  document.querySelectorAll<HTMLElement>('main > section').forEach((el) => { el.hidden = true; });
  $('loading').hidden = false;
  loadingMsg(text, false, { href: '/', label: '入口へ' });
}
/** 中身が変わったかを比べる印。読み込んだ時刻だけは毎回変わるので外す */
function dataSig(d: ConsoleData): string { const { loadedAt: _, ...rest } = d; return JSON.stringify(rest); }
export function applyData(d: ConsoleData): void {
  setD(d);
  sync.sig = dataSig(d); sync.last = Date.now(); sync.failed = false; sync.stale = false;
  buildStatic(); renderAll(); saveCache(d);
}

/* この端末に最後の内容を控えておき、次に開いたときは待たずにそれを描く。すぐ後ろで最新を読み直す */
/** グループごとに分ける（別のグループの中身が一瞬出ないように） */
function cacheKey(): string { return 'taku.cache:' + GROUP_ID; }
function saveCache(d: ConsoleData): void { try { localStorage.setItem(cacheKey(), JSON.stringify(d)); } catch { /* 使えない端末 */ } }
export function clearCache(): void { try { localStorage.removeItem(cacheKey()); } catch { /* 使えない端末 */ } }
export function paintFromCache(): boolean {
  let d: ConsoleData | null = null;
  try { d = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch { d = null; }
  if (!d || !d.sessions || !d.members) return false;
  $('loading').hidden = true; $('logoutBtn').hidden = false;
  applyData(d);
  showTab(load('tab') || 'cal');
  sync.last = 0;   // 控えは古いかもしれないので、すぐ読み直す
  return true;
}

/** 自動更新の間隔（分）。このブラウザだけの設定。未設定なら 3 分、0 はしない */
export function autoMinutes(): number { const v = load('autoRefresh'); return v === '' ? 3 : Math.max(0, +v || 0); }
export function showLoadedAt(): void {
  if (!D) return;
  const el = $('loadedAt'), min = autoMinutes();
  el.innerHTML = '<span>' + esc(hhmm(D.loadedAt)) + '</span><span class="btxt"> 時点</span>';
  el.className = 'sync-at' + (sync.failed ? ' err' : min ? ' live' : '');
  el.title = (sync.failed ? '自動更新で読み込めませんでした。通信を確かめてください。' : '') + D.loadedAt + ' に読み込みました。自動更新: ' + (min ? min + ' 分ごと' : 'しない');
}
function setSyncBusy(on: boolean): void { const b = $('reload'); b.disabled = on; b.classList.toggle('busy', on); b.setAttribute('aria-busy', on ? 'true' : 'false'); }

/**
 * 読み込む。mode は 'boot'（開いたとき・ログインしたあと）、'manual'（更新ボタン）、'auto'（自動更新）。
 * 更新ボタンは、回る印と吹き出しで結果を返す。自動更新は、中身が変わったときだけ描き直す。
 * 読んでいるあいだに書き込みが始まったら、その結果は捨てて、書き込みの返事のあとで読み直す
 */
export function reload(keepTab: boolean, modeIn?: Inflight['mode']): void {
  if (sync.stopped) return;
  const mode = modeIn || (keepTab ? 'manual' : 'boot');
  if (sync.inflight) { if (mode === 'manual') { sync.inflight.manual = true; setSyncBusy(true); } return; }
  const req: Inflight = sync.inflight = { mode, manual: mode === 'manual', epoch: sync.epoch, t0: Date.now() };
  if (req.manual) setSyncBusy(true);
  const done = () => {
    sync.inflight = null;
    const wait = req.manual ? 500 - (Date.now() - req.t0) : 0;   // 押した手応えが見えるよう、回る印は少しだけ残す
    if (wait > 0) setTimeout(() => { if (!sync.inflight) setSyncBusy(false); }, wait); else setSyncBusy(false);
  };
  api<ConsoleData>().withSuccessHandler((d) => {
    done();
    if (D && req.epoch !== sync.epoch) { sync.stale = true; afterWrites(); return; }
    const changed = !D || dataSig(d) !== sync.sig;
    if (req.mode === 'auto' && !req.manual) {
      if (sync.pending || autoBlocked()) return;   // いまは描かない。次の確認でもう一度読む
      if (!changed) { D.loadedAt = d.loadedAt; sync.last = Date.now(); sync.failed = false; showLoadedAt(); return; }
      applyData(d);
      toast('ほかの人の変更を反映しました');
      return;
    }
    $('loading').hidden = true; $('logoutBtn').hidden = false;
    applyData(d);
    if (!keepTab && req.mode === 'boot' && !document.body.getAttribute('data-tab')) showTab(load('tab') || 'cal');
    if (req.manual) toast((changed ? '最新の状態にしました' : '最新の状態です。変更はありません') + '（' + hhmm(d.loadedAt) + ' 時点）');
  }).withFailureHandler((e) => {
    done();
    if (req.mode === 'auto' && !req.manual) { sync.failed = true; showLoadedAt(); return; }
    if (!D) loadingMsg('読み込みに失敗しました: ' + e.message, true);
    toast('読み込めませんでした: ' + e.message);
  }).getConsoleData();
}
/** 自動更新を待つとき: 画面が隠れている、窓が開いている、文字を入力中、予定表をドラッグ中 */
function autoBlocked(): boolean {
  if (!D || document.hidden) return true;
  if (document.querySelector('.modal:not([hidden])') || document.querySelector('.wrap.dragging')) return true;
  const a = document.activeElement;
  return !!(a && a.matches && a.matches('textarea, input[type=text], input[type=password], input:not([type])'));
}
function autoTick(force: boolean): void {
  const min = autoMinutes();
  if (!D || sync.stopped || sync.inflight || sync.pending || (!min && !force)) return;
  if (!force && Date.now() - sync.last < min * 60000) return;
  if (autoBlocked()) return;
  reload(true, 'auto');
}
/** ほかのタブや別のアプリから戻ったとき。自動更新が有効で、前の読み込みから 1 分以上経っていれば読む */
function wake(): void { const min = autoMinutes(); if (min && D && !document.hidden && Date.now() - sync.last > Math.min(min * 60000, 60000)) autoTick(true); }

export function init(): void {
  skeleton = $('loading').innerHTML;
  setInterval(() => { autoTick(false); }, 15000);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  $('reload').onclick = () => { reload(true); };
}
