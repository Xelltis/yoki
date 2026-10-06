// ログインしている人と、入れるグループ（/api/me）。入口の画面と、グループの画面の上の帯（グループの切り替え）で同じ控えを使う
import type { MeResponse } from '../../shared/api';

/** React Queryの鍵 */
export const ME_KEY = ['me'] as const;

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('読み込めませんでした。');
  return (await res.json()) as MeResponse;
}
