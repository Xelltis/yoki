// 運営者の管理画面のための読み書き（グループ・利用者・送信の失敗・見回りの様子）。
// 運営者はグループの中身（卓・予定）は見ない。見るのは数と名前だけ
import type { AdminFailure, AdminGroupDetail, AdminGroupRow, AdminMember, AdminOverview, AdminUserRow, PatrolRecord } from '../../shared/admin';
import { badRequest, notFound } from '../lib/errors';
import { NAME_SEPARATORS, RESERVED_NAMES } from '../lib/text';
import { STATUS } from './constants';
import { type Form, str } from './form';

/** 送信の失敗に数える記録（送り直しの途中の HTTP…・ERROR… は数えない） */
const FAILED = "(l.result LIKE '送信失敗%' OR l.result LIKE '送らず%')";
const ACTIVE = `('${STATUS.RECRUIT}', '${STATUS.ADJUSTING}', '${STATUS.HELD}')`;
/** 最後の見回りがこれより前なら、cron が止まっているかもしれない */
const PATROL_STALE_MIN = 15;
const DAY_MS = 86400_000;

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

export async function overview(db: D1Database, now = new Date()): Promise<AdminOverview> {
  const [counts, meta, fails, recent] = await db.batch([
    db.prepare(
      `SELECT (SELECT count(*) FROM groups) AS groups, (SELECT count(*) FROM users) AS users,
              (SELECT count(*) FROM users WHERE banned_at IS NOT NULL) AS banned,
              (SELECT count(*) FROM auth_sessions WHERE expires_at > ?1) AS logins,
              (SELECT count(*) FROM sessions WHERE status IN ${ACTIVE}) AS active`,
    ).bind(now.toISOString()),
    db.prepare("SELECT key, value FROM meta WHERE key IN ('patrol', 'patrol_ok_at', 'hourly', 'daily', 'registration')"),
    db.prepare(`SELECT (SELECT count(*) FROM notify_log l WHERE l.at > ?1 AND ${FAILED}) AS day, (SELECT count(*) FROM notify_log l WHERE l.at > ?2 AND ${FAILED}) AS week`)
      .bind(ago(now, DAY_MS), ago(now, 7 * DAY_MS)),
    db.prepare(
      `SELECT l.at, l.group_id, g.title, l.kind, l.target, l.result FROM notify_log l JOIN groups g ON g.id = l.group_id
        WHERE ${FAILED} ORDER BY l.at DESC LIMIT 50`,
    ),
  ]);
  const c = counts!.results[0] as { groups: number; users: number; banned: number; logins: number; active: number };
  const m: Record<string, string> = {};
  for (const r of meta!.results as { key: string; value: string }[]) m[r.key] = r.value;
  let last: PatrolRecord | null = null;
  try { last = m.patrol ? (JSON.parse(m.patrol) as PatrolRecord) : null; } catch { last = null; }
  const f = fails!.results[0] as { day: number; week: number };
  return {
    now: now.toISOString(),
    counts: { groups: c.groups, users: c.users, bannedUsers: c.banned, logins: c.logins, activeSessions: c.active },
    patrol: {
      last,
      okAt: m.patrol_ok_at ?? '',
      hourly: m.hourly ?? '',
      daily: m.daily ?? '',
      stale: !last || Date.parse(last.at) < now.getTime() - PATROL_STALE_MIN * 60_000,
    },
    failures: {
      day: f.day,
      week: f.week,
      recent: (recent!.results as { at: string; group_id: string; title: string; kind: string; target: string; result: string }[]).map(
        (r): AdminFailure => ({ at: r.at, groupId: r.group_id, groupTitle: r.title, kind: r.kind, target: r.target, result: r.result }),
      ),
    },
    registrationOpen: m.registration !== 'closed',
  };
}

type GroupRowDb = {
  id: string; title: string; guild_id: string; guild_name: string; created_by: string; created_by_name: string; created_at: string; last_used_at: string | null;
  member_count: number; linked_count: number; admin_count: number; session_count: number; active_count: number; failures_week: number; channel_id: string;
};
const GROUP_SELECT = `SELECT g.id, g.title, g.guild_id, g.guild_name, g.created_by, coalesce(u.global_name, u.username, '') AS created_by_name, g.created_at, g.last_used_at, g.channel_id,
    (SELECT count(*) FROM members m WHERE m.group_id = g.id) AS member_count,
    (SELECT count(*) FROM members m WHERE m.group_id = g.id AND m.user_id IS NOT NULL) AS linked_count,
    (SELECT count(*) FROM members m WHERE m.group_id = g.id AND m.is_admin = 1) AS admin_count,
    (SELECT count(*) FROM sessions s WHERE s.group_id = g.id) AS session_count,
    (SELECT count(*) FROM sessions s WHERE s.group_id = g.id AND s.status IN ${ACTIVE}) AS active_count,
    (SELECT count(*) FROM notify_log l WHERE l.group_id = g.id AND l.at > ?1 AND ${FAILED}) AS failures_week
  FROM groups g LEFT JOIN users u ON u.id = g.created_by`;
