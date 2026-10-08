// 運営の管理画面の「更新」: 版の比べ方・元のリポジトリのReleaseを読む（1時間控える）・表の変更があるか・更新のワークフローを動かす・
// 開発用の偽のGitHub・設定（リポジトリの名前）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminUpdate } from '../../src/shared/admin';
import { app } from '../../src/worker/app';
import { newer, parseVersion, startUpdate, updateStatus } from '../../src/worker/domain/update';
import type { Bindings } from '../../src/worker/env';
import { realGitHub } from '../../src/worker/update/api';
import { DEFAULT_UPSTREAM, updateDeps, type UpdateDeps } from '../../src/worker/update/config';
import { fakeGitHub, nextMinor } from '../../src/worker/update/dev';
import { APP_VERSION } from '../../src/worker/version';
import { call, loginAs, ORIGIN, postJson, setupGroup, SID } from './helpers';

const OP = { id: '400000000000000099', name: '運営' };
const NEXT = nextMinor(APP_VERSION);
let logs: string[] = [];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)); });
});
afterEach(() => vi.restoreAllMocks());

/** GitHubのAPIの返事を差し替える。routesは「道 → 返事」（/で終わる道は、その下の全部）。呼ばれた道・方法・ヘッダー・本文を控える */
function mockGitHub(routes: Record<string, () => Response>) {
  const calls: { url: string; method: string; auth: string; body: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization') ?? '', body: String(init?.body ?? '') });
    const path = url.slice('https://api.github.com'.length).split('?')[0]!;
    const key = Object.keys(routes).find((k) => (k.endsWith('/') ? path.startsWith(k) : path === k));
    return key ? routes[key]!() : new Response('not found', { status: 404 });
  });
  return calls;
}
const release = (tag: string, extra: Record<string, unknown> = {}) => () => Response.json({ tag_name: tag, name: 'Release ' + tag, html_url: 'https://github.com/o/u/releases/tag/' + tag, published_at: '2026-10-01T00:00:00Z', body: '### 直したこと\n\n* 直す', ...extra });
const deps = (over: Partial<UpdateDeps> = {}): UpdateDeps => ({ api: realGitHub(), upstream: 'o/u', repo: 'me/yoki', token: 'tok', ...over });

describe('版を比べる', () => {
  test('頭のvはあってもなくてもよい。読めない版は比べない', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion(' 10.0.1 ')).toEqual([10, 0, 1]);
    expect(parseVersion('1.2')).toBeNull();
    expect(newer('1.10.0', '1.9.9')).toBe(true);
    expect(newer('v2.0.0', '1.99.99')).toBe(true);
    expect(newer('1.2.3', '1.2.3')).toBe(false);
    expect(newer('1.2.3', '1.3.0')).toBe(false);
    expect(newer('x', '1.0.0')).toBe(false);
    expect(nextMinor('1.2.3')).toBe('1.3.0');
    expect(nextMinor('x')).toBe('0.1.0');
  });
});

