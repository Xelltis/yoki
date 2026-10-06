// 運営者の管理画面の読み書き。/api/admin/*（サーバーが運営者かを確かめる）。形は src/shared/admin.ts。
// データは TanStack Query の ['admin', …] に置く。読み直すのは、変えたあとと「更新」のときだけ
import { keepPreviousData, type QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AdminResult } from '../../../shared/admin';
import { toast } from '../../ui/toast';

/** サーバーを呼ぶ。ログインが切れていたらログインし直して戻る。失敗は Error（message はサーバーの文） */
export async function adminCall<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.ok) return data;
  const msg = String(data.error || 'うまくいきませんでした。');
  if (msg.startsWith('AUTH:')) location.href = '/auth/login?return_to=' + encodeURIComponent(location.pathname);
  throw new Error(msg.replace(/^AUTH:\s*/, ''));
}

/** 読むもの（キーと道）。外枠が開いたときに、全部を先に読んでおく */
export const ADMIN_READS = {
  overview: { queryKey: ['admin', 'overview'], path: '/api/admin/overview' },
  groups: { queryKey: ['admin', 'groups'], path: '/api/admin/groups' },
  users: { queryKey: ['admin', 'users'], path: '/api/admin/users' },
  legal: { queryKey: ['admin', 'legal'], path: '/api/admin/legal' },
  update: { queryKey: ['admin', 'update'], path: '/api/admin/update' },
} as const;

export function adminQuery<T>(queryKey: QueryKey, path: string) {
  return { queryKey, queryFn: () => adminCall<T>(path), staleTime: Infinity };
}

/** 読む。読めなければ吹き出しに出す */
export function useAdmin<T>(queryKey: QueryKey, path: string, opts: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  const q = useQuery({ ...adminQuery<T>(queryKey, path), enabled: opts.enabled ?? true, placeholderData: opts.keepPrevious ? keepPreviousData : undefined });
  useEffect(() => { if (q.error) toast(q.error.message); }, [q.error]);
  return q;
}

/**
 * 変える操作。結果を吹き出しに出し、読み直す。うまくいったら true。
 * before は読み直す前にすること（消したグループを閉じるなど）。skip で始まるキーは読み直さない（消えたものを読みにいかない）
 */
export function useAct() {
  const qc = useQueryClient();
  return async (path: string, body: unknown, opts: { before?: () => Promise<unknown> | void; skip?: QueryKey } = {}): Promise<boolean> => {
    try {
      const r = await adminCall<AdminResult>(path, body);
      toast(r.message);
      if (opts.before) await opts.before();
      const skip = opts.skip;
      await qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => !skip || !skip.every((k, i) => q.queryKey[i] === k) });
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  };
}
