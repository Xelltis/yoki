// メンバーの追加・変更・削除と、管理者の付け外し（GAS 版 Members.js・Auth.js の removeAdmin）。
// ログインした人は、グループに初めて入ったときに自動でメンバーになる（auth/guard.ts）。ここは管理者が手で直すとき
import { AppError, badRequest, notFound } from '../lib/errors';
import { NAME_SEPARATORS, RESERVED_NAMES } from '../lib/text';
import { type Form, str } from './form';
import type { Ctx } from './types';

/** メンバーを追加・更新する。form: { name, discordId, note, oldName }。管理者のほかは、自分の名前と備考だけ直せる */
export async function saveMember(ctx: Ctx, form: Form) {
  const name = str(form.name);
  if (!name) throw badRequest('名前を入れてください。');
  if (NAME_SEPARATORS.test(name)) throw badRequest('名前に区切り文字（、 , ; /）は使えません。');
  if (RESERVED_NAMES.includes(name)) throw badRequest('その名前は使えません: ' + name);
  const oldName = str(form.oldName);
  const target = oldName ? ctx.memberByName.get(oldName) : undefined;
  if (oldName && !target) throw notFound('編集対象が見つかりません: ' + oldName);
  if (!ctx.actor.isAdmin && target?.id !== ctx.actor.memberId) throw new AppError(403, 'ADMIN: メンバーの追加や、ほかの人の変更ができるのは管理者だけです。');
  const clash = ctx.memberByName.get(name);
  if (clash && clash.id !== target?.id) throw badRequest('同じ名前のメンバーがいます: ' + name);
  // ログインした人の Discord ID は、ログインから自動で入るので変えられない
  let discordId = str(form.discordId).replace(/[<@!>\s]/g, '');
  if (target?.userId) discordId = target.discordId;
  // 管理者のほかは、上で自分の行（target）だけに絞ってある
  else if (!ctx.actor.isAdmin) discordId = target!.discordId;
  if (discordId && !/^\d{5,}$/.test(discordId)) throw badRequest('Discord ユーザーID は数字だけです（例: 123456789012345678）。');
  const note = str(form.note);
  if (target) {
    await ctx.db.prepare('UPDATE members SET name = ?, discord_id = ?, note = ? WHERE id = ?').bind(name, discordId, note, target.id).run();
  } else {
    await ctx.db.prepare('INSERT INTO members (group_id, name, discord_id, note, created_at) VALUES (?, ?, ?, ?, ?)').bind(ctx.group.id, name, discordId, note, ctx.now.toISOString()).run();
  }
  return { ok: true, name, message: (target ? '更新しました: ' : '追加しました: ') + name };
}

/**
 * メンバーを消す。卓の GM・参加者・回答に残っている名前はそのまま（メンバーに無い人として残る）。予定とメモは消える。
 * Discord サーバーにいる人は、次に開いたときにまたメンバーになる（締め出すなら Discord サーバーから外す）
 */
export async function deleteMember(ctx: Ctx, form: Form) {
  const name = str(form.name);
  const m = ctx.memberByName.get(name);
  if (!m) throw notFound('見つかりません: ' + name);
  const db = ctx.db;
  await db.batch([
    db.prepare('UPDATE OR IGNORE session_people SET guest_name = ?1, member_id = NULL WHERE member_id = ?2').bind(m.name, m.id),
    db.prepare('UPDATE OR IGNORE poll_votes SET guest_name = ?1, member_id = NULL WHERE member_id = ?2').bind(m.name, m.id),
    db.prepare('DELETE FROM members WHERE id = ?').bind(m.id),
  ]);
  return { ok: true, message: '削除しました: ' + name };
}

/** 管理者にする・外す。form: { name, admin }。管理者が 1 人もいなくなる外し方はできない */
export async function setAdmin(ctx: Ctx, form: Form) {
  const name = str(form.name);
  const m = ctx.memberByName.get(name);
  if (!m) throw notFound('メンバーに「' + name + '」はいません。');
  const admin = !!form.admin;
  if (!admin && m.isAdmin && ctx.members.filter((x) => x.isAdmin).length <= 1) {
    throw badRequest('管理者が 1 人だけのときは外せません。先にもう 1 人足してください。');
  }
  await ctx.db.prepare('UPDATE members SET is_admin = ? WHERE id = ?').bind(admin ? 1 : 0, m.id).run();
  return { ok: true, message: admin ? '「' + name + '」を管理者にしました。' : '「' + name + '」を管理者から外しました。' };
}
