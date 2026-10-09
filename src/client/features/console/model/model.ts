// 卓とメンバーの読み方（状態・人・日程調整・並び）。画面のデータdを受け取って読むだけで、書き換えない
import type { ConsoleData, ConsoleScenario, ConsoleSession } from '../../../../shared/api';
import { bookedAt, markAt, type Part, PARTS } from '../../../../shared/parts';
import type { IconName } from '../../../ui/icons';
import { addDaysYmd, fmtJa } from './dates';
import { gmsOf, isGm } from '../../../../shared/gm';
import { candDay, candLabel, candPart } from '../../../../shared/candidates';

/* 状態。募集 → 調整中 → 開催 → 終了、中止は別 */
export const STATUS_ACTIVE: string[] = ['募集', '調整中', '開催'];
export const STATUS_DATED: string[] = ['開催'];
/** この状態にすると、参加希望の人が参加者に入る */
export const STATUS_PROMOTE: string[] = ['調整中', '開催'];
export function isDated(s: ConsoleSession): boolean { return STATUS_DATED.indexOf(s.status) >= 0; }
export function isRecruit(s: ConsoleSession): boolean { return s.status === '募集'; }
export function isAdjusting(s: ConsoleSession): boolean { return s.status === '調整中'; }
export function isActive(s: ConsoleSession): boolean { return STATUS_ACTIVE.indexOf(s.status) >= 0; }
/** 卓の状態ごとのアイコン。カレンダーの札と凡例で使う */
export const STATUS_ICON: Record<string, IconName> = { '開催': 'event', '募集': 'campaign', '調整中': 'edit_calendar', '終了': 'task_alt', '中止': 'block' };

