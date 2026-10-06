// グループの画面のデータの読み書き（features/console/api/sync.ts）: 読み込みと書き込みが重なったときの順番。
// サーバーの呼び出しを差し替え、返事の順を手で決めて確かめる
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ConsoleData } from '../../src/shared/api';
import { RpcError } from '../../src/client/features/console/api/rpc';
import { ConsoleSync, sigOf } from '../../src/client/features/console/api/sync';

/** 見分けられるだけの、小さな画面のデータ */
const data = (title: string, loadedAt = '2026-10-05 10:00') => ({ title, loadedAt, sessions: [], members: [], bot: { ready: true, inviteUrl: '' } }) as unknown as ConsoleData;

type Call = { name: string; form: object; resolve: (v: unknown) => void; reject: (e: unknown) => void };
let calls: Call[];
let qc: QueryClient;
let toasts: string[];
let blocked: boolean;
let logins: number;
let sync: ConsoleSync;

/** 返事を待たせるサーバー。取り消されたらAbortErrorで断る */
const rpc = <R,>(_g: string, name: string, form: object = {}, signal?: AbortSignal) =>
  new Promise<R>((resolve, reject) => {
    calls.push({ name, form, resolve: resolve as (v: unknown) => void, reject });
    signal?.addEventListener('abort', () => reject(new DOMException('取り消し', 'AbortError')));
  });
const reads = () => calls.filter((c) => c.name === 'getConsoleData');
const shown = () => qc.getQueryData<ConsoleData>(sync.key)?.title;
/** 待っている呼び出しを片付けて、続きを進める */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = []; toasts = []; blocked = false; logins = 0;
  qc = new QueryClient();
  sync = new ConsoleSync(qc, 'grp', { rpc, toast: (t) => toasts.push(t), blocked: () => blocked, goLogin: () => { logins++; } });
});

describe('読み込み', () => {
  test('開いたときの読み込みで描けるようになる。手で読み直すと、変わったかを吹き出しで返す', async () => {
    const boot = sync.refresh('boot');
    expect(sync.view.get().phase).toBe('boot');
    reads()[0]!.resolve(data('A'));
    await boot;
    expect(sync.view.get().phase).toBe('ready');
    expect(shown()).toBe('A');
    const manual = sync.refresh('manual');
    expect(sync.view.get().busy).toBe(true);
    reads()[1]!.resolve(data('A', '2026-10-05 10:05'));
    await manual;
    expect(toasts).toEqual(['最新の状態です。変更はありません（10:05時点）']);
  });

  test('読んでいる途中にもう一度頼んでも、同じ読み込みを待つ（手で頼んだら回る印を出す）', async () => {
    void sync.refresh('auto');
    void sync.refresh('manual');
    expect(reads()).toHaveLength(1);
    expect(sync.view.get().busy).toBe(true);
  });

  test('自動の読み直し: 変わらなければ時刻だけ。待つとき（窓・入力中）は描かない。変わったら描いて知らせる', async () => {
    const boot = sync.refresh('boot'); reads()[0]!.resolve(data('A')); await boot;
    let auto = sync.refresh('auto'); reads()[1]!.resolve(data('A', '2026-10-05 11:00')); await auto;
    expect(qc.getQueryData<ConsoleData>(sync.key)!.loadedAt).toBe('2026-10-05 11:00');
    blocked = true;
    auto = sync.refresh('auto'); reads()[2]!.resolve(data('B')); await auto;
    expect(shown()).toBe('A');
    blocked = false;
    auto = sync.refresh('auto'); reads()[3]!.resolve(data('B')); await auto;
    expect(shown()).toBe('B');
    expect(toasts).toEqual(['ほかの人の変更を反映しました']);
  });

  test('自動の読み直しに失敗したら印だけ。データが無いまま読めなければ、もう一度読む画面にする', async () => {
    let r = sync.refresh('boot'); reads()[0]!.reject(new RpcError('network', '通信できませんでした。')); await r;
    expect(sync.view.get()).toMatchObject({ phase: 'error', message: '読み込みに失敗しました: 通信できませんでした。' });
    r = sync.refresh('boot'); reads()[1]!.resolve(data('A')); await r;
    r = sync.refresh('auto'); reads()[2]!.reject(new RpcError('timeout', '返事がありません')); await r;
    expect(sync.view.get()).toMatchObject({ phase: 'ready', failed: true });
  });
});

