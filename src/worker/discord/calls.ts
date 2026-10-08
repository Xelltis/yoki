// Discordへの呼び出しの数え方。Workersの1回の要求で外へ出せる数（無料のプランで50）を、Discordとの通信とGoogleとの同期で分け合うため、
// Discordへの呼び出しは、どれもここを通して数える（見回りが、Googleに使える残りを決める。google/sync.tsのgoogleBudget）

/** Discordへ呼び出した回数（この入れ物が動き始めてから） */
let calls = 0;
export const discordCalls = (): number => calls;

/** Discordを呼ぶ（数えてからfetchする） */
export function discordFetch(input: string, init?: RequestInit): Promise<Response> {
  calls++;
  return fetch(input, init);
}
