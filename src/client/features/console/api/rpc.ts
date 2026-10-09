// サーバーの呼び出し（POST /api/g/:id/:fn）。失敗はRpcErrorで投げる
import type { RpcName } from '../../../../shared/api';

/**
 * 失敗の種類。authはログインが切れた（ログインし直す）、goneはグループが消された、
 * failはサーバーが断った（ADMIN: の頭は外して文だけにする）、timeoutは返事が無い、networkは通信できない
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
 * サーバーを呼ぶ。返事の型Rは、読み込み（getConsoleData）ならConsoleData、Discordへの送信ならDiscordStepResult、ほかはRpcResult。
 * signalで取り消すと、AbortErrorをそのまま投げる（呼んだ側が取り消したことを分かるように）
 */
export const rpc: Rpc = async <R,>(groupId: string, name: RpcName, form: object = {}, signal?: AbortSignal): Promise<R> => {
  const timeout = AbortSignal.timeout(API_WAIT);
  let res: Response, body: Record<string, unknown> | null;
  try {
    res = await fetch('/api/g/' + encodeURIComponent(groupId) + '/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), credentials: 'same-origin',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // 本文を読む途中で取り消されたら、下のcatchで取り消しとして投げる（読めなかった本文を、空の返事にしない。
    // 開いた直後の読み込みを書き込みが取り消したとき、空の返事を画面のデータにして落ちていた）
    body = (await res.json().catch((e: unknown) => { if (signal?.aborted || timeout.aborted) throw e; return null; })) as Record<string, unknown> | null;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (timeout.aborted) throw new RpcError('timeout', 'サーバーから返事がありません。通信を確かめて、もう一度お試しください。');
    throw new RpcError('network', '通信できませんでした。通信を確かめて、もう一度お試しください。');
  }
  if (res.ok) {
    // うまくいったのに本文が読めない（途中の機器が別のページを返したなど）。空の返事を、読み込んだデータや書き込みの結果にしない
    if (!body) throw new RpcError('network', 'サーバーの返事を読めませんでした。通信を確かめて、もう一度お試しください。');
    try { sessionStorage.removeItem('taku.relogin'); } catch { /* 使えない端末 */ }
    return body as R;
  }
  const msg = String(body?.error || 'うまくいきませんでした。');
  if (msg.startsWith('AUTH:')) throw new RpcError('auth', msg.replace(/^AUTH:\s*/, ''));
  if (msg.startsWith('GONE:')) throw new RpcError('gone', msg.replace(/^GONE:\s*/, ''));
  throw new RpcError('fail', msg.replace(/^ADMIN:\s*/, ''));
};
