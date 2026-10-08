// その人がサーバーにいるかを、Botに聞く（グループに入れるかの確かめ直し。auth/guard.ts）。
// ログインした人のDiscordのトークンは持たないので、サーバーの一覧の控えが古くなったら、BotがいるサーバーではBotで確かめる。
// 1人ずつ読むだけなので、Gatewayの特別な権限（サーバーのメンバーの一覧）は要らない
import { botGet } from './channel';

/** サーバー管理の権限（管理者8・サーバー管理32） */
const MANAGE = 0x8n | 0x20n;
/** Discordの「メンバーが見つからない」 */
const UNKNOWN_MEMBER = 10007;

type ApiMember = { roles: string[] };
type ApiGuild = { owner_id: string; roles: { id: string; permissions: string }[] };

/**
 * その人がサーバーにいるか。いれば、サーバーを管理できるか（オーナーか、管理者・サーバー管理の権限）も返す（読めなければnull）。
 * Botがサーバーにいない・Discordが答えない、のようにBotでは分からないときはnull（呼ぶ側が、ほかの方法で確かめる）
 */
export async function guildMembership(token: string, guildId: string, userId: string): Promise<{ member: false } | { member: true; canManage: boolean | null } | null> {
  try {
    const m = await botGet(token, '/guilds/' + guildId + '/members/' + userId);
    if (m.status === 404 && (m.body as { code?: number } | null)?.code === UNKNOWN_MEMBER) return { member: false };
    if (m.status !== 200) return null;
    const g = await botGet(token, '/guilds/' + guildId);
    if (g.status !== 200) return { member: true, canManage: null };
    const guild = g.body as ApiGuild, roles = new Set([guildId, ...(m.body as ApiMember).roles]);
    const perms = guild.roles.filter((r) => roles.has(r.id)).reduce((p, r) => p | BigInt(r.permissions), 0n);
    return { member: true, canManage: guild.owner_id === userId || (perms & MANAGE) !== 0n };
  } catch {
    return null;
  }
}

/** 管理者（8）・イベントの管理（1<<33）・イベントを作成（1<<44）。どれかがあれば、Botはイベントを作れる */
const EVENTS = 0x8n | (1n << 33n) | (1n << 44n);

/**
 * Botが、そのサーバーでイベントを作れるか。Botがいないときはfalse、Discordが答えないときはnull。
 * BotのユーザーIDは /users/@me で読む（DiscordアプリのIDと同じことが多いが、決まりではないため）
 */
export async function botCanCreateEvents(token: string, guildId: string): Promise<boolean | null> {
  try {
    const me = await botGet(token, '/users/@me');
    const id = (me.body as { id?: string } | null)?.id;
    if (me.status !== 200 || !id) return null;
    const m = await botGet(token, '/guilds/' + guildId + '/members/' + id);
    if (m.status === 403 || m.status === 404) return false;
    if (m.status !== 200) return null;
    const g = await botGet(token, '/guilds/' + guildId);
    if (g.status !== 200) return null;
    const guild = g.body as ApiGuild, roles = new Set([guildId, ...(m.body as ApiMember).roles]);
    const perms = guild.roles.filter((r) => roles.has(r.id)).reduce((p, r) => p | BigInt(r.permissions), 0n);
    return (perms & EVENTS) !== 0n;
  } catch {
    return null;
  }
}
