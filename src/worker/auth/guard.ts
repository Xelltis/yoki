// グループに入れるかの確認と、「あなた」（メンバー）を決める。
// 入れるのは、グループに結びつけたDiscordサーバーにいる人。参加しているサーバーはログインのときに控え、
// 控えが古ければ（SNAPSHOT_HOURS）、BotがそのサーバーにいればBotに、いなければDiscordに黙って聞き直す（/auth/loginはprompt=none）
import { guildMembership } from '../discord/member';
import type { Viewer } from './session';
import { memberNameFrom } from '../lib/text';

export const SNAPSHOT_HOURS = 24;
/** 控えにサーバーが無いとき、控えがこれより古ければ一度だけ聞き直す（そのあとサーバーに入った人のため） */
export const RECHECK_MINUTES = 5;

export type GroupRef = { id: string; guildId: string; guildName: string; title: string };
export type Actor = { memberId: number; name: string; isAdmin: boolean; userId: string };

/** 人ではなく、見回りや購読URLが読むときの「あなた」（メンバーではない） */
export const SYSTEM_ACTOR: Actor = { memberId: 0, name: '', isAdmin: true, userId: '' };

export type Access =
  | { ok: true; group: GroupRef; actor: Actor }
  | { ok: false; reason: 'login' | 'recheck' | 'forbidden' | 'notfound' };

export function snapshotAgeMs(viewer: Viewer, now: Date): number {
  return now.getTime() - Date.parse(viewer.guildsCheckedAt);
}

/**
 * グループに入れるか。botは知らせのBotのトークン（無ければundefinedか空）。
 * サーバーの一覧の控え（ログインのときに読む）か、Botで確かめた日時（サーバーごと）がSNAPSHOT_HOURSより新しければ、控えで決める。
 * 古い・控えにサーバーが無いときは、BotがそのサーバーにいればBotに聞く（Discordのログインの画面へ送らずに済む。Googleでログインした人のため）。
 * Botで分からなければ、今までどおりDiscordに聞き直す（recheck）
 */
export async function groupAccess(db: D1Database, viewer: Viewer | null, groupId: string, bot: string | undefined, now = new Date()): Promise<Access> {
  const g = await db
    .prepare('SELECT id, guild_id, guild_name, title FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ id: string; guild_id: string; guild_name: string; title: string }>();
  if (!g) return { ok: false, reason: 'notfound' };
  if (!viewer) return { ok: false, reason: 'login' };
  const group = { id: g.id, guildId: g.guild_id, guildName: g.guild_name, title: g.title };
  const ok = async (canManage: boolean): Promise<Access> => ({ ok: true, group, actor: await resolveMember(db, group.id, viewer, canManage, now) });
  const loginAge = snapshotAgeMs(viewer, now);
  const ug = await db
    .prepare('SELECT can_manage, checked_at FROM user_guilds WHERE user_id = ? AND guild_id = ?')
    .bind(viewer.id, g.guild_id)
    .first<{ can_manage: number; checked_at: string | null }>();
  const age = ug && ug.checked_at ? Math.min(loginAge, now.getTime() - Date.parse(ug.checked_at)) : loginAge;
  if (ug && age <= SNAPSHOT_HOURS * 3600_000) return ok(ug.can_manage === 1);
  if (bot) {
    const m = await guildMembership(bot, g.guild_id, viewer.id);
    if (m && !m.member) {
      // もうサーバーにいない。控えからも外す
      await db.prepare('DELETE FROM user_guilds WHERE user_id = ? AND guild_id = ?').bind(viewer.id, g.guild_id).run();
      return { ok: false, reason: 'forbidden' };
    }
    if (m) {
      // 管理できるかが読めなければ、控えの値のまま（無ければ管理できない）
      const canManage = m.canManage ?? ug?.can_manage === 1;
      await db
        .prepare(
          `INSERT INTO user_guilds (user_id, guild_id, name, can_manage, checked_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (user_id, guild_id) DO UPDATE SET can_manage = excluded.can_manage, checked_at = excluded.checked_at`,
        )
        .bind(viewer.id, g.guild_id, g.guild_name, canManage ? 1 : 0, now.toISOString())
        .run();
      return ok(canManage);
    }
  }
  if (loginAge > SNAPSHOT_HOURS * 3600_000) return { ok: false, reason: 'recheck' };
  // ここに来るのは、控えにサーバーが無いとき（控えにあって新しければ、上で入れている）
  return { ok: false, reason: loginAge > RECHECK_MINUTES * 60_000 ? 'recheck' : 'forbidden' };
}

type MemberRow = { id: number; name: string; is_admin: number };

/**
 * ログインした人に結びつくメンバーを返す。無ければ、管理者がDiscord ID付きで先に登録していた行に結びつけ、
 * それも無ければDiscordの表示名で新しく作る（同じ名前があれば「 (2)」を付ける）
 */
export async function resolveMember(db: D1Database, groupId: string, viewer: Viewer, canManage: boolean, now: Date): Promise<Actor> {
  const byUser = () =>
    db.prepare('SELECT id, name, is_admin FROM members WHERE group_id = ? AND user_id = ?').bind(groupId, viewer.id).first<MemberRow>();
  let m = await byUser();
  if (!m) {
    m = await db
      .prepare('UPDATE members SET user_id = ?1 WHERE group_id = ?2 AND discord_id = ?1 AND user_id IS NULL RETURNING id, name, is_admin')
      .bind(viewer.id, groupId)
      .first<MemberRow>();
  }
  if (!m) {
    const base = memberNameFrom(viewer.globalName, viewer.username);
    for (let i = 1; i <= 20 && !m; i++) {
      const name = i === 1 ? base : base + ' (' + i + ')';
      try {
        m = await db
          .prepare(
            `INSERT INTO members (group_id, name, user_id, discord_id, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (group_id, name) DO NOTHING RETURNING id, name, is_admin`,
          )
          .bind(groupId, name, viewer.id, viewer.id, now.toISOString())
          .first<MemberRow>();
      } catch {
        // 同じ人の最初の2つの呼び出しが重なった（user_idの一意に当たった）。先に作られた行を使う
        m = await byUser();
      }
    }
    if (!m) throw new Error('メンバーを作れませんでした');
  }
  return { memberId: m.id, name: m.name, isAdmin: m.is_admin === 1 || canManage, userId: viewer.id };
}
