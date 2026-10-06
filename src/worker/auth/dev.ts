// 開発用ログイン（npm run dev のときだけ）。Discord を使わずに、サンプルのグループのメンバーとして入る。
// app.ts が import.meta.env.DEV のときだけ登録するので、本番のビルド（vite build）には入らない
import type { Hono } from 'hono';
import type { AppEnv } from '../app';
import { mayLogIn } from '../domain/registration';
import { consumeGoogleLink } from './google-login';
import { seedSample } from '../seed/sample';
import { isOperator } from './operator';
import { saveProfile } from './oauth';
import { isBanned, isLocalHttp, startSession } from './session';
import { DEV_GUILD, DEV_USERS, SAMPLE_GROUP_ID } from './dev-users';

/** サンプルのグループを用意する。無ければ作って、サンプルデータを入れる */
export async function ensureSampleGroup(db: D1Database, appUrl: string, now = new Date()): Promise<void> {
  const r = await db
    .prepare(
      `INSERT INTO groups (id, guild_id, guild_name, title, created_by, created_at) VALUES (?, ?, ?, 'サンプルのグループ', ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(SAMPLE_GROUP_ID, DEV_GUILD.id, DEV_GUILD.name, DEV_USERS[0]!.id, now.toISOString())
    .run();
  if (r.meta.changes) await seedSample(db, SAMPLE_GROUP_ID, appUrl, now);
}

export function registerDevRoutes(app: Hono<AppEnv>): void {
  app.post('/dev/login', async (c) => {
    if (!isLocalHttp(new URL(c.req.url))) return c.notFound();
    const form = await c.req.parseBody();
    const who = DEV_USERS.find((u) => u.name === form.as) ?? DEV_USERS[0]!;
    if (await isBanned(c.env.DB, who.id)) return c.redirect('/?login=banned', 303);
    const url = new URL(c.req.url);
    if (!(await mayLogIn(c.env.DB, who.id, isOperator(c.env, who.id, url)))) return c.redirect('/?login=closed', 303);
    await ensureSampleGroup(c.env.DB, url.origin + '/g/' + SAMPLE_GROUP_ID + '/');
    await saveProfile(c.env.DB, { id: who.id, username: 'dev-' + who.id.slice(-2), global_name: who.name }, [
      { id: DEV_GUILD.id, name: DEV_GUILD.name, owner: who.manager, permissions: '0' },
    ]);
    await startSession(c, who.id);
    // 開発用ログインも Discord でのログインの代わりなので、初めての Google のアカウントを結びつけるために押したら結びつける
    if (form.link_google === '1' && (await consumeGoogleLink(c, who.id))) return c.redirect('/?login=google-linked', 303);
    return c.redirect('/g/' + SAMPLE_GROUP_ID + '/', 303);
  });

  // サンプルのグループを作り直す（開いた日から数え直す）。開発用の人の Google 連携・Google でのログインと、偽の Google・偽の GitHub の中身も消す（前の回の連携や更新が残らないように）
  app.post('/dev/reset', async (c) => {
    const url = new URL(c.req.url);
    if (!isLocalHttp(url)) return c.notFound();
    const devIds = JSON.stringify(DEV_USERS.map((u) => u.id));
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM google_links WHERE user_id IN (SELECT value FROM json_each(?))').bind(devIds),
      c.env.DB.prepare('DELETE FROM google_events WHERE user_id IN (SELECT value FROM json_each(?))').bind(devIds),
      c.env.DB.prepare('DELETE FROM google_logins WHERE user_id IN (SELECT value FROM json_each(?))').bind(devIds),
      c.env.DB.prepare("DELETE FROM meta WHERE key IN ('dev_google', 'dev_update', 'update_check')"),
    ]);
    await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(SAMPLE_GROUP_ID).run();
    await ensureSampleGroup(c.env.DB, url.origin + '/g/' + SAMPLE_GROUP_ID + '/');
    return c.redirect('/g/' + SAMPLE_GROUP_ID + '/', 303);
  });
}