describe('書き込みと読み込みが重なったとき', () => {
  test('読んでいる途中に書き込みが始まったら、その読み込みは捨てる。書き込みの返事のデータを描く', async () => {
    void sync.refresh('quiet');
    const w = sync.write('saveSession', { name: '卓' });
    await flush();
    calls.find((c) => c.name === 'saveSession')!.resolve({ ok: true, data: data('書いたあと') });
    await w;
    expect(shown()).toBe('書いたあと');
    expect(reads()).toHaveLength(1);
  });

  test('ほかの書き込みが返事待ちなら、先に来た返事のデータは描かず、最後の返事で描く', async () => {
    const w1 = sync.write('setAvailability', { mark: '△' });
    const w2 = sync.write('setAvailability', { mark: '×' });
    calls[0]!.resolve({ ok: true, data: data('1つ目のあと') });
    await w1;
    expect(shown()).toBeUndefined();
    calls[1]!.resolve({ ok: true, data: data('2つ目のあと') });
    await w2;
    expect(shown()).toBe('2つ目のあと');
  });

  test('先に来た返事を見送り、最後の返事にデータが無ければ、読み直す', async () => {
    const w1 = sync.write('setAvailability', {});
    const w2 = sync.write('setDayNote', {});
    calls[0]!.resolve({ ok: true, data: data('見送る') });
    await w1;
    calls[1]!.resolve({ ok: true });
    await w2;
    await flush();
    expect(reads()).toHaveLength(1);
    reads()[0]!.resolve(data('読み直した'));
    await flush();
    expect(shown()).toBe('読み直した');
  });

  test('返事を待たずに描く書き込み（optimistic）。失敗したらrollbackを当てて、失敗を返す', async () => {
    const r = sync.refresh('boot'); reads()[0]!.resolve(data('元')); await r;
    const w = sync.write('setAvailability', {}, { optimistic: (d) => ({ ...d, title: '押した瞬間' }), rollback: (d) => ({ ...d, title: '戻した' }) });
    expect(shown()).toBe('押した瞬間');
    calls.at(-1)!.reject(new RpcError('fail', '範囲外です'));
    await expect(w).rejects.toThrow('範囲外です');
    expect(shown()).toBe('戻した');
  });
});

describe('ログインとグループ', () => {
  test('ログインが切れたらログインし直しに行く（3回目からは止めて案内する）', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    for (let i = 0; i < 3; i++) {
      const r = sync.refresh('boot'); reads().at(-1)!.reject(new RpcError('auth', 'ログインしてください。')); await r;
    }
    expect(logins).toBe(2);
    expect(sync.view.get()).toMatchObject({ phase: 'relogin', message: 'ログインできませんでした。入口から開き直してください。' });
    vi.unstubAllGlobals();
  });

  test('グループが消されたら、読むのをやめて案内する。書き込みの失敗でも同じ', async () => {
    const w = sync.write('saveSession', {});
    calls[0]!.reject(new RpcError('gone', 'このグループは見つかりません。'));
    await expect(w).rejects.toThrow();
    expect(sync.view.get()).toMatchObject({ phase: 'gone', message: 'このグループは見つかりません。' });
    await sync.refresh('manual');
    expect(reads()).toHaveLength(0);
  });

  test('中身の印は、読み込んだ時刻を見ない', () => {
    expect(sigOf(data('A', 't1'))).toBe(sigOf(data('A', 't2')));
    expect(sigOf(data('A'))).not.toBe(sigOf(data('B')));
  });
});
