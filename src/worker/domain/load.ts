// グループ 1 つ分のデータを、1 回の db.batch で読む。過ぎた卓の自動終了（GAS 版 autoFinishPast_）も同じ回で行う
import type { Actor } from '../auth/guard';
import { addDays, jst } from '../lib/jst';
import type { Status } from './constants';
import type { Bot, Ctx, FeedScope, GoogleLinkRow, GroupRow, Member, Role, Session } from './types';

type SessionRow = {
  id: number; seq: number; name: string; status: Status; date: string | null; start_time: string; end_time: string;
  place: string; memo: string; series: string; series_end: string | null; window_from: string | null; window_to: string | null;
  candidates: string; editor: string; updated_at: string; notified_at: string | null; asked_at: string | null;
  urged_at: string | null; soon_at: string | null; poll_ready_at: string | null;
};

export const sessionCode = (seq: number) => 'S' + String(seq).padStart(3, '0');

export async function loadGroup(
  db: D1Database, groupId: string, actor: Actor, appUrl: string, now = new Date(), bot: Bot = { token: '', clientId: '' }, googleReady = false,
): Promise<Ctx> {
  const today = jst(now).ymd;
  const at = now.toISOString();
  const res = await db.batch([
    // 開催日が過ぎた「開催」の卓を「終了」に（設定が ON のとき。当日はそのまま）
    db
      .prepare(
        `UPDATE sessions SET status = '終了', updated_at = ?1
          WHERE group_id = ?2 AND status = '開催' AND date < ?3 AND (SELECT auto_finish FROM groups WHERE id = ?2) = 1`,
      )
      .bind(at, groupId, today),
    db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId),
    db.prepare('SELECT id, name, discord_id, note, is_admin, user_id FROM members WHERE group_id = ? ORDER BY id').bind(groupId),
    db.prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY seq').bind(groupId),
    db
      .prepare(
        `SELECT p.session_id, p.role, COALESCE(m.name, p.guest_name) AS name
           FROM session_people p JOIN sessions s ON s.id = p.session_id LEFT JOIN members m ON m.id = p.member_id
          WHERE s.group_id = ? ORDER BY p.session_id, p.role, p.pos`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT a.date, a.mark, a.source, m.name FROM availability a JOIN members m ON m.id = a.member_id
          WHERE m.group_id = ?1 AND a.date >= ?2 AND a.date < ?3`,
      )
      .bind(groupId, today, '9999-12-31'),
    db
      .prepare(
        `SELECT n.date, n.text, n.updated_at, m.name FROM avail_notes n JOIN members m ON m.id = n.member_id
          WHERE m.group_id = ? AND n.date >= ?`,
      )
      .bind(groupId, today),
    db.prepare('SELECT date, text, by_name, updated_at FROM day_notes WHERE group_id = ?').bind(groupId),
    db
      .prepare(
        `SELECT v.session_id, v.date, v.vote, COALESCE(m.name, v.guest_name) AS name
           FROM poll_votes v JOIN sessions s ON s.id = v.session_id LEFT JOIN members m ON m.id = v.member_id
          WHERE s.group_id = ?`,
      )
      .bind(groupId),
    db.prepare('SELECT series, channel_id, also_base, days, hour FROM series_notify WHERE group_id = ?').bind(groupId),
    db.prepare('SELECT at, kind, target, result FROM notify_log WHERE group_id = ? ORDER BY id DESC LIMIT 10').bind(groupId),
    db.prepare('SELECT token, scope FROM calendar_feeds WHERE group_id = ? AND user_id = ?').bind(groupId, actor.userId),
    db.prepare('SELECT email, write_events, read_busy, busy_from, busy_to, synced_at, busy_at, error FROM google_links WHERE user_id = ?').bind(actor.userId),
  ]);
  const rows = <T>(i: number) => res[i]!.results as T[];
  const group = rows<GroupRow>(1)[0];
  if (!group) throw new Error('グループが見つかりません: ' + groupId);

  const members: Member[] = rows<{ id: number; name: string; discord_id: string; note: string; is_admin: number; user_id: string | null }>(2).map((m) => ({
    id: m.id,
    name: m.name,
    discordId: m.discord_id,
    note: m.note,
    isAdmin: m.is_admin === 1,
    userId: m.user_id,
  }));

  const people = new Map<number, Record<Role, string[]>>();
  for (const p of rows<{ session_id: number; role: Role; name: string }>(4)) {
    const e = people.get(p.session_id) ?? { gm: [], member: [], want: [], interest: [] };
    e[p.role].push(p.name);
    people.set(p.session_id, e);
  }
  const sessions: Session[] = rows<SessionRow>(3).map((r) => {
    const pp = people.get(r.id) ?? { gm: [], member: [], want: [], interest: [] };
    return {
      rowId: r.id,
      id: sessionCode(r.seq),
      seq: r.seq,
      name: r.name,
      gm: pp.gm[0] ?? '',
      members: pp.member,
      want: pp.want,
      interest: pp.interest,
      date: r.date,
      start: r.start_time,
      end: r.end_time,
      status: r.status,
      place: r.place,
      memo: r.memo,
      series: r.series,
      seriesEnd: r.series_end,
      windowFrom: r.window_from,
      windowTo: r.window_to,
      candidates: JSON.parse(r.candidates) as string[],
      editor: r.editor,
      updatedAt: r.updated_at,
      notifiedAt: r.notified_at,
      askedAt: r.asked_at,
      urgedAt: r.urged_at,
      soonAt: r.soon_at,
      pollReadyAt: r.poll_ready_at,
    };
  });

  const lastDay = addDays(today, group.avail_days);
  const avail: Ctx['avail'] = {};
  const availGoogle: Ctx['availGoogle'] = {};
  for (const a of rows<{ date: string; mark: string; source: string; name: string }>(5)) {
    if (a.date >= lastDay) continue;
    (avail[a.date] ??= {})[a.name] = a.mark;
    if (a.source === 'google') (availGoogle[a.date] ??= []).push(a.name);
  }
  const availNotes: Ctx['availNotes'] = {};
  for (const n of rows<{ date: string; text: string; updated_at: string; name: string }>(6)) (availNotes[n.date] ??= {})[n.name] = { text: n.text, at: n.updated_at };
  const dayNotes: Ctx['dayNotes'] = {};
  for (const n of rows<{ date: string; text: string; by_name: string; updated_at: string }>(7)) dayNotes[n.date] = { text: n.text, by: n.by_name, at: n.updated_at };
  const votes: Ctx['votes'] = new Map();
  for (const v of rows<{ session_id: number; date: string; vote: string; name: string }>(8)) {
    const byDay = votes.get(v.session_id) ?? {};
    (byDay[v.date] ??= {})[v.name] = v.vote;
    votes.set(v.session_id, byDay);
  }
  const seriesNotify: Ctx['seriesNotify'] = {};
  for (const s of rows<{ series: string; channel_id: string; also_base: number; days: number | null; hour: number | null }>(9)) {
    seriesNotify[s.series] = { channelId: s.channel_id, alsoBase: s.also_base === 1, days: s.days, hour: s.hour };
  }

  return {
    db,
    group,
    members,
    memberByName: new Map(members.map((m) => [m.name, m])),
    sessions,
    avail,
    availNotes,
    dayNotes,
    votes,
    seriesNotify,
    log: rows(10),
    now,
    today,
    actor,
    appUrl,
    bot,
    feed: rows<{ token: string; scope: FeedScope }>(11)[0] ?? null,
    google: rows<GoogleLinkRow>(12)[0] ?? null,
    googleReady,
    availGoogle,
  };
}