describe('新しい版を確かめる（本物のGitHub。fetchを差し替える）', () => {
  test('新しいバージョンがあれば、変わったファイルから表の変更を調べる。1時間は控えを使い、確かめ直すと読み直す', async () => {
    const calls = mockGitHub({
      '/repos/o/u/releases/latest': release('v' + NEXT),
      '/repos/o/u/compare/': () => Response.json({ files: [{ filename: 'src/a.ts' }, { filename: 'migrations/0009_x.sql' }] }),
      '/repos/me/yoki/actions/workflows/update.yml/runs': () => Response.json({ workflow_runs: [{ id: 7, status: 'completed', conclusion: 'success', created_at: '2026-10-01T01:00:00Z', html_url: 'https://github.com/me/yoki/actions/runs/7' }, { id: 6, status: 'in_progress', conclusion: null, created_at: '2026-10-01T00:00:00Z', html_url: 'u' }] }),
    });
    const now = new Date('2026-10-02T00:00:00Z');
    const u = await updateStatus(env.DB, deps(), now);
    expect(u).toMatchObject({
      current: APP_VERSION, upstream: 'o/u', available: true, migrations: true, error: '', repo: 'me/yoki', canDispatch: true,
      workflowUrl: 'https://github.com/me/yoki/actions/workflows/update.yml',
      latest: { version: NEXT, name: 'Release v' + NEXT, url: 'https://github.com/o/u/releases/tag/v' + NEXT, publishedAt: '2026-10-01T00:00:00Z', notes: '### 直したこと\n\n* 直す' },
    });
    expect(u.runs).toEqual([
      { id: 7, status: 'completed', conclusion: 'success', createdAt: '2026-10-01T01:00:00Z', url: 'https://github.com/me/yoki/actions/runs/7' },
      { id: 6, status: 'in_progress', conclusion: '', createdAt: '2026-10-01T00:00:00Z', url: 'u' },
    ]);
    expect(calls.find((c) => c.url.includes('/compare/'))!.url).toContain('/compare/v' + APP_VERSION + '...v' + NEXT);
    // Releaseは誰でも読めるので、トークンを付けない。実行の一覧はトークンで読む
    expect(calls.find((c) => c.url.endsWith('/releases/latest'))!.auth).toBe('');
    expect(calls.find((c) => c.url.includes('/runs'))!.auth).toBe('Bearer tok');
    const n = calls.filter((c) => c.url.endsWith('/releases/latest')).length;
    await updateStatus(env.DB, deps(), new Date(now.getTime() + 30 * 60_000));
    expect(calls.filter((c) => c.url.endsWith('/releases/latest')).length).toBe(n);
    await updateStatus(env.DB, deps(), new Date(now.getTime() + 30 * 60_000), true);
    expect(calls.filter((c) => c.url.endsWith('/releases/latest')).length).toBe(n + 1);
    // 元のリポジトリを変えたら、控えを使わない
    await updateStatus(env.DB, deps({ upstream: 'o/other' }), new Date(now.getTime() + 31 * 60_000));
    expect(calls.some((c) => c.url.includes('/repos/o/other/releases/latest'))).toBe(true);
  });

  test('Releaseがまだ無い・今と同じ版なら、新しい版は無い（表の変更は調べない）。トークンが無ければ実行は読まない', async () => {
    const calls = mockGitHub({ '/repos/o/u': () => Response.json({ full_name: 'o/u' }) });
    const none = await updateStatus(env.DB, deps({ token: '' }), new Date(), true);
    expect(none).toMatchObject({ latest: null, available: false, migrations: null, error: '', canDispatch: false, runs: [] });
    vi.restoreAllMocks();
    const calls2 = mockGitHub({ '/repos/o/u/releases/latest': release('v' + APP_VERSION, { name: null, published_at: null, body: null }) });
    const same = await updateStatus(env.DB, deps({ repo: '' }), new Date(), true);
    expect(same).toMatchObject({ available: false, migrations: null, workflowUrl: '', canDispatch: false, latest: { version: APP_VERSION, name: 'v' + APP_VERSION, publishedAt: '', notes: '' } });
    // Releaseが無いときだけ、リポジトリがあるかを確かめる
    expect(calls.map((c) => c.url)).toEqual(['https://api.github.com/repos/o/u/releases/latest', 'https://api.github.com/repos/o/u']);
    expect(calls2.length).toBe(1);
  });

  test('元のリポジトリが見えなければ（非公開・名前の誤り）、版が無いとは言わず、そう出す', async () => {
    mockGitHub({});
    expect(await updateStatus(env.DB, deps({ token: '' }), new Date(), true)).toMatchObject({
      latest: null, available: false, error: '新しいバージョンを確かめられませんでした（GitHubで元のリポジトリ「o/u」が見えません。公開されているか、名前が合っているかを確かめてください）',
    });
    vi.restoreAllMocks();
    mockGitHub({ '/repos/o/u': () => new Response('slow down', { status: 403 }) });
    expect((await updateStatus(env.DB, deps({ token: '' }), new Date(), true)).error).toBe('新しいバージョンを確かめられませんでした（GitHubが403を返しました。トークンの権限と、リポジトリの名前を確かめてください）');
  });

  test('読めなければ理由を出し、前に読めた最新のバージョンは残す。表の変更を比べられなければ、分からないまま', async () => {
    mockGitHub({ '/repos/o/u/releases/latest': release('v' + NEXT), '/repos/o/u/compare/': () => Response.json({}) });
    const first = await updateStatus(env.DB, deps({ token: '' }), new Date(), true);
    expect(first.migrations).toBe(false);
    vi.restoreAllMocks();
    mockGitHub({ '/repos/o/u/releases/latest': () => new Response('x', { status: 500 }) });
    const broken = await updateStatus(env.DB, deps({ token: '' }), new Date(), true);
    expect(broken).toMatchObject({ available: true, latest: { version: NEXT }, migrations: false, error: '新しいバージョンを確かめられませんでした（GitHubが500を返しました）' });
    vi.restoreAllMocks();
    // 控えが無いときに読めなければ、何も無い
    await env.DB.prepare("DELETE FROM meta WHERE key = 'update_check'").run();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue('network down');
    expect(await updateStatus(env.DB, deps({ token: '' }), new Date(), true)).toMatchObject({ latest: null, migrations: null, error: '新しいバージョンを確かめられませんでした（network down）' });
    vi.restoreAllMocks();
    // 今の版のタグが元のリポジトリに無ければ（フォークで版を変えたなど）、表の変更は分からない
    mockGitHub({ '/repos/o/u/releases/latest': release('v' + NEXT) });
    expect((await updateStatus(env.DB, deps({ token: '' }), new Date(), true)).migrations).toBeNull();
  });

  test('実行の一覧が読めなければ、そう出す（トークンの権限を確かめるよう添える）', async () => {
    mockGitHub({ '/repos/o/u/releases/latest': release('v' + APP_VERSION), '/repos/me/yoki/actions/': () => new Response('no', { status: 403 }) });
    const u = await updateStatus(env.DB, deps(), new Date(), true);
    expect(u.runs).toEqual([]);
    expect(u.error).toBe('更新の記録を読めませんでした（GitHubが403を返しました。トークンの権限と、リポジトリの名前を確かめてください）');
  });
});

