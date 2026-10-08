// メンバーの予定（都合の △ ×）と予定のメモ、日付メモ（GAS版Availability.js）
import { badRequest } from '../lib/errors';
import { addDays, daysBetween, dowOf, fmtDateJa, parseYmd } from '../lib/jst';
import { AVAIL_NOTE_MAX, DAY_NOTE_MAX, DAY_NOTE_SPAN_MAX, MARKS } from './constants';
import { type Form, requireSelf, str } from './form';
import { bookedMap } from './model';
import type { Ctx } from './types';

function readMark(v: unknown): string {
  const mark = str(v);
  if (mark && !MARKS.includes(mark)) throw badRequest('印は △ か × です（空欄は参加できる扱い）。');
  return mark;
}

/** 予定表の範囲（今日からavail_days日） */
function inRange(ctx: Ctx, ymd: string): boolean {
  return ymd >= ctx.today && ymd < addDays(ctx.today, ctx.group.avail_days);
}

/** 本人が入れる印。Googleから入れた印の日も、本人の印になる（もうGoogleからは書き換えない） */
const upsertMark = "INSERT INTO availability (member_id, date, mark) VALUES (?1, ?2, ?3) ON CONFLICT (member_id, date) DO UPDATE SET mark = excluded.mark, source = ''";
/** Googleから入れた印を本人が消したら、その日を覚えておく（もう入れない） */
const dismissGoogle = `INSERT INTO google_dismissed (member_id, date)
  SELECT member_id, date FROM availability WHERE member_id = ?1 AND source = 'google' AND date IN (SELECT value FROM json_each(?2))
  ON CONFLICT DO NOTHING`;

/** 予定の1マスを書く。form: { name（本人）, ymd, mark }。卓に入っている日は変えられない */
export async function setAvailability(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const mark = readMark(form.mark);
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!inRange(ctx, ymd)) throw badRequest(fmtDateJa(ymd) + 'は予定表の範囲外です。設定の「予定の日数」を増やしてください。');
  if (bookedMap(ctx.sessions)[ymd]?.[name]) throw badRequest(fmtDateJa(ymd) + 'は' + name + 'が卓に入っている日なので、都合は変えられません。');
  if (mark) await ctx.db.prepare(upsertMark).bind(memberId, ymd, mark).run();
  else {
    await ctx.db.batch([
      ctx.db.prepare(dismissGoogle).bind(memberId, JSON.stringify([ymd])),
      ctx.db.prepare('DELETE FROM availability WHERE member_id = ? AND date = ?').bind(memberId, ymd),
    ]);
  }
  return { ok: true, name, ymd, mark };
}

/**
 * 自分の列に、期間と曜日を絞ってまとめて印とメモを入れる。
 * form: { name, from, to, weekdays: [0-6], mark: '△'|'×'|'', skipMark: trueなら印は変えない,
 *         note: 入れるメモ（送らなければメモは変えない。空なら消す）, keep: trueなら入力済みのマス（印・メモ）は残す }
 * メモは、卓のある日にも入れる（予定のメモと同じ）
 */
