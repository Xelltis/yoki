// カレンダーとの連携の共通の部分: 卓をカレンダーの 1 件にする、載せる卓を選ぶ、購読 URL（人とグループごと）を作る・作り直す・止める
import { buildCalendar, type IcsEvent, type Span, sessionSpan } from '../lib/ics';
import { randomToken } from '../lib/ids';
import { addDays } from '../lib/jst';
import { STATUS, type Status } from './constants';
import { type Form, str } from './form';
import type { Ctx, FeedScope, Session } from './types';

/** カレンダーに載せる卓の状態（開催日が決まった卓）。中止・募集・調整中は載せない */
export const CALENDAR_STATUSES: Status[] = [STATUS.HELD, STATUS.DONE];
/** 購読 URL に載せる、過ぎた卓の日数 */
export const FEED_PAST_DAYS = 180;

export const FEED_SCOPE_LABEL: Record<FeedScope, string> = { mine: '自分が入る卓だけ', all: 'グループの卓すべて' };

/** カレンダーの 1 件 */
export type CalendarItem = { span: Span; summary: string; location: string; description: string; url: string; updated: string };

/** 卓をカレンダーの 1 件にする。説明には GM・参加者・メモと、グループの画面の URL を入れる */
export function calendarItem(ctx: Pick<Ctx, 'appUrl' | 'group'>, s: Session & { date: string }): CalendarItem {
  const lines: string[] = [];
  if (s.gm) lines.push('GM: ' + s.gm);
  if (s.members.length) lines.push('参加: ' + s.members.join('、'));
  if (s.memo) lines.push('', s.memo);
  lines.push('', ctx.group.title + '（卓予定）: ' + ctx.appUrl);
  return {
    span: sessionSpan(s.date, s.start, s.end),
    summary: s.name,
    location: s.place,
    description: lines.join('\n').trim(),
    url: ctx.appUrl,
    updated: s.updatedAt,
  };
}

/** 載せる卓。who が空ならグループの卓すべて、名前ならその人が GM か参加者として入っている卓。過ぎた卓は sinceDays 日前まで */
export function calendarSessions(ctx: Pick<Ctx, 'sessions' | 'today'>, who: string, sinceDays = FEED_PAST_DAYS): (Session & { date: string })[] {
  const since = addDays(ctx.today, -sinceDays);
  return ctx.sessions.filter(
    (s): s is Session & { date: string } =>
      CALENDAR_STATUSES.includes(s.status) && !!s.date && s.date >= since && (!who || s.gm === who || s.members.includes(who)),
  );
}

/** 購読 URL の中身（iCalendar）。who は mine のときの本人の名前 */
export function feedText(ctx: Ctx, scope: FeedScope, who: string): string {
  const events: IcsEvent[] = calendarSessions(ctx, scope === 'mine' ? who : '').map((s) => ({
    uid: ctx.group.id + '-' + s.rowId + '@yoki',
    ...calendarItem(ctx, s),
  }));
  const name = ctx.group.title + (scope === 'mine' ? '（自分の卓）' : '（卓予定）');
  return buildCalendar(name, events, ctx.now);
}

/** 購読 URL を作る・載せる卓を変える・作り直す。form: { scope: 'mine' | 'all', renew: true なら URL を変える（前の URL は読めなくなる） } */
export async function saveCalendarFeed(ctx: Ctx, form: Form) {
  const scope: FeedScope = str(form.scope) === 'all' ? 'all' : 'mine';
  const userId = ctx.actor.userId;
  if (ctx.feed && !form.renew) {
    await ctx.db.prepare('UPDATE calendar_feeds SET scope = ? WHERE group_id = ? AND user_id = ?').bind(scope, ctx.group.id, userId).run();
    return { ok: true, message: '購読 URL に載せる卓を「' + FEED_SCOPE_LABEL[scope] + '」にしました。' };
  }
  await ctx.db
    .prepare(
      `INSERT INTO calendar_feeds (token, group_id, user_id, scope, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (group_id, user_id) DO UPDATE SET token = excluded.token, scope = excluded.scope, created_at = excluded.created_at, fetched_at = NULL`,
    )
    .bind(randomToken(), ctx.group.id, userId, scope, ctx.now.toISOString())
    .run();
  return { ok: true, message: ctx.feed ? '購読 URL を作り直しました。前の URL は、もう読めません。' : '購読 URL を作りました。' };
}

/** 購読 URL を止める（URL は読めなくなる） */
export async function deleteCalendarFeed(ctx: Ctx) {
  await ctx.db.prepare('DELETE FROM calendar_feeds WHERE group_id = ? AND user_id = ?').bind(ctx.group.id, ctx.actor.userId).run();
  return { ok: true, message: '購読 URL を止めました。この URL は、もう読めません。' };
}
