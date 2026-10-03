// グループを作る・グループのページに入る・メンバーを決める・CSRF・開発用ログイン・管理画面のページ・グループを消す
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { call, loginAs, makeGroup, ORIGIN, postJson, rpc, setupGroup } from './helpers';

const member = (groupId: string, userId: string) =>
  env.DB.prepare('SELECT name, is_admin, discord_id FROM members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first<{ name: string; is_admin: number; discord_id: string }>();

describe('グループを作る', () => {
  test('管理できるサーバーなら作れ、作った人が管理者のメンバーになる', async () => {
    const sid = await loginAs({ id: '10', name: 'ひより' }, [{ id: 'g1', name: '卓サーバー', canManage: true }]);
    const res = await postJson('/api/groups', { guildId: 'g1', title: '' }, sid);
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; url: string }>();
    expect(body.url).toBe('/g/' + body.id + '/');
    const g = await env.DB.prepare('SELECT title, guild_id FROM groups WHERE id = ?').bind(body.id).first();
    expect(g).toEqual({ title: '卓サーバー', guild_id: 'g1' });
    expect(await member(body.id, '10')).toEqual({ name: 'ひより', is_admin: 1, discord_id: '10' });
  });

  test('管理できないサーバーでは作れない', async () => {
    const sid = await loginAs({ id: '11', name: 'ソラ' }, [{ id: 'g2', name: 'S' }]);
    const res = await postJson('/api/groups', { guildId: 'g2' }, sid);
    expect(res.status).toBe(403);
  });

  test('ログインしていなければ AUTH:', async () => {
    const res = await postJson('/api/groups', { guildId: 'g1' });
    expect(res.status).toBe(401);
    expect((await res.json<{ error: string }>()).error).toMatch(/^AUTH:/);
  });

  test('CSRF: 別のサイトからと、JSON でない送信は断る', async () => {
    const sid = await loginAs({ id: '12', name: 'こまち' }, [{ id: 'g3', name: 'K', canManage: true }]);
    expect((await postJson('/api/groups', { guildId: 'g3' }, sid, { Origin: 'https://evil.example' })).status).toBe(403);
    const form = await call('/api/groups', { method: 'POST', sid, headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'guildId=g3' });
    expect(form.status).toBe(415);
  });
});

describe('グループのページ（/g/:id/）', () => {
  test('ログインしていなければ、ログインへ送る（戻り先つき）', async () => {
    await makeGroup('p1', 'gp');
    const res = await call('/g/p1/');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/login?return_to=%2Fg%2Fp1%2F');
  });

  test('サーバーのメンバーなら画面を返し、メンバーを自動で作る（Discord ID 付き）', async () => {
    await makeGroup('p2', 'gq');
    const sid = await loginAs({ id: '20', name: 'レン' }, [{ id: 'gq', name: 'Q' }]);
    const res = await call('/g/p2/', { sid });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>卓予定</title>');
    expect(await member('p2', '20')).toEqual({ name: 'レン', is_admin: 0, discord_id: '20' });
  });

  test('同じ名前のメンバーがいれば「 (2)」を付け、管理者が先に登録した Discord ID の行には結びつく', async () => {
    await makeGroup('p3', 'gr');
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO members (group_id, name, created_at) VALUES ('p3', 'ミナト', ?)").bind(at),
      env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES ('p3', 'ユズ（登録済み）', '31', ?)").bind(at),
    ]);
    const a = await loginAs({ id: '30', name: 'ミナト' }, [{ id: 'gr', name: 'R' }]);
    const b = await loginAs({ id: '31', name: 'ユズ' }, [{ id: 'gr', name: 'R' }]);
    await call('/g/p3/', { sid: a });
    await call('/g/p3/', { sid: b });
    expect((await member('p3', '30'))?.name).toBe('ミナト (2)');
    expect((await member('p3', '31'))?.name).toBe('ユズ（登録済み）');
  });

  test('サーバーの管理者は、グループでも管理者', async () => {
    await makeGroup('p4', 'gs');
    const sid = await loginAs({ id: '40', name: 'GM' }, [{ id: 'gs', name: 'S', canManage: true }]);
    await call('/g/p4/', { sid });
    // members.is_admin は 0 のまま（サーバーの権限で管理者になる）
    expect((await member('p4', '40'))?.is_admin).toBe(0);
  });

  test('サーバーにいない人は 403（控えが新しいとき）。控えが古ければ聞き直しに送る', async () => {
    await makeGroup('p5', 'gt');
    const fresh = await loginAs({ id: '50', name: 'X' }, [{ id: 'other', name: 'O' }]);
    expect((await call('/g/p5/', { sid: fresh })).status).toBe(403);
    const old = await loginAs({ id: '51', name: 'Y' }, [{ id: 'gt', name: 'T' }], { checkedAt: new Date(Date.now() - 25 * 3600_000) });
    const res = await call('/g/p5/', { sid: old });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/auth/login?return_to=');
  });

  test('無いグループは 404。末尾の / が無ければ付ける', async () => {
    expect((await call('/g/nope/')).status).toBe(404);
    const res = await call('/g/abc');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/g/abc/');
  });
});

