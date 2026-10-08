// 時間帯（昼・夜）。グループの管理者が「昼と夜に分ける」を入れたグループだけ、予定の印を昼と夜に分けて持つ。
// 画面とサーバーの両方で使う。分けていない日の印（終日の印）は、昼にも夜にも効く。卓は開始時刻で昼か夜に入り、時刻の無い卓は両方をふさぐ

export type Part = '昼' | '夜';
export const PARTS: Part[] = ['昼', '夜'];
/** 夜の始まり。開始時刻がこれより前の卓は昼、ここから後は夜 */
export const NIGHT_FROM = '17:00';

/** 時間帯ごとの印{ 日: { 名前: [昼, 夜] } }。分けて入れた日だけ。印の無い時間帯は空 */
export type AvailParts = Record<string, Record<string, [string, string]>>;
/** 卓に入っている時間帯{ 日: { 名前: '昼' | '夜' | '' } }。'' は終日（時刻の無い卓か、昼と夜の両方に卓がある） */
export type BookedParts = Record<string, Record<string, Part | ''>>;

/** 卓の時間帯。開始時刻で決める。時刻が無ければ ''（終日） */
export function partOf(start: string): Part | '' {
  return !start ? '' : start < NIGHT_FROM ? '昼' : '夜';
}

/** 昼と夜の印を、1日の印にまとめる。両方 × なら ×、どちらかに印があれば △、どちらも空なら空 */
export function combineMarks(day: string, night: string): string {
  return day === '×' && night === '×' ? '×' : day || night ? '△' : '';
}

/**
 * その時間帯の印。availは1日の印（分けて入れた日は、まとめた印）、partsは時間帯ごとの印。
 * partが '' なら1日の印。分けていない日は、1日の印がどの時間帯にも効く
 */
export function markAt(avail: Record<string, Record<string, string>>, parts: AvailParts, date: string, name: string, part: Part | ''): string {
  const p = parts[date]?.[name];
  if (!p || !part) return avail[date]?.[name] ?? '';
  return part === '昼' ? p[0] : p[1];
}

/** その時間帯に卓があるか。part が '' なら、どちらかに卓があるか */
export function bookedAt(booked: BookedParts, date: string, name: string, part: Part | ''): boolean {
  const v = booked[date]?.[name];
  return v !== undefined && (v === '' || !part || v === part);
}

/** 卓に入っている時間帯を集める。卓は { 日, 開始時刻, 入っている人 } で渡す */
export function bookedPartsOf(items: { date: string; start: string; names: string[] }[]): BookedParts {
  const out: BookedParts = {};
  for (const it of items) {
    const p = partOf(it.start), day = (out[it.date] ??= {});
    for (const n of it.names) day[n] = day[n] === undefined || day[n] === p ? p : '';
  }
  return out;
}
