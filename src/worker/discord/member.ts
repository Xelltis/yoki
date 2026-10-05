// その人がサーバーにいるかを、Bot に聞く（グループに入れるかの確かめ直し。auth/guard.ts）。
// ログインした人の Discord のトークンは持たないので、サーバーの一覧の控えが古くなったら、Bot がいるサーバーでは Bot で確かめる。
// 1 人ずつ読むだけなので、Gateway の特別な権限（サーバーのメンバーの一覧）は要らない
import { botGet } from './channel';

/** サーバー管理の権限（管理者 8・サーバー管理 32） */
const MANAGE = 0x8n | 0x20n;
/** Discord の「メンバーが見つからない」 */
const UNKNOWN_MEMBER = 10007;

type ApiMember = { roles: string[] };
type ApiGuild = { owner_id: string; roles: { id: string; permissions: string }[] };

/**
 * その人がサーバーにいるか。いれば、サーバーを管理できるか（オーナーか、管理者・サーバー管理の権限）も返す（読めなければ null）。
 * Bot がサーバーにいない・Discord が答えない、のように Bot では分からないときは null（呼ぶ側が、ほかの方法で確かめる）
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
