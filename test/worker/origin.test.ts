// アプリのアドレス。前にCDN（AWS CloudFrontなど）を置いて、独自のドメインで公開するときは、
// Workerに届く要求のアドレスはworkers.devのまま（ここでは https://yoki.workers.test）で、公開のアドレスはAPP_URL（https://app.example）。
// APP_URLが無い（workers.devのまま公開した）ときは、届いたアドレスを使い、見回りのためにログインのときに控える
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../src/worker/app';
import { appOrigin, rememberOrigin, savedOrigin } from '../../src/worker/auth/origin';
import { mockDiscord, SID, setupGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

const WORKER = 'https://yoki.workers.test';
const APP = 'https://app.example';
const behindCdn = { ...env, APP_URL: APP };
const req = (path: string, init: RequestInit = {}, e: typeof env = behindCdn) => app.request(WORKER + path, { redirect: 'manual', ...init }, e);

test('アプリのアドレスはAPP_URL。無ければ届いた要求のアドレス', () => {
  expect(appOrigin({ APP_URL: APP + '/x/' }, WORKER + '/g/a/')).toBe(APP);
  expect(appOrigin({ APP_URL: '' }, WORKER + '/g/a/')).toBe(WORKER);
});

describe('APP_URLが無い（workers.devのまま公開した）とき', () => {
  const plain = { ...env, APP_URL: '' };

  test('ログインのたびに届いたアドレスを控え、要求の無い見回りはそれを使う。APP_URLがあればそちら', async () => {
    expect(await savedOrigin(plain)).toBe('');
    mockDiscord({ user: { id: '100', username: 'alice' }, guilds: [] });
    const login = await req('/auth/login', {}, plain);
    const state = new URL(login.headers.get('Location')!).searchParams.get('state');
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
    expect((await req('/auth/callback?code=c&state=' + state, { headers: { Cookie: cookie } }, plain)).status).toBe(302);
    expect(await savedOrigin(plain)).toBe(WORKER);
    // アドレスが変われば書き直す
    await rememberOrigin(env.DB, 'https://new.example');
    expect(await savedOrigin(plain)).toBe('https://new.example');
    expect(await savedOrigin(behindCdn)).toBe(APP);
  });

  test('入口のリンクの見た目（OGP）は、届いたアドレスを入れた形', async () => {
    const html = await (await req('/', {}, plain)).text();
    expect(html).toContain('<meta property="og:image" content="' + WORKER + '/og.png">');
    expect(html).toContain('<meta property="og:url" content="' + WORKER + '/">');
  });
});

describe('アドレスがworkers.devのまま届いても、公開のアドレスで動く', () => {
  test('入口のリンクの見た目（OGP）は、公開のアドレスを入れた形', async () => {
    const res = await req('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta property="og:image" content="' + APP + '/og.png">');
    expect(html).toContain('<meta property="og:title" content="卓予定">');
    // 骨組みの、アドレスを省いたタグは残さない
    expect(html).not.toContain('content="/og.png"');
  });

  test('CSRF: 公開のアドレスからの書き込みは受け、ほかのサイトからは断る', async () => {
    const post = (origin: string) => req('/api/groups', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    // 通ったあとはログインしていないのでAUTH: になる
    expect((await post(APP)).status).toBe(401);
    expect((await post(WORKER)).status).toBe(401);
    expect((await post('https://evil.example')).status).toBe(403);
  });

  test('Discordログインの戻り先は、公開のアドレス', async () => {
    const d = mockDiscord({ user: { id: '100', username: 'alice', global_name: 'アリス' }, guilds: [] });
    const login = await req('/auth/login');
    const to = new URL(login.headers.get('Location')!);
    expect(to.searchParams.get('redirect_uri')).toBe(APP + '/auth/callback');
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
    const back = await req('/auth/callback?code=c&state=' + to.searchParams.get('state'), { headers: { Cookie: cookie } });
    expect(back.status).toBe(302);
    // トークンを取るときのredirect_uriも同じにする（Discordが照らし合わせる）
    expect(new URLSearchParams(String(d.calls[0]!.init?.body)).get('redirect_uri')).toBe(APP + '/auth/callback');
  });

  test('画面に渡すグループのアドレス（Discordの知らせのリンク）は、公開のアドレス', async () => {
    const { admin } = await setupGroup();
    const res = await req('/api/g/grp/getConsoleData', { method: 'POST', headers: { Origin: APP, 'Content-Type': 'application/json', Cookie: SID + '=' + admin }, body: '{}' });
    expect((await res.json<{ appUrl: string }>()).appUrl).toBe(APP + '/g/grp/');
  });
});
