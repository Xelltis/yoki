// 購読URL（GET /cal/<token>.ics）。カレンダーのアプリ（Googleカレンダーの「URLで追加」など）が、ログインせずに読む。
// tokenを知っていればだれでも読めるので、読めるのは、作った人がまだそのグループのメンバーで、締め出されておらず、
// グループのDiscordサーバーの控えがある間だけ。ほかは404（あるかどうかも教えない）
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { SYSTEM_ACTOR } from '../auth/guard';
import { appOrigin } from '../auth/origin';
import { feedText } from '../domain/calendar';
import { loadGroup } from '../domain/load';
import type { FeedScope } from '../domain/types';

export const calendarRoutes = new Hono<AppEnv>();

const FILE = /^([A-Za-z0-9_-]{32,64})\.ics$/;

calendarRoutes.get('/cal/:file', async (c) => {
  const token = FILE.exec(c.req.param('file'))?.[1];
  const feed = token
    ? await c.env.DB.prepare(
        `SELECT f.group_id, f.scope, m.name
           FROM calendar_feeds f
           JOIN groups g ON g.id = f.group_id
           JOIN users u ON u.id = f.user_id AND u.banned_at IS NULL
           JOIN members m ON m.group_id = f.group_id AND m.user_id = f.user_id
           JOIN user_guilds ug ON ug.user_id = f.user_id AND ug.guild_id = g.guild_id
          WHERE f.token = ?`,
      )
        .bind(token)
        .first<{ group_id: string; scope: FeedScope; name: string }>()
    : null;
  if (!feed) return c.text('見つかりません。', 404);
  const now = new Date();
  const appUrl = appOrigin(c.env, c.req.url) + '/g/' + feed.group_id + '/';
  const ctx = await loadGroup(c.env.DB, feed.group_id, SYSTEM_ACTOR, appUrl, now);
  await c.env.DB.prepare('UPDATE calendar_feeds SET fetched_at = ? WHERE token = ?').bind(now.toISOString(), token).run();
  return c.body(feedText(ctx, feed.scope, feed.name), 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="yoki.ics"',
    'Cache-Control': 'private, max-age=300',
    'X-Robots-Tag': 'noindex',
  });
});
