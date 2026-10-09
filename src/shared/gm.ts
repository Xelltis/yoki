// 卓のGM。GM（1人）と共同GM（サブGM・KP補佐。CO_GM_MAX人まで）は、どちらも卓の関わる人の「GM」の行で持ち、並びの先頭がGM。
// 共同GMも、GMと同じことができる（秘匿HOを読み書きする・開催日を決める・記録を書く・キャンセル待ちを繰り上げるなど）。画面とサーバーの両方で使う

/** 共同GMの人数の上限 */
export const CO_GM_MAX = 3;

/** 卓のGMの顔ぶれ（GMが先、続けて共同GM）。GMがいなければ空 */
export function gmsOf(s: { gm: string; coGms: string[] }): string[] {
  return s.gm ? [s.gm, ...s.coGms.filter((n, i, a) => n && n !== s.gm && a.indexOf(n) === i)] : [];
}

/** その人が卓のGMか共同GMか */
export function isGm(s: { gm: string; coGms: string[] }, name: string): boolean {
  return !!name && gmsOf(s).includes(name);
}
