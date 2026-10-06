// 小さな部品: 名前・日時・ID・Discordの権限・手元かどうか・DiscordとのOAuth・メンバーを決める処理の端の場合
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveMember } from '../../src/worker/auth/guard';
import { fetchDiscordProfile } from '../../src/worker/auth/oauth';
import { canManageGuild } from '../../src/worker/auth/perms';
import { isLocalHttp, type Viewer } from '../../src/worker/auth/session';
import { randomId } from '../../src/worker/lib/ids';
import { minutesOfTime, stampText, timeRange } from '../../src/worker/lib/jst';
import { memberNameFrom, splitNames } from '../../src/worker/lib/text';
import { makeGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('名前', () => {
  test('区切りで分ける。空なら何も無い', () => {
    expect(splitNames('ソラ、こまち / レン')).toEqual(['ソラ', 'こまち', 'レン']);
    expect(splitNames(undefined)).toEqual([]);
  });

  test('Discordの表示名が無いか使えなければユーザー名、それも使えなければ「メンバー」', () => {
    expect(memberNameFrom(null, 'alice')).toBe('alice');
    expect(memberNameFrom('全員', 'alice')).toBe('alice');
    expect(memberNameFrom('、、', '（なし）')).toBe('メンバー');
  });
});

describe('日時', () => {
  test('読めない日時は空にする', () => {
    expect(stampText('きのう')).toBe('');
  });

  test('時刻の形でないか、ありえない時刻ならnull', () => {
    expect(minutesOfTime('夜')).toBeNull();
    expect(minutesOfTime('24:00')).toBeNull();
    expect(minutesOfTime('21:60')).toBeNull();
    expect(minutesOfTime('21:30')).toBe(21 * 60 + 30);
  });

  test('開始が無ければ「？」で始める', () => {
    expect(timeRange({ start: '', end: '23:00' })).toBe('？〜23:00');
  });
});

test('IDは小文字のbase32で、決めた長さ', () => {
  expect(randomId(10)).toMatch(/^[a-z2-7]{10}$/);
});

test('Discordの権限: オーナー・管理者・サーバー管理なら管理できる。権限が無いか読めなければ管理できない', () => {
  expect(canManageGuild({ owner: true })).toBe(true);
  expect(canManageGuild({ permissions: '8' })).toBe(true);
  expect(canManageGuild({ permissions: '32' })).toBe(true);
  expect(canManageGuild({})).toBe(false);
  expect(canManageGuild({ permissions: 'たくさん' })).toBe(false);
});

test('手元（httpのlocalhostと127.0.0.1）かどうか', () => {
  expect(isLocalHttp(new URL('http://localhost:5173/'))).toBe(true);
  expect(isLocalHttp(new URL('http://127.0.0.1:8787/'))).toBe(true);
  expect(isLocalHttp(new URL('https://localhost/'))).toBe(false);
  expect(isLocalHttp(new URL('http://yoki.test/'))).toBe(false);
});

describe('DiscordとのOAuth', () => {
  test('秘密の値が無くても、空のままDiscordに聞く', async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/oauth2/token')) { bodies.push(String(init?.body)); return Response.json({ access_token: 'at' }); }
      return Response.json(url.includes('/guilds') ? [] : { id: '100', username: 'alice' });
    });
    const { user } = await fetchDiscordProfile({ ...env, DISCORD_CLIENT_SECRET: undefined }, 'code', 'https://yoki.test/auth/callback');
    expect(user.username).toBe('alice');
    expect(new URLSearchParams(bodies[0]).get('client_secret')).toBe('');
  });

  test('Discordが断ったら、何が失敗したかを添えて投げる', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
    await expect(fetchDiscordProfile(env, 'code', 'https://yoki.test/auth/callback')).rejects.toThrow('トークンの取得が失敗しました（HTTP 401）');
  });
});

describe('メンバーを決める（resolveMember）', () => {
  const viewer: Viewer = { id: '100', username: 'alice', globalName: 'アリス', avatar: null, guildsCheckedAt: new Date().toISOString() };

  test('同じ人の最初の2つの呼び出しが重なったら、先に作られた行を使う', async () => {
    await makeGroup('g', 'guild');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, guilds_checked_at, created_at, last_login_at) VALUES ('100', 'alice', 'x', 'x', 'x')"),
      env.DB.prepare("INSERT INTO members (group_id, name, user_id, discord_id, created_at) VALUES ('g', 'アリス', '100', '100', 'x')"),
    ]);
    // 1回目の「この人の行はあるか」だけ、まだ無かったことにする（もう1つの呼び出しが、そのあとで作った）
    let missed = false;
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === 'prepare') {
          return (sql: string) => {
            if (!missed && sql.startsWith('SELECT id, name, is_admin FROM members')) {
              missed = true;
              return { bind: () => ({ first: async () => null }) };
            }
            return t.prepare(sql);
          };
        }
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const actor = await resolveMember(db, 'g', viewer, false, new Date());
    expect(actor.name).toBe('アリス');
    expect(await env.DB.prepare("SELECT count(*) AS n FROM members WHERE group_id = 'g'").first('n')).toBe(1);
  });

  test('同じ名前が20個まで埋まっていたら、作れずに投げる', async () => {
    await makeGroup('g', 'guild');
    const names = ['アリス', ...Array.from({ length: 19 }, (_, i) => 'アリス (' + (i + 2) + ')')];
    await env.DB.batch(names.map((n) => env.DB.prepare("INSERT INTO members (group_id, name, created_at) VALUES ('g', ?, 'x')").bind(n)));
    await expect(resolveMember(env.DB, 'g', viewer, false, new Date())).rejects.toThrow('メンバーを作れませんでした');
  });
});
