// メンバーの予定（都合の △ ×）と予定のメモ、日付メモ（GAS 版 Availability.js）
import { badRequest } from '../lib/errors';
import { addDays, dowOf, fmtDateJa, parseYmd } from '../lib/jst';
import { AVAIL_NOTE_MAX, DAY_NOTE_MAX, MARKS } from './constants';
import { type Form, requireSelf, str } from './form';
import { bookedMap } from './model';
import type { Ctx } from './types';

function readMark(v: unknown): string {
  const mark = str(v);
  if (mark && !MARKS.includes(mark)) throw badRequest('印は △ か × です（空欄は参加できる扱い）。');
  return mark;
}

/** 予定表の範囲（今日から avail_days 日） */
function inRange(ctx: Ctx, ymd: string): boolean {
  return ymd >= ctx.today && ymd < addDays(ctx.today, ctx.group.avail_days);
}

/** 本人が入れる印。Google から入れた印の日も、本人の印になる（もう Google からは書き換えない） */
const upsertMark = "INSERT INTO availability (member_id, date, mark) VALUES (?1, ?2, ?3) ON CONFLICT (member_id, date) DO UPDATE SET mark = excluded.mark, source = ''";
/** Google から入れた印を本人が消したら、その日を覚えておく（もう入れない） */
const dismissGoogle = `INSERT INTO google_dismissed (member_id, date)
  SELECT member_id, date FROM availability WHERE member_id = ?1 AND source = 'google' AND date IN (SELECT value FROM json_each(?2))
  ON CONFLICT DO NOTHING`;

/** 予定の 1 マスを書く。form: { name（本人）, ymd, mark }。卓に入っている日は変えられない */
export async function setAvailability(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const mark = readMark(form.mark);
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!inRange(ctx, ymd)) throw badRequest(fmtDateJa(ymd) + ' は予定表の範囲外です。設定の「予定の日数」を増やしてください。');
  if (bookedMap(ctx.sessions)[ymd]?.[name]) throw badRequest(fmtDateJa(ymd) + ' は ' + name + ' が卓に入っている日なので、都合は変えられません。');
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
 * 自分の列に、期間と曜日を絞ってまとめて印を入れる。
 * form: { name, from, to, weekdays: [0-6], mark: '△'|'×'|'', keep: true なら入力済みのマスは残す }
 */
export async function setAvailabilityBulk(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const mark = readMark(form.mark);
  const from = parseYmd(form.from), to = parseYmd(form.to);
  if (!from || !to) throw badRequest('期間を入れてください。');
  if (from > to) throw badRequest('期間の始まりが終わりより後になっています。');
  const wds = (Array.isArray(form.weekdays) ? form.weekdays : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((n) => n >= 0 && n <= 6);
  if (!wds.length) throw badRequest('曜日を選んでください。');
  const keep = !!form.keep;
  const booked = bookedMap(ctx.sessions);
  const days: string[] = [];
  let skippedBooked = 0, skippedKeep = 0;
  for (let d = ctx.today; inRange(ctx, d); d = addDays(d, 1)) {
    if (d < from || d > to || !wds.includes(dowOf(d))) continue;
    if (booked[d]?.[name]) { skippedBooked++; continue; }
    const cur = ctx.avail[d]?.[name] ?? '';
    if (cur === mark) continue;
    if (keep && cur) { skippedKeep++; continue; }
    days.push(d);
  }
  if (days.length) {
    const json = JSON.stringify(days);
    if (mark) {
      await ctx.db
        .prepare(`INSERT INTO availability (member_id, date, mark) SELECT ?1, value, ?3 FROM json_each(?2) WHERE true
                  ON CONFLICT (member_id, date) DO UPDATE SET mark = excluded.mark, source = ''`)
        .bind(memberId, json, mark)
        .run();
    } else {
      await ctx.db.batch([
        ctx.db.prepare(dismissGoogle).bind(memberId, json),
        ctx.db.prepare('DELETE FROM availability WHERE member_id = ? AND date IN (SELECT value FROM json_each(?))').bind(memberId, json),
      ]);
    }
  }
  let message = name + ' の ' + days.length + ' 日に「' + (mark || '空欄') + '」を入れました。';
  const notes: string[] = [];
  if (skippedBooked) notes.push('卓の日 ' + skippedBooked + ' 日');
  if (skippedKeep) notes.push('入力済み ' + skippedKeep + ' 日');
  if (notes.length) message += '（' + notes.join('、') + 'は飛ばしました）';
  return { ok: true, count: days.length, skippedBooked, skippedKeep, message };
}

/** 予定の 1 マスにメモを書く。△×とは別で、卓に入っている日にも書ける。空にすると消える */
export async function setAvailNote(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name), memberId = ctx.actor.memberId;
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  const text = str(form.text);
  if (text.length > AVAIL_NOTE_MAX) throw badRequest('メモは ' + AVAIL_NOTE_MAX + ' 文字までです。');
  if (text) {
    await ctx.db
      .prepare('INSERT INTO avail_notes (member_id, date, text, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (member_id, date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
      .bind(memberId, ymd, text, ctx.now.toISOString())
      .run();
  } else {
    await ctx.db.prepare('DELETE FROM avail_notes WHERE member_id = ? AND date = ?').bind(memberId, ymd).run();
  }
  return { ok: true, ymd, name, message: fmtDateJa(ymd) + ' ' + name + ' のメモを' + (text ? '保存' : '消') + 'しました。' };
}

/** 日付メモを書く。空にすると消す。form: { ymd, text } */
export async function setDayNote(ctx: Ctx, form: Form) {
  const ymd = parseYmd(form.ymd);
  if (!ymd) throw badRequest('日付が読めません: ' + str(form.ymd));
  const text = str(form.text);
  if (text.length > DAY_NOTE_MAX) throw badRequest('メモは ' + DAY_NOTE_MAX + ' 文字までです。');
  if (text) {
    await ctx.db
      .prepare(`INSERT INTO day_notes (group_id, date, text, by_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT (group_id, date) DO UPDATE SET text = excluded.text, by_name = excluded.by_name, updated_at = excluded.updated_at`)
      .bind(ctx.group.id, ymd, text, ctx.actor.name, ctx.now.toISOString())
      .run();
  } else {
    await ctx.db.prepare('DELETE FROM day_notes WHERE group_id = ? AND date = ?').bind(ctx.group.id, ymd).run();
  }
  return { ok: true, ymd, message: fmtDateJa(ymd) + ' のメモを' + (text ? '保存しました。' : '消しました。') };
}
