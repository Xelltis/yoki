// 行けなくなった。開催の卓の参加者が、行けなくなったことをGMに伝える（本人だけが付け外しする）。
// 付けたら、サーバーがその場でGMに知らせる。GMは「日を組み直す」（状態を調整中に戻して候補日を出す）か、参加者を見直す
import { absencePayload } from '../discord/payloads';
import { postToTargets } from '../discord/send';
import { sessionTargets } from '../discord/targets';
import { badRequest } from '../lib/errors';
import { ABSENCE_NOTE_MAX, STATUS } from './constants';
import { type Form, requireSelf, str } from './form';
import { reloadLog } from './load';
import { findSession } from './model';
import { type Io, noticeNote } from './polls';
import type { Ctx } from './types';

/** 行けなくなった印を付ける・外す。form: { id, name（本人）, absent: falseなら外す, note: GMへの一言 } */
export async function setAbsence(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const s = findSession(ctx, form.id);
  if (s.status !== STATUS.HELD || !s.date || s.date < ctx.today) throw badRequest('「' + s.name + '」は、これから開く卓ではありません。');
  if (s.gm === name) throw badRequest('GMは、卓の「日を組み直す」か「編集」で、開催日を変えるか中止にしてください。');
  if (!s.members.includes(name)) throw badRequest(name + 'は「' + s.name + '」の参加者ではありません。');
  const db = ctx.db, memberId = ctx.actor.memberId;
  if (form.absent === false) {
    await db.prepare('DELETE FROM session_absences WHERE session_id = ? AND member_id = ?').bind(s.rowId, memberId).run();
    return { ok: true, id: s.id, message: '「' + s.name + '」の「行けなくなった」を取り消しました。' };
  }
  const note = str(form.note);
  if (note.length > ABSENCE_NOTE_MAX) throw badRequest('一言は' + ABSENCE_NOTE_MAX + '文字までです。');
  const again = s.absent.some((a) => a.name === name);
  await db
    .prepare('INSERT INTO session_absences (session_id, member_id, note, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (session_id, member_id) DO UPDATE SET note = excluded.note')
    .bind(s.rowId, memberId, note, ctx.now.toISOString())
    .run();
  // 一言を直しただけなら、もう一度は知らせない
  if (again) return { ok: true, id: s.id, message: '「' + s.name + '」への一言を直しました。' };
  const targets = sessionTargets(ctx, s);
  const notified = targets.length
    ? await postToTargets({ db, groupId: ctx.group.id, token: ctx.bot.token }, absencePayload(ctx, s, name, note), '行けなくなった', s.name, targets, io.sleep)
    : null;
  if (notified !== null) await reloadLog(ctx);
  return { ok: true, id: s.id, notified, message: '「' + s.name + '」に行けなくなったことを、GMに伝えました。' + noticeNote(notified, 'GMへの知らせ') };
}
