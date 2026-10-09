// サーバーの呼び出し（features/console/api/rpc.ts）: 返事の本文を読む途中で取り消されたとき・本文が読めないときに、空の返事を成功として返さない
import { afterEach, expect, test, vi } from 'vitest';
import { rpc, RpcError } from '../../src/client/features/console/api/rpc';

afterEach(() => vi.unstubAllGlobals());

/** 返事の頭はすぐ返し、本文はjsonが決める（取り消されたら、本文を読むのも断る） */
function stubFetch(status: number, json: (signal: AbortSignal) => Promise<unknown>) {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ({ ok: status >= 200 && status < 300, status, json: () => json(init.signal!) }));
}
const waitAbort = (signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

test('本文を読む途中で取り消されたら、取り消しとして投げる（空の返事を、読み込んだデータにしない）', async () => {
  stubFetch(200, waitAbort);
  const ctl = new AbortController();
  const p = rpc('grp', 'getConsoleData', {}, ctl.signal);
  await new Promise((r) => setTimeout(r, 0));
  ctl.abort('write');
  await expect(p).rejects.toBe('write');
});

test('うまくいったのに本文がJSONでなければ、通信の失敗にする', async () => {
  stubFetch(200, () => Promise.reject(new SyntaxError('Unexpected token <')));
  const e = await rpc('grp', 'getConsoleData').catch((x: unknown) => x);
  expect(e).toBeInstanceOf(RpcError);
  expect(e).toMatchObject({ kind: 'network', message: 'サーバーの返事を読めませんでした。通信を確かめて、もう一度お試しください。' });
});

test('うまくいけば本文を返す。断られたら、本文の文（読めなければ決まった文）で投げる', async () => {
  stubFetch(200, async () => ({ ok: true, message: '保存しました。' }));
  expect(await rpc('grp', 'saveSession')).toEqual({ ok: true, message: '保存しました。' });
  stubFetch(403, async () => ({ error: 'ADMIN: 管理者だけです。' }));
  await expect(rpc('grp', 'saveSession')).rejects.toMatchObject({ kind: 'fail', message: '管理者だけです。' });
  stubFetch(502, () => Promise.reject(new SyntaxError('Unexpected token <')));
  await expect(rpc('grp', 'saveSession')).rejects.toMatchObject({ kind: 'fail', message: 'うまくいきませんでした。' });
});
