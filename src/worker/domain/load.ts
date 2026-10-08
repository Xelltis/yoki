// グループ1つ分のデータを、1回のdb.batchで読む。過ぎた卓の自動終了（GAS版autoFinishPast_）も同じ回で行う
import type { Actor } from '../auth/guard';
import { combineMarks, type Part } from '../../shared/parts';
import { addDays, jst } from '../lib/jst';
import type { Status } from './constants';
import type { Bot, Ctx, FeedScope, GoogleLinkRow, GroupRow, LogRow, Member, Role, Scenario, ScenarioMarkRow, Session } from './types';

type SessionRow = {
  id: number; seq: number; name: string; status: Status; date: string | null; start_time: string; end_time: string;
  place: string; memo: string; series: string; series_end: string | null; window_from: string | null; window_to: string | null;
  candidates: string; editor: string; updated_at: string; notified_at: string | null; asked_at: string | null;
  urged_at: string | null; soon_at: string | null; poll_ready_at: string | null; scenario_id: number | null;
  sheet_due: string | null; sheet_urged_at: string | null; slots_json: string; sheets_json: string;
  capacity: number | null; recruit_due: string | null; due_urged_at: string | null; absent_json: string;
};
type SlotJson = { pos: number; label: string; summary: string; member: number | null; secret: string | null; has: number; hopes: [number, number][] };

/** グループの行と、一緒に読むシナリオ（JSON）。読み込みの文を増やさないため、グループを読む文の中で読む */
type GroupWithExtras = GroupRow & { scenarios_json: string; marks_json: string };
type ScenarioJson = { id: number; name: string; system: string; min: number | null; max: number | null; hours: string; url: string; memo: string; by: number | null; at: string };

export const sessionCode = (seq: number) => 'S' + String(seq).padStart(3, '0');

/** 送信記録の新しい10件 */
const logStmt = (db: D1Database, groupId: string) => db.prepare('SELECT at, kind, target, result FROM notify_log WHERE group_id = ? ORDER BY id DESC LIMIT 10').bind(groupId);

/** 送信記録だけを読み直す（読み込んだあとにDiscordへ送ったとき。画面データ全体を読み直さずに済ませる） */
export async function reloadLog(ctx: Ctx): Promise<void> {
  ctx.log = (await logStmt(ctx.db, ctx.group.id).all<LogRow>()).results;
}

