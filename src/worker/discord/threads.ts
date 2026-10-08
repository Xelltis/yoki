// 卓ごとのスレッド。グループの管理者が入れると（groups.threads）、卓の知らせを卓ごとのスレッドにまとめる。
// スレッドは、その卓の知らせがチャンネルに届いたとき、そのメッセージから作る（Botに「公開スレッドの作成」の権限が要る）。
// 次の知らせからは、スレッドへ送る。スレッドが消えた・入れない（404・403）ときは、控えを消してチャンネルへ送り直す。
// スレッドを使うのは、卓の知らせの最初の送り先だけ（シリーズのチャンネルと基本のチャンネルの両方に送るときの、基本のほうはチャンネルへ）。
// 開催前の知らせ（何卓かを1通にまとめる）は、チャンネルへ送る
import { DISCORD_API } from '../auth/oauth';
import type { Ctx, Session } from '../domain/types';
import { discordFetch } from './calls';
import type { Payload } from './payloads';
import { type Attempt, appendLog, type LogTo, postDiscordResult, type Sleep } from './send';
import { type Target, targetNote } from './targets';

/** スレッドの名前の長さ（Discordは100文字まで） */
const THREAD_NAME_MAX = 100;
/** スレッドが自動で閉じるまで（分。7日）。閉じても、次の知らせを書けば開く */
const ARCHIVE_MINUTES = 10080;

type ThreadCtx = Pick<Ctx, 'db' | 'group' | 'bot' | 'now'>;

/** 卓の知らせの送り先。スレッドを使うグループで、卓のスレッドがその送り先のチャンネルにあれば、スレッドへ */
export function threadTarget(ctx: Pick<Ctx, 'group'>, s: Pick<Session, 'threadId' | 'threadParent'>, t: Target): Target {
  return ctx.group.threads && s.threadId && s.threadParent === t.channelId ? { channelId: s.threadId, label: '卓のスレッド', series: t.series, thread: true } : t;
}

const logTo = (ctx: ThreadCtx): LogTo => ({ db: ctx.db, groupId: ctx.group.id, token: ctx.bot.token });

/** チャンネルに届いた卓の知らせから、卓のスレッドを作って控える。作れなければ記録する（知らせはチャンネルに届いている） */
export async function startThread(ctx: ThreadCtx, s: Session, channelId: string, messageId: string): Promise<void> {
  const res = await discordFetch(DISCORD_API + '/channels/' + channelId + '/messages/' + messageId + '/threads', {
    method: 'POST',
    headers: { Authorization: 'Bot ' + ctx.bot.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: s.name.slice(0, THREAD_NAME_MAX), auto_archive_duration: ARCHIVE_MINUTES }),
  });
  const id = res.ok ? String(((await res.json().catch(() => null)) as { id?: unknown } | null)?.id ?? '') : '';
  if (!id) {
    const why = res.status === 403 ? '（Botに「公開スレッドの作成」の権限がありません。管理画面の「知らせ」から招き直してください）' : '';
    await appendLog(logTo(ctx), 'スレッド', s.name, '作れませんでした: HTTP ' + res.status + why);
    return;
  }
  await ctx.db.prepare('UPDATE sessions SET thread_id = ?2, thread_parent = ?3 WHERE id = ?1').bind(s.rowId, id, channelId).run();
  s.threadId = id;
  s.threadParent = channelId;
}

/** スレッドの控えを消す（スレッドが消えた・入れないとき。次の知らせはチャンネルへ送り、スレッドを作り直す） */
export async function forgetThread(ctx: ThreadCtx, s: Session): Promise<void> {
  await ctx.db.prepare('UPDATE sessions SET thread_id = NULL, thread_parent = NULL WHERE id = ?').bind(s.rowId).run();
  s.threadId = null;
  s.threadParent = null;
}

/** スレッドへ送れなかったとき、チャンネルへ送り直すか（スレッドが消えた・入れない） */
export const threadGone = (t: Target, r: Attempt): boolean => !!t.thread && !r.ok && (r.code === 403 || r.code === 404);

/**
 * 卓の知らせを、送り先すべてへ送る（サーバーから。送り直しも含む）。最初の送り先はスレッドを使う。すべて届けばtrue。
 * チャンネルに届いたら（スレッドを使うグループなら）、そのメッセージからスレッドを作る
 */
export async function postSessionNotice(ctx: ThreadCtx, s: Session, payload: Payload, kind: string, targets: Target[], sleep: Sleep): Promise<boolean> {
  let all = targets.length > 0;
  for (const [i, base] of targets.entries()) {
    let t = i === 0 ? threadTarget(ctx, s, base) : base;
    let r = await postDiscordResult(logTo(ctx), payload, kind, s.name + targetNote(t), t.channelId, sleep);
    if (threadGone(t, r)) {
      await forgetThread(ctx, s);
      t = base;
      r = await postDiscordResult(logTo(ctx), payload, kind, s.name + targetNote(t), t.channelId, sleep);
    }
    if (r.ok && i === 0 && !t.thread && ctx.group.threads && r.messageId) await startThread(ctx, s, t.channelId, r.messageId);
    if (!r.ok) all = false;
  }
  return all;
}
