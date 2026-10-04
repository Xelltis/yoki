// サーバーの呼び出し（POST /api/g/:id/:fn）。失敗は RpcError で投げる
import type { RpcName } from '../../../../shared/api';

/**
 * 失敗の種類。auth はログインが切れた（ログインし直す）、gone はグループが消された、
 * fail はサーバーが断った（ADMIN: の頭は外して文だけにする）、timeout は返事が無い、network は通信できない
 */
export type RpcKind = 'auth' | 'gone' | 'fail' | 'timeout' | 'network';

export class RpcError extends Error {
  constructor(readonly kind: RpcKind, message: string) {
    super(message);
    this.name = 'RpcError';
  }
}

/** サーバーの返事を待つ上限（ミリ秒）。返事が無いまま押せなくしたボタンが戻らない、を防ぐ */
const API_WAIT = 45000;

export type Rpc = <R>(groupId: string, name: RpcName, form?: object, signal?: AbortSignal) => Promise<R>;

/**
 * サーバーを呼ぶ。返事の型 R は、読み込み（getConsoleData）なら ConsoleData、Discord への送信なら DiscordStepResult、ほかは RpcResult。
 * signal で取り消すと、AbortError をそのまま投げる（呼んだ側が取り消したことを分かるように）
 */
export const rpc: Rpc = async <R,>(groupId: string, name: RpcName, form: object = {}, signal?: AbortSignal): Promise<R> => {
  const timeout = AbortSignal.timeout(API_WAIT);
  let res: Response, body: Record<string, unknown>;
  try {
    res = await fetch('/api/g/' + encodeURIComponent(groupId) + '/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), credentials: 'same-origin',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (timeout.aborted) throw new RpcError('timeout', 'サーバーから返事がありません。通信を確かめて、もう一度お試しください。');
    throw new RpcError('network', '通信できませんでした。通信を確かめて、もう一度お試しください。');
  }
  if (res.ok) {
    try { sessionStorage.removeItem('taku.relogin'); } catch { /* 使えない端末 */ }
    return body as R;
  }
  const msg = String(body.error || 'うまくいきませんでした。');
  if (msg.startsWith('AUTH:')) throw new RpcError('auth', msg.replace(/^AUTH:\s*/, ''));
  if (msg.startsWith('GONE:')) throw new RpcError('gone', msg.replace(/^GONE:\s*/, ''));
  throw new RpcError('fail', msg.replace(/^ADMIN:\s*/, ''));
};
