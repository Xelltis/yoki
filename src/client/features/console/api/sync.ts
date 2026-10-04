// グループの画面のデータの読み書き。データは TanStack Query の入れ物（キー ['console', グループの ID]）に置き、
// いつ読むか・書いたあとにどう当てるかを、ここで決める（前の画面の load.ts と api.ts の決まりと同じ）。
//   - 開いたら、この端末の控えを先に描き、すぐ最新を読む（控えに書くのは、サーバーから来たデータだけ）
//   - 書き込みの返事には最新のデータが付いてくる。ほかの書き込みが返事待ちなら、まだ当てない（押した瞬間の表示が戻らないように）。
//     全部の返事が来て、当てるのを見送ったぶんがあれば、そっと読み直す
//   - 読んでいる途中に書き込みが始まったら、その読み込みは捨てる（書き込みの前のデータなので）
//   - 自動の読み直しは、隠れている・窓が開いている・表をつかんでいる・文字を打っているあいだは待つ
//   - ログインが切れたらログインし直す（2 回まで）。グループが消されたら、控えを消して読むのをやめる
import type { QueryClient } from '@tanstack/react-query';
import type { ConsoleData, RpcName } from '../../../../shared/api';
import { load, store } from '../../../app/storage';
import { createStore, type Store } from '../../../ui/store';
import { hhmm } from '../model/dates';
import { type Rpc, RpcError } from './rpc';

export type SyncView = {
  /** boot は読み込み中（まだデータが無い）、ready は描ける、error はデータが無いまま読めなかった、gone はグループが消された、relogin はログインし直せなかった */
  phase: 'boot' | 'ready' | 'error' | 'gone' | 'relogin';
  /** error・gone・relogin のときに出す文 */
  message: string;
  /** 手で読み直している（更新ボタンが回る） */
  busy: boolean;
  /** 自動の読み直しに失敗した（上の帯の時刻の印が赤くなる） */
  failed: boolean;
  /** 自動更新の間隔（分）。0 はしない */
  autoMin: number;
};

type Mode = 'boot' | 'manual' | 'auto' | 'quiet';
type Reading = { ctl: AbortController; mode: Mode; manual: boolean; t0: number };

/** 外の働き（テストで差し替える） */
export type SyncDeps = {
  rpc: Rpc;
  toast: (text: string) => void;
  /** 自動の読み直しを待つときか */
  blocked: () => boolean;
  /** ログインし直しに行く */
  goLogin: () => void;
};

export const consoleKey = (groupId: string) => ['console', groupId] as const;

/** 中身が変わったかを比べる印。読み込んだ時刻だけは毎回変わるので外す */
export function sigOf(d: ConsoleData): string {
  const { loadedAt: _, ...rest } = d;
  return JSON.stringify(rest);
}

/* この端末の控え（グループごと） */
const cacheKey = (groupId: string) => 'taku.cache:' + groupId;
export function readCache(groupId: string): ConsoleData | null {
  let d: ConsoleData | null = null;
  try { d = JSON.parse(localStorage.getItem(cacheKey(groupId)) || 'null') as ConsoleData | null; } catch { d = null; }
  // 古い形の控え（知らせを Bot に替える前のもの。bot が無い）は使わない
  return d && d.sessions && d.members && d.bot ? d : null;
}
function saveCache(groupId: string, d: ConsoleData): void { try { localStorage.setItem(cacheKey(groupId), JSON.stringify(d)); } catch { /* 使えない端末 */ } }
export function clearCache(groupId: string): void { try { localStorage.removeItem(cacheKey(groupId)); } catch { /* 使えない端末 */ } }

/** 自動更新の間隔（分）。このブラウザだけの設定。未設定なら 3 分、0 はしない */
export function autoMinutes(): number { const v = load('autoRefresh'); return v === '' ? 3 : Math.max(0, +v || 0); }

/** 自動の読み直しを待つとき: 画面が隠れている、窓が開いている、文字を入力中、予定表をつかんで動かしている */
export function domBlocked(): boolean {
  if (document.hidden) return true;
  if (document.querySelector('.modal:not([hidden])') || document.querySelector('.wrap.dragging')) return true;
  const a = document.activeElement;
  return !!(a && a.matches && a.matches('textarea, input[type=text], input[type=password], input:not([type])'));
}