export async function setAvailabilityBulk(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const skipMark = form.skipMark === true;
  const mark = skipMark ? '' : readMark(form.mark);
  const note = form.note === undefined || form.note === null ? null : str(form.note);
  if (skipMark && note === null) throw badRequest('入れる印かメモを選んでください。');
  if (note && note.length > AVAIL_NOTE_MAX) throw badRequest('メモは' + AVAIL_NOTE_MAX + '文字までです。');
  const from = parseYmd(form.from), to = parseYmd(form.to);
  if (!from || !to) throw badRequest('期間を入れてください。');
  if (from > to) throw badRequest('期間の始まりが終わりより後になっています。');
  const wds = (Array.isArray(form.weekdays) ? form.weekdays : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((n) => n >= 0 && n <= 6);
  if (!wds.length) throw badRequest('曜日を選んでください。');
  const keep = !!form.keep;
  const booked = bookedMap(ctx.sessions);
  const days: string[] = [], noteDays: string[] = [];
  let skippedBooked = 0, skippedKeep = 0;
  for (let d = ctx.today; inRange(ctx, d); d = addDays(d, 1)) {
    if (d < from || d > to || !wds.includes(dowOf(d))) continue;
    let kept = false;
    if (note !== null) {
      const cur = ctx.availNotes[d]?.[name]?.text ?? '';
      if (cur !== note) {
        if (keep && cur) kept = true;
        else noteDays.push(d);
      }
    }
    if (!skipMark) {
      const cur = ctx.avail[d]?.[name] ?? '';
      if (booked[d]?.[name]) skippedBooked++;
      else if (cur !== mark) {
        if (keep && cur) kept = true;
        else days.push(d);
      }
    }
    if (kept) skippedKeep++;
  }
  const db = ctx.db, stmts: D1PreparedStatement[] = [];
  if (days.length) {
    const json = JSON.stringify(days);
    if (mark) {
      stmts.push(
        db.prepare(`INSERT INTO availability (member_id, date, mark) SELECT ?1, value, ?3 FROM json_each(?2) WHERE true
                    ON CONFLICT (member_id, date) DO UPDATE SET mark = excluded.mark, source = ''`).bind(memberId, json, mark),
      );
    } else {
      stmts.push(
        db.prepare(dismissGoogle).bind(memberId, json),
        db.prepare('DELETE FROM availability WHERE member_id = ? AND date IN (SELECT value FROM json_each(?))').bind(memberId, json),
      );
    }
  }
  if (noteDays.length) {
    const json = JSON.stringify(noteDays);
    stmts.push(
      note
        ? db.prepare(`INSERT INTO avail_notes (member_id, date, text, updated_at) SELECT ?1, value, ?3, ?4 FROM json_each(?2) WHERE true
                      ON CONFLICT (member_id, date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).bind(memberId, json, note, ctx.now.toISOString())
        : db.prepare('DELETE FROM avail_notes WHERE member_id = ? AND date IN (SELECT value FROM json_each(?))').bind(memberId, json),
    );
  }
  if (stmts.length) await db.batch(stmts);
  // 印だけ: 「ソラの3日に「×」を入れました。」、メモだけ: 「ソラの4日にメモを入れました。」、両方: 印の文に「メモを入れたのは4日です。」を足す
  let message = skipMark
    ? name + 'の' + noteDays.length + (note ? '日にメモを入れました。' : '日のメモを消しました。')
    : name + 'の' + days.length + '日に「' + (mark || '空欄') + '」を入れました。' + (note === null ? '' : 'メモを' + (note ? '入れた' : '消した') + 'のは' + noteDays.length + '日です。');
  const skipped: string[] = [];
  if (skippedBooked) skipped.push('卓のある日を' + skippedBooked + '日');
  if (skippedKeep) skipped.push('入力済みの日を' + skippedKeep + '日');
  if (skipped.length) message += '（' + skipped.join('、') + '飛ばしました）';
  return { ok: true, count: days.length, notes: noteDays.length, skippedBooked, skippedKeep, message };
}

/** 予定の1マスにメモを書く。△×とは別で、卓に入っている日にも書ける。空にすると消える */
export async function setAvailNote(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  const text = str(form.text);
  if (text.length > AVAIL_NOTE_MAX) throw badRequest('メモは' + AVAIL_NOTE_MAX + '文字までです。');
  if (text) {
    await ctx.db
      .prepare('INSERT INTO avail_notes (member_id, date, text, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (member_id, date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
      .bind(memberId, ymd, text, ctx.now.toISOString())
      .run();
  } else {
    await ctx.db.prepare('DELETE FROM avail_notes WHERE member_id = ? AND date = ?').bind(memberId, ymd).run();
  }
  return { ok: true, ymd, name, message: fmtDateJa(ymd) + ' ' + name + 'のメモを' + (text ? '保存' : '消') + 'しました。' };
}

/**
 * 日付メモを書く。空にすると消す。form: { ymd, text, to }
 * toを入れると、ymdからtoまでの期間のメモになる（合宿・テスト期間など）。空かymdと同じなら1日だけ
 */
export async function setDayNote(ctx: Ctx, form: Form) {
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  const text = str(form.text);
  if (text.length > DAY_NOTE_MAX) throw badRequest('メモは' + DAY_NOTE_MAX + '文字までです。');
  let to: string | null = null;
  if (text && str(form.to)) {
    to = parseYmd(form.to);
    if (!to) throw badRequest('期間の終わりの日付が読めません: ' + str(form.to));
    if (to < ymd) throw badRequest('期間の終わりが始まりより前になっています。');
    if (daysBetween(ymd, to) >= DAY_NOTE_SPAN_MAX) throw badRequest('期間のメモは' + DAY_NOTE_SPAN_MAX + '日までです。');
    if (to === ymd) to = null;
  }
  if (text) {
    await ctx.db
      .prepare(`INSERT INTO day_notes (group_id, date, text, by_name, updated_at, end_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT (group_id, date) DO UPDATE SET text = excluded.text, by_name = excluded.by_name, updated_at = excluded.updated_at, end_date = excluded.end_date`)
      .bind(ctx.group.id, ymd, text, ctx.actor.name, ctx.now.toISOString(), to)
      .run();
  } else {
    await ctx.db.prepare('DELETE FROM day_notes WHERE group_id = ? AND date = ?').bind(ctx.group.id, ymd).run();
  }
  const when = fmtDateJa(ymd) + (to ? '〜' + fmtDateJa(to) : '');
  return { ok: true, ymd, to: to ?? '', message: when + 'のメモを' + (text ? '保存しました。' : '消しました。') };
}
