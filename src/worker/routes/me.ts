// 入口の画面が使うAPI: ログインしている人・入れるグループ・作れるサーバー、グループを作る
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { SNAPSHOT_HOURS, snapshotAgeMs } from '../auth/guard';
import { currentViewer } from '../auth/session';
import { AppError, authError, badRequest } from '../lib/errors';
import { randomId } from '../lib/ids';
import { memberNameFrom } from '../lib/text';
import { DEV_USERS } from '../auth/dev-users';
import { devAvailable, isOperator } from '../auth/operator';
import { readForm, str } from '../domain/form';
import { registrationOpen } from '../domain/registration';
import { googleConfigured } from '../google/config';
import type { CreateGroupResult, MeResponse } from '../../shared/api';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/api/me', async (c) => {
  const url = new URL(c.req.url);
  const base = {
    discord: !!c.env.DISCORD_CLIENT_ID, dev: devAvailable(url) ? { users: DEV_USERS.map((u) => u.name) } : null, registration: await registrationOpen(c.env.DB),
    google: googleConfigured(c.env),
  };
  const viewer = await currentViewer(c);
  if (!viewer) return c.json({ ...base, loggedIn: false } satisfies MeResponse);
  const db = c.env.DB;
  const [groups, creatable] = await Promise.all([
    db
      .prepare(
        `SELECT g.id, g.title, g.guild_name AS guildName, g.guild_icon AS guildIcon
           FROM groups g JOIN user_guilds ug ON ug.guild_id = g.guild_id AND ug.user_id = ?
          ORDER BY g.title`,
      )
      .bind(viewer.id)
      .all<{ id: string; title: string; guildName: string; guildIcon: string | null }>(),
    db.prepare('SELECT guild_id AS guildId, name, icon FROM user_guilds WHERE user_id = ? AND can_manage = 1 ORDER BY name').bind(viewer.id).all<{ guildId: string; name: string; icon: string | null }>(),
  ]);
  return c.json({
    ...base,
    loggedIn: true,
    user: { id: viewer.id, name: viewer.globalName || viewer.username, avatar: viewer.avatar },
    operator: isOperator(c.env, viewer.id, url),
    groups: groups.results,
    creatable: creatable.results,
    stale: snapshotAgeMs(viewer, new Date()) > SNAPSHOT_HOURS * 3600_000,
  } satisfies MeResponse);
});

meRoutes.post('/api/groups', async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) throw authError();
  const now = new Date();
  if (snapshotAgeMs(viewer, now) > SNAPSHOT_HOURS * 3600_000) throw authError('サーバーの一覧が古くなりました。ログインし直してください。');
  if (!isOperator(c.env, viewer.id, new URL(c.req.url)) && !(await registrationOpen(c.env.DB))) throw new AppError(403, '今は新しいグループの受付を止めています。');
  const body = await readForm(c.req);
  const guildId = str(body.guildId);
  if (!guildId) throw badRequest('Discordサーバーを選んでください。');
  const g = await c.env.DB.prepare('SELECT name, icon FROM user_guilds WHERE user_id = ? AND guild_id = ? AND can_manage = 1')
    .bind(viewer.id, guildId)
    .first<{ name: string; icon: string | null }>();
  if (!g) throw new AppError(403, 'そのサーバーでグループを作れるのは、オーナーか、サーバー管理の権限がある人だけです。');
  const title = str(body.title).slice(0, 80) || g.name;
  const id = randomId(10);
  const at = now.toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO groups (id, guild_id, guild_name, guild_icon, title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, guildId, g.name, g.icon, title, viewer.id, at),
    c.env.DB.prepare('INSERT INTO members (group_id, name, user_id, discord_id, is_admin, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, memberNameFrom(viewer.globalName, viewer.username), viewer.id, viewer.id, at),
  ]);
  return c.json({ ok: true, id, url: '/g/' + id + '/' } satisfies CreateGroupResult);
});