function groupRow(r: GroupRowDb): AdminGroupRow {
  return {
    id: r.id, title: r.title, guildId: r.guild_id, guildName: r.guild_name, createdBy: r.created_by, createdByName: r.created_by_name,
    createdAt: r.created_at, lastUsedAt: r.last_used_at ?? r.created_at,
    memberCount: r.member_count, linkedCount: r.linked_count, adminCount: r.admin_count, sessionCount: r.session_count, activeCount: r.active_count, failuresWeek: r.failures_week,
  };
}

/** グループの一覧。最後に使われたのが新しい順 */
export async function listGroups(db: D1Database, now = new Date()): Promise<AdminGroupRow[]> {
  const r = await db.prepare(GROUP_SELECT + ' ORDER BY coalesce(g.last_used_at, g.created_at) DESC').bind(ago(now, 7 * DAY_MS)).all<GroupRowDb>();
  return r.results.map(groupRow);
}

export async function groupDetail(db: D1Database, id: string, now = new Date()): Promise<AdminGroupDetail> {
  const g = await db.prepare(GROUP_SELECT + ' WHERE g.id = ?2').bind(ago(now, 7 * DAY_MS), id).first<GroupRowDb>();
  if (!g) throw notFound('グループが見つかりません。');
  const [members, managers] = await db.batch([
    db.prepare(
      `SELECT m.id, m.name, m.discord_id, m.user_id, coalesce(u.global_name, u.username, '') AS user_name, m.is_admin, coalesce(u.last_login_at, '') AS last_login_at
         FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.is_admin DESC, m.id`,
    ).bind(id),
    db.prepare(
      `SELECT u.id, coalesce(u.global_name, u.username) AS name FROM user_guilds ug JOIN users u ON u.id = ug.user_id
        WHERE ug.guild_id = ? AND ug.can_manage = 1 ORDER BY name`,
    ).bind(g.guild_id),
  ]);
  return {
    ...groupRow(g),
    channelSet: !!g.channel_id,
    members: (members!.results as { id: number; name: string; discord_id: string; user_id: string | null; user_name: string; is_admin: number; last_login_at: string }[]).map(
      (m): AdminMember => ({ id: m.id, name: m.name, discordId: m.discord_id, userId: m.user_id, userName: m.user_name, isAdmin: m.is_admin === 1, lastLoginAt: m.last_login_at }),
    ),
    guildManagers: managers!.results as { id: string; name: string }[],
  };
}

async function requireGroup(db: D1Database, id: string): Promise<{ id: string; title: string; guild_id: string }> {
  const g = await db.prepare('SELECT id, title, guild_id FROM groups WHERE id = ?').bind(id).first<{ id: string; title: string; guild_id: string }>();
  if (!g) throw notFound('グループが見つかりません。');
  return g;
}

/**
 * 管理者を付け替える。form: { memberId, admin }、または { discordId, name, admin: true }（まだ開いていない人を管理者として足す。
 * 初めて開いたときに、その行に結びつく）。管理者の印が 0 人になる外し方は断る（足してから外す）
 */