/** GM（共同GMも）と参加者（重ならないように） */
export function peopleOf(s: ConsoleSession): string[] {
  const out = gmsOf(s);
  s.members.forEach((n) => { if (out.indexOf(n) < 0) out.push(n); });
  return out;
}
/** 人の札の頭に付ける役（GM・共同GM。参加者なら空） */
export function roleLabel(s: ConsoleSession, name: string): string { return name === s.gm ? 'GM ' : isGm(s, name) ? '共同GM ' : ''; }
/** 都合を見る相手。GMと参加者に、募集中なら参加希望の人も加える */
export function candidatesOf(s: ConsoleSession): string[] {
  const out = peopleOf(s);
  if (isRecruit(s)) (s.want || []).forEach((n) => { if (out.indexOf(n) < 0) out.push(n); });
  return out;
}
export function active(d: ConsoleData): ConsoleSession[] { return d.sessions.filter(isActive); }
export function byId(d: ConsoleData, id: string | undefined): ConsoleSession | null { return d.sessions.filter((x) => x.id === id)[0] || null; }
export function sortSessions(list: ConsoleSession[]): ConsoleSession[] {
  return list.slice().sort((a, b) => {
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.date && !b.date) { const ka = a.windowKey || '9999', kb = b.windowKey || '9999'; if (ka !== kb) return ka < kb ? -1 : 1; }
    if (a.start !== b.start) return (a.start || '99') < (b.start || '99') ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
}
export function sortedActive(d: ConsoleData): ConsoleSession[] { return sortSessions(active(d)); }

/* 日程調整 */
export function hasPoll(s: ConsoleSession): boolean { return isAdjusting(s) && !!(s.candidates && s.candidates.length); }
/**
 * 日程調整に答えられる人。GMと参加者のうち、ログインしたことがあるか、DiscordのIDが入っているメンバー（サーバーのpollVotersと同じ）。
 * 回答は本人だけが入れるので、ゲストと、DiscordのIDの無いメンバーは答えられず、数えない
 */
export function pollVoters(d: ConsoleData, s: ConsoleSession): string[] {
  return peopleOf(s).filter((n) => d.members.some((m) => m.name === n && (m.linked || m.hasDiscord)));
}
/** その候補日に ◯ を付けた人 */
export function pollOk(d: ConsoleData, s: ConsoleSession, k: string): string[] { const v = (s.votes || {})[k] || {}; return pollVoters(d, s).filter((n) => v[n] === '◯'); }
/** その候補日に △（調整すれば行ける）を付けた人 */
export function pollMaybe(d: ConsoleData, s: ConsoleSession, k: string): string[] { const v = (s.votes || {})[k] || {}; return pollVoters(d, s).filter((n) => v[n] === '△'); }
/** 候補日の数の見出し。「◯ 2/3」、△ があれば △ の数も添える */
export function pollCount(d: ConsoleData, s: ConsoleSession, k: string): string {
  const maybe = pollMaybe(d, s, k).length;
  return '◯ ' + pollOk(d, s, k).length + '/' + pollVoters(d, s).length + (maybe ? '　△ ' + maybe : '');
}
/** その日の候補の数の見出し（カレンダーの日の内訳）。時間帯の付いた候補が並べば「昼 ◯ 2/3・夜 ◯ 1/3」 */
export function pollCountOn(d: ConsoleData, s: ConsoleSession, day: string): string {
  return s.candidates.filter((k) => candDay(k) === day).map((k) => (candPart(k) ? candPart(k) + ' ' : '') + pollCount(d, s, k)).join('・');
}
/** 候補の書き方（10/12（月）、時間帯があれば10/12（月）の夜） */
export const candText = (k: string): string => candLabel(k, fmtJa);
/**
 * 予定表の印から決める回答（サーバーと同じ決まり）。卓のある日と × は ×、△ は △、空欄は ◯。
 * 昼と夜に分けるグループでは、卓の開始時刻の時間帯で見る（partはその時間帯。分けないなら ''）
 */
export function voteFromAvail(d: ConsoleData, name: string, day: string, part: Part | ''): string {
  if (bookedOn(d, day, name, part)) return '×';
  const m = markOn(d, day, name, part);
  return m === '×' || m === '△' ? m : '◯';
}
/** 予定表から答えられる候補日（これからの、予定表の範囲の日で、まだ答えていない日） */
export function pollFillDays(d: ConsoleData, s: ConsoleSession, name: string): string[] {
  const v = s.votes || {};
  return (s.candidates || []).filter((k) => k >= d.today && d.availDays.indexOf(candDay(k)) >= 0 && !(v[k] && v[k][name]));
}
/** これからの候補日に、まだ答えていない日がある人 */
export function pollPending(d: ConsoleData, s: ConsoleSession): string[] {
  const vs = s.votes || {}, fut = (s.candidates || []).filter((k) => k >= d.today);
  return pollVoters(d, s).filter((n) => fut.some((k) => !(vs[k] && vs[k][n])));
}
/** あなたの番の日程調整か（まだ答えていない候補日がある・全員が答えて、GMのあなたが開催日を選ぶ） */
export function isMyTurn(d: ConsoleData, s: ConsoleSession): boolean {
  const who = me(d);
  if (!who || !hasPoll(s)) return false;
  const pend = pollPending(d, s);
  return pend.indexOf(who) >= 0 || (!pend.length && isGm(s, who));
}
/** あなたの番の日程調整（「募集・調整」のタブの印の数） */
export function myTurns(d: ConsoleData): ConsoleSession[] { return active(d).filter((s) => isMyTurn(d, s)); }
/** 調整中の卓を日ごとに。日程調整中なら候補日、そうでなければ候補の期間。カレンダーと都合表の印に使う */
export function windowByDay(d: ConsoleData): Record<string, ConsoleSession[]> {
  const out: Record<string, ConsoleSession[]> = {};
  d.sessions.forEach((s) => {
    if (!isAdjusting(s)) return;
    // 時間帯の付いた候補（10/12の昼と夜）は、その日に1つだけ
    if (hasPoll(s)) { s.candidates.forEach((k) => { const day = candDay(k), list = (out[day] = out[day] || []); if (list.indexOf(s) < 0) list.push(s); }); return; }
    if (!s.windowFrom || !s.windowTo) return;
    for (let day = s.windowFrom, i = 0; day <= s.windowTo && i < 120; day = addDaysYmd(day, 1), i++) (out[day] = out[day] || []).push(s);
  });
  return out;
}
/** 募集の卓の期間。「10/3（金）〜10/17（金） に開催予定」 */
export function periodOfSession(s: ConsoleSession): string { return s.windowLabel ? s.windowLabel + 'に開催予定' : '時期未定'; }
/**
 * 列の並び。sortByLoadなら、稼働中の卓に入っている人ほど左へ寄せる。
 * 卓の数（GMも参加も1件と数える）が多い順、同数ならGMの多い順、それも同じならメンバーの登録順
 */
export function memberOrder(d: ConsoleData, names: string[], sortByLoad: boolean): string[] {
  if (!sortByLoad) return names;
  const act = active(d), score: Record<string, { total: number; gm: number; i: number }> = {};
  names.forEach((n, i) => {
    let gm = 0, pl = 0;
    act.forEach((s) => { if (isGm(s, n)) gm++; else if (s.members.indexOf(n) >= 0) pl++; });
    score[n] = { total: gm + pl, gm, i };
  });
  return names.slice().sort((a, b) => {
    const x = score[a]!, y = score[b]!;
    if (x.total !== y.total) return y.total - x.total;
    if (x.gm !== y.gm) return y.gm - x.gm;
    return x.i - y.i;
  });
}

/** 「、」や改行で区切った名前 */
export function splitNames(v: string): string[] { return String(v || '').split(/[、,，;；\n/／]+/).map((x) => x.trim()).filter(Boolean); }

/* ---- 都合の判定 ---- */
/** 都合を見る相手。「全員」はメンバー全員、「（なし）」は誰も見ない。卓の名前なら、その卓の人 */
export function targetPeople(d: ConsoleData, target: string): string[] {
  if (target === '（なし）') return [];
  if (target === '全員') return d.members.map((m) => m.name);
  const s = active(d).filter((x) => x.name === target)[0];
  return s ? candidatesOf(s) : [];
}
/* ---- 時間帯（昼・夜） ---- */
/** 予定を見る時間帯。昼と夜に分けるグループは昼と夜、分けないグループは ''（1日）だけ */
export function dayParts(d: ConsoleData): (Part | '')[] { return d.settings.dayParts ? PARTS : ['']; }
/** その時間帯の印（分けないグループや、分けていない日は1日の印） */
export function markOn(d: ConsoleData, day: string, name: string, part: Part | ''): string { return markAt(d.avail, d.availParts || {}, day, name, part); }
/** その時間帯に卓があるか（'' なら、その日のどこかに卓があるか） */
export function bookedOn(d: ConsoleData, day: string, name: string, part: Part | ''): boolean { return bookedAt(d.bookedParts || {}, day, name, part); }

/** その日のその時間帯の都合。'ok' は全員空き、'soft' は △ の人がいる、'' は × か卓のある人がいる */
export function availAt(d: ConsoleData, people: string[], day: string, part: Part | ''): 'ok' | 'soft' | '' {
  let allOk = true;
  for (let i = 0; i < people.length; i++) {
    const n = people[i]!, v = markOn(d, day, n, part);
    if (v === '×' || bookedOn(d, day, n, part)) return '';
    if (v === '△') allOk = false;
  }
  return allOk ? 'ok' : 'soft';
}
/**
 * 日ごとの都合（予定表の範囲の日）。'ok' は全員空き、'soft' は △ の人がいる。× か卓のある人がいれば出さない。
 * だれも印を付けていない日も全員空き（予定表の「全員空き」と同じ）。昼と夜に分けるグループでは、よいほうの時間帯の都合で、
 * partsに全員空きの時間帯を入れる（昼だけ空いていれば ['昼']）
 */
export function availMap(d: ConsoleData, target: string): Record<string, { st: 'ok' | 'soft'; parts: Part[] }> {
  const out: Record<string, { st: 'ok' | 'soft'; parts: Part[] }> = {}, people = targetPeople(d, target);
  if (!people.length) return out;
  d.availDays.forEach((key) => {
    const at = dayParts(d).map((p) => [p, availAt(d, people, key, p)] as const);
    const okParts = at.filter(([, v]) => v === 'ok').map(([p]) => p).filter((p): p is Part => !!p);
    const st = at.some(([, v]) => v === 'ok') ? 'ok' : at.some(([, v]) => v === 'soft') ? 'soft' : '';
    if (st) out[key] = { st, parts: okParts };
  });
  return out;
}

/** 登録画面に出すシリーズの候補。終わったものは出さない（何年も溜まらないように）。
 * 最終日が入っていればその日まで。入っていなければ、いちばん新しい回から180日まで。日付未定の回があるあいだは残す */
export function seriesNames(d: ConsoleData): string[] {
  const seen: Record<string, boolean> = {}, out: string[] = [], limit = addDaysYmd(d.today, -180);
  sortSessions(d.sessions).reverse().forEach((s) => {
    if (!s.series || seen[s.series]) return;
    const rows = d.sessions.filter((x) => x.series === s.series);
    const end = rows.map((x) => x.seriesEnd || '').filter(Boolean).sort().pop() || '';
    const last = rows.map((x) => x.date || '').filter(Boolean).sort().pop() || '';
    const waiting = rows.some((x) => isActive(x) && !x.date);   // 募集・調整中の回があるうちは終わっていない
    if (end && end < d.today) return;
    if (!end && last && last < limit && !waiting) return;
    seen[s.series] = true;
    out.push(s.series);
  });
  return out;
}

/* ---- 日付のメモ ---- */
/** 日付のメモ1つ。fromは始まりの日、toは期間の終わり（1日だけなら空） */
export type DayNote = ConsoleData['notes'][string] & { from: string };
/** その日にかかる日付のメモ（その日に始まるメモと、前の日から続く期間のメモ）。始まりの日の順 */
export function notesOn(d: ConsoleData, day: string): DayNote[] {
  const notes = d.notes || {}, out: DayNote[] = [];
  Object.keys(notes).sort().forEach((from) => {
    const n = notes[from]!;
    if (from === day || (from < day && !!n.to && n.to >= day)) out.push({ ...n, from });
  });
  return out;
}

/* ---- あなた ---- */
/** 「あなた」（ログインした本人）。予定・参加希望・日程調整の回答は、本人のぶんだけ入れる */
export function me(d: ConsoleData): string { return d.me ? d.me.name : ''; }

/** 卓のシナリオ（付いていなければundefined） */
export function scenarioOf(d: ConsoleData, s: ConsoleSession): ConsoleScenario | undefined {
  return s.scenarioId ? d.scenarios.find((x) => x.id === s.scenarioId) : undefined;
}
