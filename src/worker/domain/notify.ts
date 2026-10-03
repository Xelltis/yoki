// 開催前の知らせの日時（GAS 版 Notify.js の一部）。シリーズに値があればそれ、無ければ基本の値
import { addDays } from '../lib/jst';
import type { Ctx, Session } from './types';

export function notifyDaysOf(ctx: Pick<Ctx, 'group' | 'seriesNotify'>, s: Session): number {
  const sn = s.series ? ctx.seriesNotify[s.series] : undefined;
  return sn && sn.days !== null ? sn.days : ctx.group.notify_days;
}

export function notifyHourOf(ctx: Pick<Ctx, 'group' | 'seriesNotify'>, s: Session): number {
  const sn = s.series ? ctx.seriesNotify[s.series] : undefined;
  return sn && sn.hour !== null ? sn.hour : ctx.group.notify_hour;
}

/** 開催前の知らせを送る日。開催日の無い卓は '' */
export function notifyYmdOf(ctx: Pick<Ctx, 'group' | 'seriesNotify'>, s: Session): string {
  return s.date ? addDays(s.date, -notifyDaysOf(ctx, s)) : '';
}

/** 「前日の 20 時台」「3 日前の 9 時台」「当日の 12 時台」 */
export function notifyWhenText(days: number, hour: number): string {
  return (days === 0 ? '当日' : days === 1 ? '前日' : days + ' 日前') + 'の ' + hour + ' 時台';
}

/** 開催前の知らせの見出し。開催日まで何日あるかで言い分ける */
export function aheadText(n: number): string {
  return n <= 0 ? '今日' : n === 1 ? '明日' : n === 2 ? 'あさって' : n + ' 日後';
}
