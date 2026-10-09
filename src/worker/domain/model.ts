// 読み込んだデータから計算するだけの小道具（GAS版Model.js・Polls.jsの一部）。DBには触らない
import { badRequest, notFound } from '../lib/errors';
import { fmtDateJa, fmtYmdSlash, parseYmd } from '../lib/jst';
import { uniq } from '../lib/text';
import { DATED, STATUS } from './constants';
import { gmsOf } from '../../shared/gm';
import { type BookedParts, bookedPartsOf } from '../../shared/parts';
import type { Ctx, Member, Session } from './types';

/** GM（共同GMも）と参加者（GAS版peopleOf_） */
export function peopleOf(s: Pick<Session, 'gm' | 'coGms' | 'members'>): string[] {
  return uniq(gmsOf(s).concat(s.members));
}

export function findSession(ctx: Ctx, id: unknown): Session {
  const s = ctx.sessions.find((x) => x.id === String(id ?? ''));
  if (!s) throw notFound('その卓が見つかりません: ' + String(id ?? ''));
  return s;
}

export type WindowInfo = { from: string; to: string; text: string; label: string };

/** 期間（順が逆なら直す）。textは '2026/10/03〜2026/10/17'、labelは '10/3（土）〜10/17（土）'（GAS版windowOf_） */
export function windowInfo(from: string | null, to: string | null): WindowInfo | null {
  if (!from || !to) return null;
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { from: a, to: b, text: fmtYmdSlash(a) + '〜' + fmtYmdSlash(b), label: fmtDateJa(a) + '〜' + fmtDateJa(b) };
}

/** フォームの期間を読む。両方空ならnull、片方だけや読めない日付は弾く（GAS版windowTextOf_） */
export function readWindow(from: unknown, to: unknown): WindowInfo | null {
  const a = String(from ?? '').trim(), b = String(to ?? '').trim();
  if (!a && !b) return null;
  if (!a || !b) throw badRequest('期間は、始まりと終わりの両方の日を入れてください。');
  const da = parseYmd(a), db = parseYmd(b);
  if (!da || !db) throw badRequest('期間の日付が読めません: ' + a + '〜' + b);
  return windowInfo(da, db);
}

/**
 * 「開催」の卓に入っている人{ 'YYYY-MM-DD': { 名前: '参' | 'GM' | '他' } }（GAS版bookedMap_）。
 * membersを渡すと、ほかのグループの卓（Member.other）の日に「他」を付ける（このグループの卓がある日は、そちらを出す）
 */
export function bookedMap(sessions: Session[], members: Pick<Member, 'name' | 'other'>[] = []): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sessions) {
    if (!DATED.includes(s.status) || !s.date) continue;
    const day = (out[s.date] ??= {});
    for (const n of gmsOf(s)) day[n] = 'GM';
    for (const n of s.members) if (day[n] !== 'GM') day[n] = '参';
  }
  for (const m of members) for (const o of m.other) (out[o.date] ??= {})[m.name] ??= '他';
  return out;
}

/** 卓に入っている時間帯{ 'YYYY-MM-DD': { 名前: '昼' | '夜' | '' } }（時間帯は開始時刻で決める。'' は終日）。membersを渡すと、ほかのグループの卓も入れる */
export function bookedPartsMap(sessions: Session[], members: Pick<Member, 'name' | 'other'>[]): BookedParts {
  return bookedPartsOf([
    ...sessions.filter((s) => DATED.includes(s.status) && s.date).map((s) => ({ date: s.date!, start: s.start, names: peopleOf(s) })),
    ...members.flatMap((m) => m.other.map((o) => ({ date: o.date, start: o.start, names: [m.name] }))),
  ]);
}

/**
 * 日程調整に答えられる人。GMと参加者のうち、ログインしたことがあるか、DiscordのIDが入っている（あとでログインできる）メンバー。
 * 回答は本人だけが入れるので、ゲストと、DiscordのIDの無いメンバーは答えられない。「全員そろった」はこの人たちで数える
 */
export function pollVoters(ctx: Pick<Ctx, 'memberByName'>, s: Pick<Session, 'gm' | 'coGms' | 'members'>): string[] {
  return peopleOf(s).filter((n) => {
    const m = ctx.memberByName.get(n);
    return !!m && (!!m.userId || !!m.discordId);
  });
}

/** まだ回答していない候補日がある人（答えられる人のうち。過ぎた候補日は数えない）（GAS版pollPending_） */
export function pollPending(ctx: Ctx, s: Session): string[] {
  const votes = ctx.votes.get(s.rowId) ?? {};
  const future = s.candidates.filter((k) => k >= ctx.today);
  return pollVoters(ctx, s).filter((n) => future.some((k) => !votes[k]?.[n]));
}

/** 全員が、これからの候補日すべてに答えたか（GAS版pollComplete_） */
export function pollComplete(ctx: Ctx, s: Session): boolean {
  return pollVoters(ctx, s).length > 0 && s.candidates.some((k) => k >= ctx.today) && pollPending(ctx, s).length === 0;
}

/** 日程調整中の卓を探す（GAS版findAdjusting_） */
export function findAdjusting(ctx: Ctx, id: unknown): Session {
  const s = findSession(ctx, id);
  if (s.status !== STATUS.ADJUSTING) throw badRequest('「' + s.name + '」は日程調整中ではありません（' + s.status + '）。');
  return s;
}
