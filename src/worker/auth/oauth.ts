// DiscordのOAuth2（認可コード）。scopeはidentify（誰か）とguilds（どのサーバーにいるか）。
// 受け取ったトークンは、プロフィールとサーバーの一覧を読んだら捨てる（保存しない）
import type { Bindings } from '../env';
import { canManageGuild } from './perms';

export const DISCORD_API = 'https://discord.com/api/v10';

export type DiscordUser = { id: string; username: string; global_name?: string | null; avatar?: string | null };
export type DiscordGuild = { id: string; name: string; icon?: string | null; owner?: boolean; permissions?: string };

export function authorizeUrl(env: Bindings, redirectUri: string, state: string, prompt: 'none' | 'consent'): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env.DISCORD_CLIENT_ID,
    scope: 'identify guilds',
    redirect_uri: redirectUri,
    state,
    prompt,
  });
  return 'https://discord.com/oauth2/authorize?' + q.toString();
}

async function discordJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(what + 'が失敗しました（HTTP ' + res.status + '）');
  return (await res.json()) as T;
}

/** 認可コードをアクセストークンに換え、プロフィールとサーバーの一覧を読む */
export async function fetchDiscordProfile(env: Bindings, code: string, redirectUri: string): Promise<{ user: DiscordUser; guilds: DiscordGuild[] }> {
  const token = await discordJson<{ access_token: string }>(
    await fetch(DISCORD_API + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET ?? '',
      }),
    }),
    'トークンの取得',
  );
  const auth = { headers: { Authorization: 'Bearer ' + token.access_token } };
  const [user, guilds] = await Promise.all([
    fetch(DISCORD_API + '/users/@me', auth).then((r) => discordJson<DiscordUser>(r, 'プロフィールの読み込み')),
    fetch(DISCORD_API + '/users/@me/guilds?limit=200', auth).then((r) => discordJson<DiscordGuild[]>(r, 'サーバーの一覧の読み込み')),
  ]);
  return { user, guilds };
}

/**
 * ログインした人と、控えるサーバーを書く。控えるのは、卓予定のグループがあるサーバーと、本人が管理できるサーバーだけ
 * （ほかのサーバーは覚えない）。問い合わせはサーバーの数によらず4回
 */
export async function saveProfile(db: D1Database, user: DiscordUser, guilds: DiscordGuild[], now = new Date()): Promise<void> {
  const at = now.toISOString();
  const hosted = await db
    .prepare('SELECT DISTINCT guild_id FROM groups WHERE guild_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(guilds.map((g) => g.id)))
    .all<{ guild_id: string }>();
  const hostedIds = new Set(hosted.results.map((r) => r.guild_id));
  const keep = guilds
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null, can_manage: canManageGuild(g) ? 1 : 0 }))
    .filter((g) => g.can_manage || hostedIds.has(g.id));
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, username, global_name, avatar, guilds_checked_at, created_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
         ON CONFLICT (id) DO UPDATE SET username = excluded.username, global_name = excluded.global_name,
           avatar = excluded.avatar, guilds_checked_at = excluded.guilds_checked_at, last_login_at = excluded.last_login_at`,
      )
      .bind(user.id, user.username, user.global_name ?? null, user.avatar ?? null, at),
    db.prepare('DELETE FROM user_guilds WHERE user_id = ?').bind(user.id),
    db
      .prepare(
        `INSERT INTO user_guilds (user_id, guild_id, name, icon, can_manage)
         SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.icon'), json_extract(value, '$.can_manage')
           FROM json_each(?2)`,
      )
      .bind(user.id, JSON.stringify(keep)),
  ]);
}