export async function setGroupAdmin(db: D1Database, groupId: string, form: Form, now = new Date()): Promise<{ message: string }> {
  await requireGroup(db, groupId);
  const admin = form.admin === true;
  const discordId = str(form.discordId).replace(/[<@!>\s]/g, '');
  if (discordId) {
    if (!admin) throw badRequest('外すときは、メンバーを選んでください。');
    if (!/^\d{17,20}$/.test(discordId)) throw badRequest('Discord ユーザー ID は 17〜20 桁の数字です。');
    const hit = await db
      .prepare('SELECT id, name FROM members WHERE group_id = ?1 AND (discord_id = ?2 OR user_id = ?2) ORDER BY user_id IS NULL LIMIT 1')
      .bind(groupId, discordId)
      .first<{ id: number; name: string }>();
    if (hit) {
      await db.prepare('UPDATE members SET is_admin = 1 WHERE id = ?').bind(hit.id).run();
      return { message: hit.name + ' を管理者にしました。' };
    }
    const name = str(form.name);
    if (!name) throw badRequest('名前を入れてください（その人がまだグループを開いていないため）。');
    if (NAME_SEPARATORS.test(name) || RESERVED_NAMES.includes(name)) throw badRequest('その名前は使えません: ' + name);
    if (await db.prepare('SELECT 1 FROM members WHERE group_id = ? AND name = ?').bind(groupId, name).first()) throw badRequest('同じ名前のメンバーがいます: ' + name);
    await db.prepare('INSERT INTO members (group_id, name, discord_id, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').bind(groupId, name, discordId, now.toISOString()).run();
    return { message: name + ' を管理者として足しました。初めてグループを開いたときに、この人に結びつきます。' };
  }
  const memberId = Number(form.memberId);
  const m = await db.prepare('SELECT id, name, is_admin FROM members WHERE id = ? AND group_id = ?').bind(memberId, groupId).first<{ id: number; name: string; is_admin: number }>();
  if (!m) throw notFound('メンバーが見つかりません。');
  if (!admin && m.is_admin === 1) {
    const others = await db.prepare('SELECT count(*) AS n FROM members WHERE group_id = ? AND is_admin = 1 AND id <> ?').bind(groupId, m.id).first<number>('n');
    if (!others) throw badRequest('管理者の印が 0 人になります。先にほかの人を管理者にしてから外してください。');
  }
  await db.prepare('UPDATE members SET is_admin = ? WHERE id = ?').bind(admin ? 1 : 0, m.id).run();
  return { message: m.name + (admin ? ' を管理者にしました。' : ' を管理者から外しました。') };
}

/**
 * グループを別の Discord サーバーに結び直す（サーバーを引っ越したとき）。form: { guildId, guildName? }。
 * 名前とアイコンは、そのサーバーからログインした人の控えにあればそこから取る。無ければ guildName が要る。
 * 新しいサーバーの人は、控えを読み直したときに入れるようになり、古いサーバーの人は入れなくなる。メンバーの行と管理者の印は残る。
 * 知らせのチャンネルは古いサーバーのものなので、いつも外す（新しいサーバーに Bot を招いて選び直す）
 */
export async function changeGuild(db: D1Database, groupId: string, form: Form): Promise<{ message: string }> {
  const g = await requireGroup(db, groupId);
  const guildId = str(form.guildId);
  if (!/^\d{17,20}$/.test(guildId)) throw badRequest('Discord サーバーの ID は 17〜20 桁の数字です。');
  if (guildId === g.guild_id) throw badRequest('いまと同じサーバーです。');
  const known = await db.prepare('SELECT name, icon FROM user_guilds WHERE guild_id = ? LIMIT 1').bind(guildId).first<{ name: string; icon: string | null }>();
  const name = known?.name || str(form.guildName);
  if (!name) throw badRequest('サーバーの名前を入れてください（そのサーバーから、まだ誰もログインしていないため分かりません）。');
  await db.batch([
    db.prepare("UPDATE groups SET guild_id = ?, guild_name = ?, guild_icon = ?, channel_id = '', remind_channel_id = '', recruit_channel_id = '' WHERE id = ?")
      .bind(guildId, name, known?.icon ?? null, groupId),
    db.prepare("UPDATE series_notify SET channel_id = '' WHERE group_id = ?").bind(groupId),
  ]);
  return { message: '「' + g.title + '」を Discord サーバー「' + name + '」に結び直しました。知らせのチャンネルは外したので、新しいサーバーに Bot を招いて選び直してください。' };
}

/** 利用者の一覧。最後にログインしたのが新しい順 */
export async function listUsers(db: D1Database, isOp: (id: string) => boolean, now = new Date()): Promise<AdminUserRow[]> {
  const [users, groups] = await db.batch([
    db.prepare(
      `SELECT u.id, u.username, u.global_name, u.avatar, u.created_at, u.last_login_at, u.banned_at, u.banned_reason,
              (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS logins
         FROM users u ORDER BY u.last_login_at DESC`,
    ).bind(now.toISOString()),
    db.prepare('SELECT m.user_id, g.id, g.title FROM members m JOIN groups g ON g.id = m.group_id WHERE m.user_id IS NOT NULL ORDER BY g.title'),
  ]);
  const byUser: Record<string, { id: string; title: string }[]> = {};
  for (const r of groups!.results as { user_id: string; id: string; title: string }[]) (byUser[r.user_id] ??= []).push({ id: r.id, title: r.title });
  return (users!.results as { id: string; username: string; global_name: string | null; avatar: string | null; created_at: string; last_login_at: string; banned_at: string | null; banned_reason: string; logins: number }[]).map(
    (u): AdminUserRow => ({
      id: u.id, name: u.global_name || u.username, username: u.username, avatar: u.avatar, createdAt: u.created_at, lastLoginAt: u.last_login_at,
      logins: u.logins, groups: byUser[u.id] ?? [], bannedAt: u.banned_at ?? '', bannedReason: u.banned_reason, operator: isOp(u.id),
    }),
  );
}

