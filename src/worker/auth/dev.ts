// 開発用ログイン（npm run dev のときだけ）。Discord を使わずに、サンプルのグループのメンバーとして入る。
// app.ts が import.meta.env.DEV のときだけ登録するので、本番のビルド（vite build）には入らない
import type { Hono } from 'hono';
import type { AppEnv } from '../app';
import { seedSample } from '../seed/sample';
import { saveProfile } from './oauth';
import { isLocalHttp, startSession } from './session';
import { DEV_GUILD, DEV_USERS, SAMPLE_GROUP_ID } from './dev-users';

/** サンプルのグループを用意する。無ければ作って、サンプルデータを入れる */
export async function ensureSampleGroup(db: D1Database, appUrl: string, now = new Date()): Promise<void> {
  const r = await db
    .prepare(
      `INSERT INTO groups (id, guild_id, guild_name, title, created_by, created_at) VALUES (?, ?, ?, '卓予定', ?, ?)
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
    const url = new URL(c.req.url);
    await ensureSampleGroup(c.env.DB, url.origin + '/g/' + SAMPLE_GROUP_ID + '/');
    await saveProfile(c.env.DB, { id: who.id, username: 'dev-' + who.id.slice(-2), global_name: who.name }, [
      { id: DEV_GUILD.id, name: DEV_GUILD.name, owner: who.manager, permissions: '0' },
    ]);
    await startSession(c, who.id);
    return c.redirect('/g/' + SAMPLE_GROUP_ID + '/', 303);
  });

  // サンプルのグループを作り直す（開いた日から数え直す）
  app.post('/dev/reset', async (c) => {
    const url = new URL(c.req.url);
    if (!isLocalHttp(url)) return c.notFound();
    await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(SAMPLE_GROUP_ID).run();
    await ensureSampleGroup(c.env.DB, url.origin + '/g/' + SAMPLE_GROUP_ID + '/');
    return c.redirect('/g/' + SAMPLE_GROUP_ID + '/', 303);
  });
}
