// 知らせの決まり（送り先があるか・開催前の知らせの日時）。画面のデータ D から読むだけ
import type { ConsoleSession, SeriesNotifyView } from '../../shared/api';
import { addDaysYmd, fmtJa } from './dates';
import { D } from './state';

/** シリーズごとの通知の設定（無ければ null） */
export function snEntry(name: string): SeriesNotifyView | null { return (D.seriesNotify || []).filter((x) => x.series === name)[0] || null; }
/** そのシリーズに専用の送り先（Webhook）があるか */
export function seriesHook(name: string | undefined): boolean { const e = name ? snEntry(name) : null; return !!(e && e.hasWebhook); }
/** 種類ごとのチャンネル（'remind' 開催前の知らせ・'recruit' 募集）が決めてあるか */
export function kindSet(kind: string): boolean { return kind === 'recruit' ? !!D.recruitWebhookSet : kind === 'remind' ? !!D.remindWebhookSet : false; }
/** その卓の知らせに送り先があるか。基本の URL・種類ごとのチャンネル・シリーズ専用の URL のどれか */
export function hookFor(series: string | undefined, kind?: string): boolean { return !!D.webhookSet || kindSet(kind || '') || seriesHook(series); }
/** 卓の知らせの種類。状態が「募集」の卓は募集 */
export function kindOf(s: ConsoleSession | null): string { return s && s.status === '募集' ? 'recruit' : ''; }

export function baseHour(): number { const st = D.settings; return st.notifyHour === undefined ? 20 : st.notifyHour; }
export function baseDays(): number { const st = D.settings; return st.notifyDays === undefined ? 1 : st.notifyDays; }
/** 「前日の 20 時台」「3 日前の 9 時台」「当日の 12 時台」 */
export function whenText(d: number, h: number): string { return (d === 0 ? '当日' : d === 1 ? '前日' : d + ' 日前') + 'の ' + h + ' 時台'; }
export function hasVal<T>(v: T | null | undefined): v is T { return v !== null && v !== undefined; }
/** 卓ごとの開催前の知らせ（何日前）と時刻。シリーズに値があればそれ、無ければ基本 */
export function notifyDaysFor(s: ConsoleSession): number { const e = s.series ? snEntry(s.series) : null; return e && hasVal(e.days) ? e.days : baseDays(); }
export function notifyHourFor(s: ConsoleSession): number { const e = s.series ? snEntry(s.series) : null; return e && hasVal(e.hour) ? e.hour : baseHour(); }
/** 開催前の知らせの状態。送信済み／この日時に送る／送る日を過ぎた未送信／自動通知が未設定 */
export function notifyState(s: ConsoleSession): string {
  if (s.notified) return '開催前の知らせ 送信済み';
  if (!D.notifySetter) return '開催前の知らせ 未設定';
  const k = s.date ? addDaysYmd(s.date, -notifyDaysFor(s)) : '';
  return k && k >= D.today ? '開催前の知らせ ' + fmtJa(k) + ' ' + notifyHourFor(s) + ' 時台に送る' : '開催前の知らせ 未送信';
}