async function requireUser(db: D1Database, id: string): Promise<{ id: string; name: string; banned_at: string | null }> {
  const u = await db.prepare('SELECT id, coalesce(global_name, username) AS name, banned_at FROM users WHERE id = ?').bind(id).first<{ id: string; name: string; banned_at: string | null }>();
  if (!u) throw notFound('利用者が見つかりません。');
  return u;
}

/** その人のログインをすべて消す（Discord でログインし直せば、また入れる） */
export async function logoutUser(db: D1Database, id: string): Promise<{ message: string }> {
  const u = await requireUser(db, id);
  const r = await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id).run();
  return { message: u.name + ' のログインを ' + r.meta.changes + ' 件消しました。' };
}

/** 締め出す・戻す。form: { banned, reason? }。締め出すときは、その人のログインも消す。運営者は締め出せない */
export async function setBan(db: D1Database, id: string, form: Form, isOp: (id: string) => boolean, now = new Date()): Promise<{ message: string }> {
  const u = await requireUser(db, id);
  if (form.banned !== true) {
    await db.prepare("UPDATE users SET banned_at = NULL, banned_reason = '' WHERE id = ?").bind(id).run();
    return { message: u.name + ' を締め出しから戻しました。Discord でログインすれば、また入れます。' };
  }
  if (isOp(id)) throw badRequest('運営者は締め出せません（OPERATOR_IDS から外してからにしてください）。');
  await db.batch([
    db.prepare('UPDATE users SET banned_at = ?, banned_reason = ? WHERE id = ?').bind(now.toISOString(), str(form.reason).slice(0, 200), id),
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id),
  ]);
  return { message: u.name + ' を締め出しました。ログインも消しました。' };
}

/**
 * 利用者を消す（本人から消してほしいと頼まれたとき）。消すのは、利用者の行（ログインと、入っているサーバーの控えも一緒に消える）と、
 * どのグループでもその人のメンバーの行（ログインで結びついた行と、その Discord ID で先に登録されていた行）。メンバーの行の消し方は、
 * グループの管理者がメンバーを消すときと同じで、予定とメモは消え、卓と回答には名前だけが残る。グループの「作った人」の ID も外す。
 * Discord サーバーにいれば、次に開いたときにまた入れる。運営者は消せない。締め出している人は、消すと締め出しの印も消えるので消せない
 */
export async function deleteUser(db: D1Database, id: string, isOp: (id: string) => boolean): Promise<{ message: string }> {
  const u = await requireUser(db, id);
  if (isOp(id)) throw badRequest('運営者は消せません（OPERATOR_IDS から外してからにしてください）。');
  if (u.banned_at) throw badRequest('締め出している人は消せません。消すと締め出しの印も消え、また入れるようになるためです。消すなら、先に締め出しから戻してください。');
  const mine = 'SELECT id FROM members WHERE user_id = ?1 OR discord_id = ?1';
  // 消すメンバーの行の数は、消す前に同じ batch の中で数える（DELETE の changes は、一緒に消えた予定の行も数えるため）
  const [counted] = await db.batch([
    db.prepare(`SELECT count(*) AS n FROM (${mine})`).bind(id),
    db.prepare(`UPDATE OR IGNORE session_people SET guest_name = (SELECT name FROM members m WHERE m.id = session_people.member_id), member_id = NULL WHERE member_id IN (${mine})`).bind(id),
    db.prepare(`UPDATE OR IGNORE poll_votes SET guest_name = (SELECT name FROM members m WHERE m.id = poll_votes.member_id), member_id = NULL WHERE member_id IN (${mine})`).bind(id),
    db.prepare('DELETE FROM members WHERE user_id = ?1 OR discord_id = ?1').bind(id),
    db.prepare("UPDATE groups SET created_by = '' WHERE created_by = ?").bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  const n = (counted!.results[0] as { n: number }).n;
  return { message: u.name + ' を消しました（グループのメンバーの行 ' + n + ' 件も消しました）。Discord サーバーにいれば、次に開いたときにまた入れます。' };
}