describe('開発用ログイン', () => {
  test('手元（http://localhost）ではサンプルのグループに入れる', async () => {
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch('http://localhost:5173/dev/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:5173' },
      body: 'as=ソラ',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/g/sample/');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('yoki_sid='))).toBe(true);
    expect(await env.DB.prepare("SELECT guild_id FROM groups WHERE id = 'sample'").first('guild_id')).toBe('dev-guild');
  });

  test('手元でなければ無い', async () => {
    const res = await call('/dev/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'as=ソラ' });
    expect(res.status).toBe(404);
  });
});

describe('グループの管理画面（/g/:id/admin/）', () => {
  test('管理者には画面を返す。管理者でない人には 403 の案内（予定の画面へのリンク付き）', async () => {
    const { admin, sora } = await setupGroup();
    const ok = await call('/g/grp/admin/', { sid: admin });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('<title>卓予定</title>');
    const ng = await call('/g/grp/admin/', { sid: sora });
    expect(ng.status).toBe(403);
    expect(await ng.text()).toContain('href="/g/grp/"');
  });

  test('ログインしていなければ、管理画面へ戻ってくるログインへ送る。末尾の / が無ければ付ける', async () => {
    await makeGroup('grp', 'g');
    expect((await call('/g/grp/admin/')).headers.get('Location')).toBe('/auth/login?return_to=%2Fg%2Fgrp%2Fadmin%2F');
    const r = await call('/g/grp/admin');
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('/g/grp/admin/');
  });
});

describe('運営者の管理画面（/admin/）', () => {
  test('運営者だけ。ログインしていなければログインへ、運営者でなければ 403', async () => {
    expect((await call('/admin/')).headers.get('Location')).toBe('/auth/login?return_to=%2Fadmin%2F');
    const user = await loginAs({ id: '300', name: 'ふつうの人' }, []);
    expect((await call('/admin/', { sid: user })).status).toBe(403);
    const op = await loginAs({ id: '400000000000000098', name: '運営' }, []);
    const res = await call('/admin/', { sid: op });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('運営の管理画面');
    expect((await call('/admin')).headers.get('Location')).toBe('/admin/');
  });
});

describe('グループを消す（deleteGroup）', () => {
  test('管理者だけ。名前が合えば中身ごと消え、返事にデータは付かない', async () => {
    const { admin, sora } = await setupGroup();
    expect((await rpc(sora, 'grp', 'deleteGroup', { confirm: 'テストの卓' })).body.error).toMatch(/^ADMIN:/);
    expect((await rpc(admin, 'grp', 'deleteGroup', { confirm: 'ちがう' })).status).toBe(400);
    const r = await rpc(admin, 'grp', 'deleteGroup', { confirm: 'テストの卓' });
    expect(r.status).toBe(200);
    expect(r.body.data).toBeUndefined();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM members WHERE group_id = 'grp'").first('n')).toBe(0);
  });

  test('消えたグループを開いていた画面には、GONE: で知らせる', async () => {
    const { admin, sora } = await setupGroup();
    await rpc(admin, 'grp', 'deleteGroup', { confirm: 'テストの卓' });
    const r = await rpc(sora, 'grp', 'getConsoleData');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/^GONE:/);
  });
});

describe('最後に使われた日時', () => {
  test('画面から呼ばれたら書き換える。10 分以内なら書き換えない', async () => {
    const { sora } = await setupGroup();
    const used = () => env.DB.prepare("SELECT last_used_at FROM groups WHERE id = 'grp'").first<string>('last_used_at');
    await env.DB.prepare("UPDATE groups SET last_used_at = '2026-01-01T00:00:00.000Z' WHERE id = 'grp'").run();
    await rpc(sora, 'grp', 'getConsoleData');
    const t = await used();
    expect(Date.now() - Date.parse(t!)).toBeLessThan(60_000);
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    await env.DB.prepare("UPDATE groups SET last_used_at = ? WHERE id = 'grp'").bind(recent).run();
    await rpc(sora, 'grp', 'getConsoleData');
    expect(await used()).toBe(recent);
  });
});
