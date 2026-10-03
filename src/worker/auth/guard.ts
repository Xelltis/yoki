// グループに入れるかの確認と、「あなた」（メンバー）を決める。
// 入れるのは、グループに結びつけた Discord サーバーにいる人。参加しているサーバーはログインのときに控え、
// 控えが古ければ（SNAPSHOT_HOURS）Discord に黙って聞き直す（/auth/login は prompt=none）
import type { Viewer } from './session';
import { memberNameFrom } from '../lib/text';

export const SNAPSHOT_HOURS = 24;
/** 控えにサーバーが無いとき、控えがこれより古ければ一度だけ聞き直す（そのあとサーバーに入った人のため） */
export const RECHECK_MINUTES = 5;

export type GroupRef = { id: string; guildId: string; guildName: string; title: string };
export type Actor = { memberId: number; name: string; isAdmin: boolean; userId: string };

export type Access =
  | { ok: true; group: GroupRef; actor: Actor }
  | { ok: false; reason: 'login' | 'recheck' | 'forbidden' | 'notfound' };

export function snapshotAgeMs(viewer: Viewer, now: Date): number {
  return now.getTime() - Date.parse(viewer.guildsCheckedAt);
}

export async function groupAccess(db: D1Database, viewer: Viewer | null, groupId: string, now = new Date()): Promise<Access> {
  const g = await db
    .prepare('SELECT id, guild_id, guild_name, title FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ id: string; guild_id: string; guild_name: string; title: string }>();
  if (!g) return { ok: false, reason: 'notfound' };
  if (!viewer) return { ok: false, reason: 'login' };
  const age = snapshotAgeMs(viewer, now);
  if (age > SNAPSHOT_HOURS * 3600_000) return { ok: false, reason: 'recheck' };
  const ug = await db
    .prepare('SELECT can_manage FROM user_guilds WHERE user_id = ? AND guild_id = ?')
    .bind(viewer.id, g.guild_id)
    .first<{ can_manage: number }>();
  if (!ug) return { ok: false, reason: age > RECHECK_MINUTES * 60_000 ? 'recheck' : 'forbidden' };
  const group = { id: g.id, guildId: g.guild_id, guildName: g.guild_name, title: g.title };
  return { ok: true, group, actor: await resolveMember(db, group.id, viewer, ug.can_manage === 1, now) };
}

type MemberRow = { id: number; name: string; is_admin: number };

/**
 * ログインした人に結びつくメンバーを返す。無ければ、管理者が Discord ID 付きで先に登録していた行に結びつけ、
 * それも無ければ Discord の表示名で新しく作る（同じ名前があれば「 (2)」を付ける）
 */
export async function resolveMember(db: D1Database, groupId: string, viewer: Viewer, canManage: boolean, now = new Date()): Promise<Actor> {
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
        // 同じ人の最初の 2 つの呼び出しが重なった（user_id の一意に当たった）。先に作られた行を使う
        m = await byUser();
      }
    }
    if (!m) throw new Error('メンバーを作れませんでした');
  }
  return { memberId: m.id, name: m.name, isAdmin: m.is_admin === 1 || canManage, userId: viewer.id };
}