describe('更新を始める', () => {
  test('トークンが無ければ400、新しい版が無ければ409。GitHubが断れば409', async () => {
    await expect(startUpdate(env.DB, deps({ token: '' }))).rejects.toMatchObject({ status: 400 });
    await expect(startUpdate(env.DB, deps({ repo: '' }))).rejects.toMatchObject({ status: 400 });
    mockGitHub({ '/repos/o/u/releases/latest': release('v' + APP_VERSION) });
    await updateStatus(env.DB, deps(), new Date(), true);
    await expect(startUpdate(env.DB, deps())).rejects.toMatchObject({ status: 409, message: expect.stringContaining('新しいバージョンはありません') });
    vi.restoreAllMocks();
    mockGitHub({ '/repos/o/u/releases/latest': release('v' + NEXT), '/repos/me/yoki/actions/workflows/update.yml/dispatches': () => new Response('', { status: 422 }) });
    await updateStatus(env.DB, deps(), new Date(), true);
    await expect(startUpdate(env.DB, deps())).rejects.toMatchObject({ status: 409, message: '更新を始められませんでした（GitHubが422を返しました）' });
  });

  test('最新のバージョンで、更新のワークフローをmainで動かす', async () => {
    const calls = mockGitHub({ '/repos/o/u/releases/latest': release('v' + NEXT), '/repos/me/yoki/actions/workflows/update.yml/dispatches': () => new Response(null, { status: 204 }) });
    expect(await startUpdate(env.DB, deps(), new Date())).toBe(NEXT);
    const d = calls.find((c) => c.url.endsWith('/dispatches'))!;
    expect(d).toMatchObject({ method: 'POST', auth: 'Bearer tok' });
    expect(JSON.parse(d.body)).toEqual({ ref: 'main', inputs: { version: NEXT } });
  });
});

