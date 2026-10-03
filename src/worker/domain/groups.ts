// グループそのものを消す（運営者と、そのグループの管理者）。中身（メンバー・卓・予定・メモ・回答・送信の記録）は、表の決まり（ON DELETE CASCADE）で一緒に消える
import { badRequest, notFound } from '../lib/errors';
import { type Form, str } from './form';
import type { Ctx } from './types';

/** グループを消す。confirm がグループの名前と同じでなければ消さない（打ち間違いで消さないように） */
export async function deleteGroupById(db: D1Database, id: string, confirm: string): Promise<{ title: string }> {
  const g = await db.prepare('SELECT title FROM groups WHERE id = ?').bind(id).first<{ title: string }>();
  if (!g) throw notFound('グループが見つかりません。');
  if (confirm.trim() !== g.title) throw badRequest('確かめのために、グループの名前「' + g.title + '」をそのまま入れてください。');
  await db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  return { title: g.title };
}

/**
 * グループの管理者が、自分のグループを消す（画面からの呼び出し deleteGroup）。form: { confirm }。
 * 消したあとは画面のデータを読めないので、返事に data は付けない（routes/rpc.ts の一覧でも data を付けない）
 */
export async function deleteGroup(ctx: Ctx, form: Form) {
  const { title } = await deleteGroupById(ctx.db, ctx.group.id, str(form.confirm));
  console.log(JSON.stringify({ audit: 'group-admin', action: 'deleteGroup', by: ctx.actor.userId, group: ctx.group.id, title }));
  return { ok: true, message: 'グループ「' + title + '」を消しました。' };
}