export class ConsoleSync {
  readonly key: readonly ['console', string];
  readonly view: Store<SyncView>;
  /** 返事待ちの書き込みの数 */
  private pending = 0;
  /** 当てるのを見送ったデータがある（書き込みの返事が全部来たら読み直す） */
  private stale = false;
  private last = 0;
  private sig = '';
  private reading: Reading | null = null;

  constructor(private readonly qc: QueryClient, readonly groupId: string, private readonly deps: SyncDeps) {
    this.key = consoleKey(groupId);
    this.view = createStore<SyncView>({ phase: 'boot', message: '', busy: false, failed: false, autoMin: autoMinutes() });
  }

  data(): ConsoleData | undefined { return this.qc.getQueryData<ConsoleData>(this.key); }

  /** 開いたとき: 控えがあれば先に描き、すぐ最新を読む。自動の読み直しを始める。止める関数を返す */
  start(): () => void {
    const cached = readCache(this.groupId);
    if (cached && !this.data()) {
      this.qc.setQueryData(this.key, cached);
      this.sig = sigOf(cached);
      this.view.set((v) => ({ ...v, phase: 'ready' }));
    }
    void this.refresh('boot');
    const tick = window.setInterval(() => { this.autoTick(false); }, 15000);
    const wake = () => { this.wake(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      this.reading?.ctl.abort('stop');
      this.reading = null;
    };
  }

  /**
   * 読み込む。boot は開いたとき、manual は更新ボタン、auto は自動更新、quiet は書き込みのあとの読み直し（吹き出しを出さない）。
   * 更新ボタンは、回る印と吹き出しで結果を返す。自動更新は、中身が変わったときだけ描き直す
   */
  async refresh(mode: Mode): Promise<void> {
    if (this.view.get().phase === 'gone') return;
    if (this.reading) {
      if (mode === 'manual') { this.reading.manual = true; this.setBusy(true); }
      return;
    }
    const req: Reading = { ctl: new AbortController(), mode, manual: mode === 'manual', t0: Date.now() };
    this.reading = req;
    if (req.manual) this.setBusy(true);
    try {
      const d = await this.deps.rpc<ConsoleData>(this.groupId, 'getConsoleData', {}, req.ctl.signal);
      this.done(req);
      const before = this.data();
      const changed = !before || sigOf(d) !== this.sig;
      if (req.mode === 'auto' && !req.manual) {
        if (this.pending || this.deps.blocked()) return;   // いまは描かない。次の確認でもう一度読む
        if (!changed) {
          this.qc.setQueryData(this.key, { ...before!, loadedAt: d.loadedAt });
          this.last = Date.now();
          this.view.set((v) => ({ ...v, failed: false }));
          return;
        }
        this.apply(d);
        this.deps.toast('ほかの人の変更を反映しました');
        return;
      }
      this.apply(d);
      if (req.manual) this.deps.toast((changed ? '最新の状態にしました' : '最新の状態です。変更はありません') + '（' + hhmm(d.loadedAt) + ' 時点）');
    } catch (e) {
      this.done(req);
      if (req.ctl.signal.aborted) {
        // 書き込みが始まったので捨てた。書き込みの返事のあとで読み直す
        if (req.ctl.signal.reason === 'write') this.stale = true;
        return;
      }
      if (this.loginOrGone(e)) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (req.mode === 'auto' && !req.manual) { this.view.set((v) => ({ ...v, failed: true })); return; }
      if (!this.data()) this.view.set((v) => ({ ...v, phase: 'error', message: '読み込みに失敗しました: ' + msg }));
      this.deps.toast('読み込めませんでした: ' + msg);
    }
  }

  /**
   * 書き込む（読み込みのほかの呼び出し）。optimistic を渡すと、返事を待たずにデータをその形にする（押した瞬間に見えるように）。
   * 失敗したら rollback を当て、失敗を投げる（ログインし直す・グループが消えたときは、それぞれの画面にする）。
   * 返事にデータが付いていなければ読み直す。quiet なら読み直さない（Discord への送信の途中など、データが変わらないとき）
   */
  async write<R extends { data?: ConsoleData }>(name: RpcName, form: object = {}, opts: { optimistic?: (d: ConsoleData) => ConsoleData; rollback?: (d: ConsoleData) => ConsoleData; quiet?: boolean } = {}): Promise<R> {
    this.pending++;
    this.reading?.ctl.abort('write');
    const cur = this.data();
    if (opts.optimistic && cur) this.qc.setQueryData(this.key, opts.optimistic(cur));
    try {
      const r = await this.deps.rpc<R>(this.groupId, name, form);
      this.pending--;
      if (r.data || !opts.quiet) this.take(r);
      return r;
    } catch (e) {
      this.pending--;
      if (!this.loginOrGone(e)) {
        const now = this.data();
        if (opts.rollback && now) this.qc.setQueryData(this.key, opts.rollback(now));
      }
      throw e;
    } finally {
      this.afterWrites();
    }
  }

  /** データを変えない呼び出し（Discord のチャンネルの一覧など）。書き込みとは数えない */
  async call<R>(name: RpcName, form: object = {}): Promise<R> {
    try {
      return await this.deps.rpc<R>(this.groupId, name, form);
    } catch (e) {
      this.loginOrGone(e);
      throw e;
    }
  }

  /** 書き込みの返事のデータを当てる。ほかの書き込みが返事待ちなら見送る。データが付いていなければ読み直す */
  take(r: { data?: ConsoleData } | null | undefined): void {
    if (r && r.data) {
      if (this.pending > 0) { this.stale = true; return; }
      this.apply(r.data);
    } else void this.refresh('quiet');
  }

  /** 自動更新の間隔を変える（この端末だけ） */
  setAutoMinutes(min: number): void {
    store('autoRefresh', String(min));
    this.view.set((v) => ({ ...v, autoMin: autoMinutes() }));
  }

  /** グループが消された。控えを消し、読むのをやめ、入口へ案内する */
  setGone(message: string): void {
    clearCache(this.groupId);
    this.view.set((v) => ({ ...v, phase: 'gone', message, busy: false }));
  }

  /** ログアウトの前に、この端末の控えを消す */
  forget(): void { clearCache(this.groupId); }

  private apply(d: ConsoleData): void {
    this.qc.setQueryData(this.key, d);
    this.sig = sigOf(d);
    this.last = Date.now();
    this.stale = false;
    saveCache(this.groupId, d);
    this.view.set((v) => ({ ...v, phase: 'ready', failed: false }));
  }

  private afterWrites(): void {
    if (!this.pending && this.stale && this.data()) { this.stale = false; void this.refresh('quiet'); }
  }

  private done(req: Reading): void {
    if (this.reading === req) this.reading = null;
    if (!req.manual) return;
    // 押した手応えが見えるよう、回る印は少しだけ残す
    const wait = 500 - (Date.now() - req.t0);
    if (wait > 0) setTimeout(() => { if (!this.reading) this.setBusy(false); }, wait); else this.setBusy(false);
  }

  private setBusy(on: boolean): void { this.view.set((v) => (v.busy === on ? v : { ...v, busy: on })); }

  /** ログインが切れた・グループが消された失敗なら、その画面にして true を返す */
  private loginOrGone(e: unknown): boolean {
    if (!(e instanceof RpcError)) return false;
    if (e.kind === 'gone') { this.setGone(e.message); return true; }
    if (e.kind !== 'auth') return false;
    // ログインし直す。続くときは止める（Discord の設定の誤りなどで、行き来を繰り返さないように）
    let n = 0;
    try { n = +(sessionStorage.getItem('taku.relogin') || 0) || 0; sessionStorage.setItem('taku.relogin', String(n + 1)); } catch { /* 使えない端末 */ }
    if (n >= 2) this.view.set((v) => ({ ...v, phase: 'relogin', message: 'ログインできませんでした。入口から開き直してください。' }));
    else this.deps.goLogin();
    return true;
  }

  private autoTick(force: boolean): void {
    const min = autoMinutes();
    if (!this.data() || this.view.get().phase === 'gone' || this.reading || this.pending || (!min && !force)) return;
    if (!force && Date.now() - this.last < min * 60000) return;
    if (this.deps.blocked()) return;
    void this.refresh('auto');
  }

  /** ほかのタブや別のアプリから戻ったとき。自動更新が有効で、前の読み込みから 1 分以上（間隔が短ければその間隔）経っていれば読む */
  private wake(): void {
    const min = autoMinutes();
    if (min && this.data() && !document.hidden && Date.now() - this.last > Math.min(min * 60000, 60000)) this.autoTick(true);
  }
}
