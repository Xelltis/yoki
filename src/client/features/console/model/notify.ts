// 知らせの決まり（送り先があるか・開催前の知らせの日時）。画面のデータdを受け取って読むだけ
import type { ConsoleData, ConsoleSession, SeriesNotifyView } from '../../../../shared/api';
import { addDaysYmd, fmtJa } from './dates';

/** シリーズごとの通知の設定（無ければnull） */
export function snEntry(d: ConsoleData, name: string): SeriesNotifyView | null { return (d.seriesNotify || []).filter((x) => x.series === name)[0] || null; }
/** そのシリーズに専用のチャンネルがあるか */
export function seriesHook(d: ConsoleData, name: string | undefined): boolean { const e = name ? snEntry(d, name) : null; return !!(e && e.channelId); }
/** 種類ごとのチャンネル（'remind' 開催前の知らせ・'recruit' 募集）が決めてあるか */
export function kindSet(d: ConsoleData, kind: string): boolean { return kind === 'recruit' ? !!d.recruitChannelSet : kind === 'remind' ? !!d.remindChannelSet : false; }
/** その卓の知らせに送り先があるか。基本のチャンネル・種類ごとのチャンネル・シリーズ専用のチャンネルのどれか */
export function hookFor(d: ConsoleData, series: string | undefined, kind?: string): boolean { return !!d.channelSet || kindSet(d, kind || '') || seriesHook(d, series); }
/** 卓の知らせの種類。状態が「募集」の卓は募集 */
export function kindOf(s: ConsoleSession | null): string { return s && s.status === '募集' ? 'recruit' : ''; }

export function baseHour(d: ConsoleData): number { const st = d.settings; return st.notifyHour === undefined ? 20 : st.notifyHour; }
export function baseDays(d: ConsoleData): number { const st = d.settings; return st.notifyDays === undefined ? 1 : st.notifyDays; }
/** 「前日の20時台」「3日前の9時台」「当日の12時台」 */
export function whenText(days: number, h: number): string { return (days === 0 ? '当日' : days === 1 ? '前日' : days + '日前') + 'の' + h + '時台'; }
export function hasVal<T>(v: T | null | undefined): v is T { return v !== null && v !== undefined; }
/** 卓ごとの開催前の知らせ（何日前）と時刻。シリーズに値があればそれ、無ければ基本 */
export function notifyDaysFor(d: ConsoleData, s: ConsoleSession): number { const e = s.series ? snEntry(d, s.series) : null; return e && hasVal(e.days) ? e.days : baseDays(d); }
export function notifyHourFor(d: ConsoleData, s: ConsoleSession): number { const e = s.series ? snEntry(d, s.series) : null; return e && hasVal(e.hour) ? e.hour : baseHour(d); }
/** 開催前の知らせの状態。送信済み／この日時に送る／送る日を過ぎた未送信／自動通知が未設定 */
export function notifyState(d: ConsoleData, s: ConsoleSession): string {
  if (s.notified) return '開催前の知らせは送りました';
  if (!d.notifySetter) return '開催前の知らせは未設定';
  const k = s.date ? addDaysYmd(s.date, -notifyDaysFor(d, s)) : '';
  return k && k >= d.today ? '開催前の知らせは' + fmtJa(k) + notifyHourFor(d, s) + '時台に送る' : '開催前の知らせは未送信';
}
/** 「何日前」と「何時台」の欄を読む。dOk・hOkはそれぞれの欄が正しいか、errは正しくないときの理由 */
export function readWhen(dv: string, hv: string): { days: number; hour: number; dOk: boolean; hOk: boolean; err: string } {
  const ds = dv.trim(), hs = hv.trim(), days = +ds, hour = +hs;
  const dOk = /^\d{1,2}$/.test(ds) && days <= 30, hOk = /^\d{1,2}$/.test(hs) && hour <= 23;
  const err = !dOk ? '何日前かは0〜30の数で入れてください（0は当日、1は前日）。' : !hOk ? '時刻は0〜23の数で入れてください。' : '';
  return { days, hour, dOk, hOk, err };
}
