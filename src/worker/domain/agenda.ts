// 自分の予定の一覧（入口の画面）。入っているグループをまたいで、これからの卓と、あなたの番（日程調整・キャラシ）を集める
import type { AgendaItem, AgendaResponse } from '../../shared/api';
import { addDays, jst } from '../lib/jst';
import { sessionCode } from './load';

/** 卓を出す日数（今日から） */
export const AGENDA_DAYS = 60;
/** 卓を出す数 */
export const AGENDA_SESSIONS = 20;

type Row = {
  group_id: string; title: string; seq: number; name: string; status: string; date: string | null; start_time: string; end_time: string;
  candidates: string; poll_ready: number; poll_due: string | null; sheet_due: string | null; role: 'gm' | 'member'; voted_json: string; sheet_done: number; absent: number;
};

/**
 * その人の予定の一覧。groupIdsは入れるグループ（入口のグループの一覧と同じ）。
 * 読むのはその人がGMか参加者の、「開催」と「調整中」の卓だけ
 */
export async function agendaOf(db: D1Database, userId: string, groupIds: string[], now: Date): Promise<AgendaResponse> {
  const today = jst(now).ymd;
  const rows = (await db
    .prepare(
      `SELECT g.id AS group_id, g.title, s.seq, s.name, s.status, s.date, s.start_time, s.end_time, s.candidates, s.poll_ready_at IS NOT NULL AS poll_ready, s.poll_due, s.sheet_due, p.role,
         (SELECT json_group_array(v.date) FROM poll_votes v WHERE v.session_id = s.id AND v.member_id = m.id) AS voted_json,
         EXISTS (SELECT 1 FROM session_sheets sh WHERE sh.session_id = s.id AND sh.member_id = m.id) AS sheet_done,
         EXISTS (SELECT 1 FROM session_absences a WHERE a.session_id = s.id AND a.member_id = m.id) AS absent
         FROM members m JOIN groups g ON g.id = m.group_id
         JOIN session_people p ON p.member_id = m.id AND p.role IN ('gm', 'member') JOIN sessions s ON s.id = p.session_id
        WHERE m.user_id = ?1 AND m.group_id IN (SELECT value FROM json_each(?2))
          AND ((s.status = '開催' AND s.date >= ?3) OR s.status = '調整中')`,
    )
    .bind(userId, JSON.stringify(groupIds), today)
    .all<Row>()).results;
  const turns: AgendaItem[] = [], sessions: AgendaItem[] = [];
  const last = addDays(today, AGENDA_DAYS);
  for (const r of rows) {
    const item = (kind: AgendaItem['kind'], date: string): AgendaItem =>
      ({ kind, groupId: r.group_id, groupTitle: r.title, id: sessionCode(r.seq), name: r.name, date, start: r.start_time, end: r.end_time });
    if (r.status === '開催') {
      if (!r.absent && r.date! < last) sessions.push(item('session', r.date!));
    } else {
      const voted = JSON.parse(r.voted_json) as string[];
      // 答える番には、回答の締め切りを添える（無ければ空）
      if ((JSON.parse(r.candidates) as string[]).some((k) => k >= today && !voted.includes(k))) turns.push(item('vote', r.poll_due ?? ''));
      else if (r.poll_ready && r.role === 'gm') turns.push(item('decide', ''));
    }
    if (r.role === 'member' && r.sheet_due && r.sheet_due >= today && !r.sheet_done && !r.absent) turns.push(item('sheet', r.sheet_due));
  }
  const order = (a: AgendaItem, b: AgendaItem) => (a.date + a.start).localeCompare(b.date + b.start) || a.name.localeCompare(b.name, 'ja');
  return { today, items: [...turns.sort(order), ...sessions.sort(order).slice(0, AGENDA_SESSIONS)] };
}