export async function loadGroup(
  db: D1Database, groupId: string, actor: Actor, appUrl: string, now = new Date(), bot: Bot = { token: '', clientId: '' }, googleReady = false,
): Promise<Ctx> {
  const today = jst(now).ymd;
  const at = now.toISOString();
  const res = await db.batch([
    // 開催日が過ぎた「開催」の卓を「終了」に（設定がONのとき。当日はそのまま）
    db
      .prepare(
        `UPDATE sessions SET status = '終了', updated_at = ?1
          WHERE group_id = ?2 AND status = '開催' AND date < ?3 AND (SELECT auto_finish FROM groups WHERE id = ?2) = 1`,
      )
      .bind(at, groupId, today),
    db
      .prepare(
        `SELECT g.*,
           (SELECT json_group_array(json_object('id', s.id, 'name', s.name, 'system', s.system, 'min', s.players_min, 'max', s.players_max,
                     'hours', s.hours, 'url', s.url, 'memo', s.memo, 'by', s.created_by, 'at', s.updated_at))
              FROM scenarios s WHERE s.group_id = g.id) AS scenarios_json,
           (SELECT json_group_array(json_array(ms.scenario_id, ms.member_id, ms.kind))
              FROM member_scenarios ms JOIN scenarios s ON s.id = ms.scenario_id WHERE s.group_id = g.id) AS marks_json
         FROM groups g WHERE g.id = ?`,
      )
      .bind(groupId),
    db.prepare('SELECT id, name, discord_id, note, is_admin, user_id FROM members WHERE group_id = ? ORDER BY id').bind(groupId),
    // 卓と、その準備（HOの枠・希望・キャラシ）。秘匿HOは、読み込む人（?2。0は人でない読み込み）がGMか割り当てた本人の枠だけ読む
    db
      .prepare(
        `SELECT s.*,
           (SELECT json_group_array(json_object('pos', sl.pos, 'label', sl.label, 'summary', sl.summary, 'member', sl.member_id,
                     'secret', CASE WHEN ?2 > 0 AND (sl.member_id = ?2 OR EXISTS (
                                 SELECT 1 FROM session_people gp WHERE gp.session_id = s.id AND gp.role = 'gm' AND gp.member_id = ?2)) THEN sl.secret END,
                     'has', sl.secret <> '',
                     'hopes', json((SELECT json_group_array(json_array(h.member_id, h.rank)) FROM slot_hopes h WHERE h.slot_id = sl.id))))
              FROM session_slots sl WHERE sl.session_id = s.id) AS slots_json,
           (SELECT json_group_array(json_array(sh.member_id, sh.url, sh.pc_name, sh.updated_at))
              FROM session_sheets sh WHERE sh.session_id = s.id) AS sheets_json,
           (SELECT json_group_array(json_array(a.member_id, a.note, a.at)) FROM session_absences a WHERE a.session_id = s.id) AS absent_json
         FROM sessions s WHERE s.group_id = ?1 ORDER BY s.seq`,
      )
      .bind(groupId, actor.memberId),
    db
      .prepare(
        `SELECT p.session_id, p.role, COALESCE(m.name, p.guest_name) AS name
           FROM session_people p JOIN sessions s ON s.id = p.session_id LEFT JOIN members m ON m.id = p.member_id
          WHERE s.group_id = ? ORDER BY p.session_id, p.role, p.pos`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT a.date, a.part, a.mark, a.source, m.name FROM availability a JOIN members m ON m.id = a.member_id
          WHERE m.group_id = ?1 AND a.date >= ?2 AND a.date < ?3`,
      )
      .bind(groupId, today, '9999-12-31'),
    db
      .prepare(
        `SELECT n.date, n.text, n.updated_at, m.name FROM avail_notes n JOIN members m ON m.id = n.member_id
          WHERE m.group_id = ? AND n.date >= ?`,
      )
      .bind(groupId, today),
    db.prepare('SELECT date, end_date, text, by_name, updated_at FROM day_notes WHERE group_id = ?').bind(groupId),
    db
      .prepare(
        `SELECT v.session_id, v.date, v.vote, COALESCE(m.name, v.guest_name) AS name
           FROM poll_votes v JOIN sessions s ON s.id = v.session_id LEFT JOIN members m ON m.id = v.member_id
          WHERE s.group_id = ?`,
      )
      .bind(groupId),
    db.prepare('SELECT series, channel_id, also_base, days, hour FROM series_notify WHERE group_id = ?').bind(groupId),
    logStmt(db, groupId),
    db.prepare('SELECT token, scope FROM calendar_feeds WHERE group_id = ? AND user_id = ?').bind(groupId, actor.userId),
    db.prepare('SELECT email, write_events, read_busy, busy_from, busy_to, synced_at, busy_at, error FROM google_links WHERE user_id = ?').bind(actor.userId),
    db.prepare('SELECT email FROM google_logins WHERE user_id = ?').bind(actor.userId),
  ]);
  const rows = <T>(i: number) => res[i]!.results as T[];
  const groupRow = rows<GroupWithExtras>(1)[0];
  if (!groupRow) throw new Error('グループが見つかりません: ' + groupId);
  const { scenarios_json, marks_json, ...group } = groupRow;
  const scenarios: Scenario[] = (JSON.parse(scenarios_json) as ScenarioJson[])
    .map((s) => ({ id: s.id, name: s.name, system: s.system, playersMin: s.min, playersMax: s.max, hours: s.hours, url: s.url, memo: s.memo, createdBy: s.by, updatedAt: s.at }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const scenarioMarks: ScenarioMarkRow[] = (JSON.parse(marks_json) as [number, number, ScenarioMarkRow['kind']][]).map(([scenarioId, memberId, kind]) => ({ scenarioId, memberId, kind }));

  const members: Member[] = rows<{ id: number; name: string; discord_id: string; note: string; is_admin: number; user_id: string | null }>(2).map((m) => ({
    id: m.id,
    name: m.name,
    discordId: m.discord_id,
    note: m.note,
    isAdmin: m.is_admin === 1,
    userId: m.user_id,
  }));

  // 行けなくなった印の行は、メンバーが消えたら一緒に消えるので、名前はいつもある
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
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
      scenarioId: r.scenario_id,
      sheetDue: r.sheet_due,
      sheetUrgedAt: r.sheet_urged_at,
      slots: (JSON.parse(r.slots_json) as SlotJson[])
        .map((x) => ({
          pos: x.pos, label: x.label, summary: x.summary, memberId: x.member, secret: x.secret, hasSecret: x.has === 1,
          hopes: x.hopes.map(([memberId, rank]) => ({ memberId, rank })),
        }))
        .sort((a, b) => a.pos - b.pos),
      sheets: (JSON.parse(r.sheets_json) as [number, string, string, string][]).map(([memberId, url, pc, at]) => ({ memberId, url, pc, at })),
      capacity: r.capacity,
      recruitDue: r.recruit_due,
      dueUrgedAt: r.due_urged_at,
      absent: (JSON.parse(r.absent_json) as [number, string, string][]).map(([id, note, at]) => ({ name: nameOf.get(id)!, note, at })).sort((a, b) => a.at.localeCompare(b.at)),
    };
  });

  const lastDay = addDays(today, group.avail_days);
  const avail: Ctx['avail'] = {};
  const availParts: Ctx['availParts'] = {};
  const availGoogle: Ctx['availGoogle'] = {};
  for (const a of rows<{ date: string; part: '' | Part; mark: string; source: string; name: string }>(5)) {
    if (a.date >= lastDay) continue;
    if (a.part) ((availParts[a.date] ??= {})[a.name] ??= ['', ''])[a.part === '昼' ? 0 : 1] = a.mark;
    else (avail[a.date] ??= {})[a.name] = a.mark;
    if (a.source !== 'google') continue;
    const g = (availGoogle[a.date] ??= []);
    if (!g.includes(a.name)) g.push(a.name);
  }
  // 昼と夜に分けて入れた日は、1日の印にまとめた印も持つ（分けないところは、これを見る）
  for (const [date, byName] of Object.entries(availParts)) for (const [name, [d, n]] of Object.entries(byName)) (avail[date] ??= {})[name] = combineMarks(d, n);
  const availNotes: Ctx['availNotes'] = {};
  for (const n of rows<{ date: string; text: string; updated_at: string; name: string }>(6)) (availNotes[n.date] ??= {})[n.name] = { text: n.text, at: n.updated_at };
  const dayNotes: Ctx['dayNotes'] = {};
  for (const n of rows<{ date: string; end_date: string | null; text: string; by_name: string; updated_at: string }>(7)) {
    dayNotes[n.date] = { text: n.text, by: n.by_name, at: n.updated_at, to: n.end_date ?? '' };
  }
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
    availParts,
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
    googleLoginEmail: rows<{ email: string }>(13)[0]?.email ?? '',
    availGoogle,
    scenarios,
    scenarioMarks,
  };
}
