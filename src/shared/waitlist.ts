// キャンセル待ち。卓の参加希望（session_peopleのwant）は並んだ順に持ち、募集の卓では、定員までを参加希望、定員の外をキャンセル待ちとする。
// 参加希望の人が外れたり定員が増えたりすると、キャンセル待ちの前の人から、自動で参加希望に入る（繰り上がる）。
// 募集から「開催」「調整中」に移るときは、定員までの人が参加者に入り、キャンセル待ちの人はそのまま並んで残る（GMが「繰り上げる」で参加者にする）。
// 画面とサーバーの両方で使う

/** 卓の状態・参加希望の並び・定員（決めていなければnullか0） */
type WaitSession = { status: string; want: string[]; capacity: number | null };

/** 参加希望の並びを、参加希望（定員の中）とキャンセル待ち（定員の外。並んだ順）に分ける。募集でない卓に残る参加希望は、みなキャンセル待ち */
export function splitWant(s: WaitSession): { want: string[]; wait: string[] } {
  if (s.status !== '募集') return { want: [], wait: s.want.slice() };
  if (!s.capacity) return { want: s.want.slice(), wait: [] };
  return { want: s.want.slice(0, s.capacity), wait: s.want.slice(s.capacity) };
}

/** 変える前と後で、キャンセル待ちから参加希望に入った人（繰り上がった人） */
export function promotedBy(before: WaitSession, after: WaitSession): string[] {
  const was = splitWant(before).wait;
  return splitWant(after).want.filter((n) => was.includes(n));
}
