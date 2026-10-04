// 前に CDN（AWS CloudFront など）を置いて、独自のドメインで公開するとき。
// Worker に届く要求のアドレスは workers.dev のまま（ここでは https://yoki.workers.test）で、公開のアドレスは APP_URL（https://app.example）
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../src/worker/app';
import { appOrigin } from '../../src/worker/auth/origin';
import { mockDiscord, SID, setupGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

const WORKER = 'https://yoki.workers.test';
const APP = 'https://app.example';
const behindCdn = { ...env, APP_URL: APP };
const req = (path: string, init: RequestInit = {}, e: typeof env = behindCdn) => app.request(WORKER + path, { redirect: 'manual', ...init }, e);

test('アプリのアドレスは APP_URL。無ければ届いた要求のアドレス', () => {
  expect(appOrigin({ APP_URL: APP + '/x/' }, WORKER + '/g/a/')).toBe(APP);
  expect(appOrigin({ APP_URL: '' }, WORKER + '/g/a/')).toBe(WORKER);
});

describe('アドレスが workers.dev のまま届いても、公開のアドレスで動く', () => {
  test('CSRF: 公開のアドレスからの書き込みは受け、ほかのサイトからは断る', async () => {
    const post = (origin: string) => req('/api/groups', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    // 通ったあとはログインしていないので AUTH: になる
    expect((await post(APP)).status).toBe(401);
    expect((await post(WORKER)).status).toBe(401);
    expect((await post('https://evil.example')).status).toBe(403);
  });

  test('Discord ログインの戻り先は、公開のアドレス', async () => {
    const d = mockDiscord({ user: { id: '100', username: 'alice', global_name: 'アリス' }, guilds: [] });
    const login = await req('/auth/login');
    const to = new URL(login.headers.get('Location')!);
    expect(to.searchParams.get('redirect_uri')).toBe(APP + '/auth/callback');
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
    const back = await req('/auth/callback?code=c&state=' + to.searchParams.get('state'), { headers: { Cookie: cookie } });
    expect(back.status).toBe(302);
    // トークンを取るときの redirect_uri も同じにする（Discord が照らし合わせる）
    expect(new URLSearchParams(String(d.calls[0]!.init?.body)).get('redirect_uri')).toBe(APP + '/auth/callback');
  });

  test('画面に渡すグループのアドレス（Discord の知らせのリンク）は、公開のアドレス', async () => {
    const { admin } = await setupGroup();
    const res = await req('/api/g/grp/getConsoleData', { method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json', Cookie: SID + '=' + admin }, body: '{}' });
    expect((await res.json<{ appUrl: string }>()).appUrl).toBe(APP + '/g/grp/');
  });
});