describe('運営者のAPI（/api/admin/update）と、開発用の偽のGitHub', () => {
  test('運営者だけが読め、動かせる', async () => {
    const { admin } = await setupGroup();
    expect((await call('/api/admin/update')).status).toBe(401);
    expect((await call('/api/admin/update', { sid: admin })).status).toBe(403);
    expect((await postJson('/api/admin/update', {}, admin)).status).toBe(403);
  });

  test('開発サーバーでは偽のGitHubで、次の版があり、表の変更を含む。更新を始めると記録に出て、logに控えが残る', async () => {
    const op = await loginAs(OP, []);
    const u = (await (await call('/api/admin/update', { sid: op })).json()) as AdminUpdate;
    expect(u).toMatchObject({ current: APP_VERSION, upstream: DEFAULT_UPSTREAM, available: true, migrations: true, repo: 'example/yoki', canDispatch: true, runs: [], latest: { version: NEXT } });
    expect(u.latest!.notes).toContain('### 足したこと・変えたこと');
    const res = await postJson('/api/admin/update', {}, op);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toBe('v' + NEXT + 'への更新を始めました。GitHubのActionsが取り込んで公開します（数分かかります）。');
    expect(logs.map((l) => JSON.parse(l))).toContainEqual({ audit: 'operator', by: OP.id, action: 'update', target: 'v' + NEXT, from: 'v' + APP_VERSION });
    const again = (await (await call('/api/admin/update?refresh=1', { sid: op })).json()) as AdminUpdate;
    expect(again.runs).toHaveLength(1);
    expect(again.runs[0]).toMatchObject({ id: 1, status: 'queued', conclusion: '' });
    expect(await fakeGitHub(env.DB).runs('', '', '')).toHaveLength(1);
  });

  test('公開しているリポジトリが入っていれば本物のGitHubを使う。リポジトリの名前の形が違えば使わない', async () => {
    const e = env as unknown as Bindings;
    expect(updateDeps({ ...e, APP_REPOSITORY: 'me/yoki', UPSTREAM_REPOSITORY: 'up/yoki', UPDATE_DISPATCH_TOKEN: 't' })).toMatchObject({ upstream: 'up/yoki', repo: 'me/yoki', token: 't' });
    expect(updateDeps({ ...e, APP_REPOSITORY: 'me/yoki' })).toMatchObject({ upstream: DEFAULT_UPSTREAM, token: '' });
    expect(updateDeps({ ...e, APP_REPOSITORY: 'bad name/x', UPSTREAM_REPOSITORY: '../x' })).toMatchObject({ upstream: DEFAULT_UPSTREAM, repo: '' });
    expect(updateDeps({ ...e, APP_REPOSITORY: 'me/..', UPSTREAM_REPOSITORY: 'up/.' })).toMatchObject({ upstream: DEFAULT_UPSTREAM, repo: '' });
    // 本物のGitHubにつないだ運営者のAPI（トークンが無ければ、ボタンでは始められない）
    mockGitHub({ ['/repos/' + DEFAULT_UPSTREAM + '/releases/latest']: release('v' + APP_VERSION) });
    const op = await loginAs(OP, []);
    const headers = { Cookie: SID + '=' + op, Origin: ORIGIN, 'Content-Type': 'application/json' };
    const res = await app.request(ORIGIN + '/api/admin/update?refresh=1', { headers }, { ...e, APP_REPOSITORY: 'me/yoki' });
    expect(await res.json()).toMatchObject({ available: false, canDispatch: false, repo: 'me/yoki' });
    const post = await app.request(ORIGIN + '/api/admin/update', { method: 'POST', headers, body: '{}' }, { ...e, APP_REPOSITORY: 'me/yoki' });
    expect(post.status).toBe(400);
  });
});
