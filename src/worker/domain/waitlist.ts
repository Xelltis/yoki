// キャンセル待ち（並び方はsrc/shared/waitlist.ts）。繰り上がった人への知らせと、GMか管理者が開催・調整中の卓のキャンセル待ちの人を参加者にする「繰り上げる」
import { waitPromotedPayload } from '../discord/payloads';
import { postSessionNotice } from '../discord/threads';
import { sessionTargets } from '../discord/targets';
import { adminError, badRequest } from '../lib/errors';
import { STATUS } from './constants';
import { type Form, str } from './form';
import { historyStmt } from './history';
import { findSession } from './model';
import { peopleOfSession, replacePeople } from './people';
import { type Io, noticeNote } from './polls';
import type { Ctx, Session } from './types';
import type { Sleep } from '../discord/send';

/**
 * 繰り上がった人をDiscordで呼ぶ。sは変えたあとの卓（読み直さずに、変えた中身を当てたもの）。
 * true（届いた）/ false（届かなかった）/ null（送り先のチャンネルが無い）
 */
export async function noticeWaitPromoted(ctx: Ctx, s: Session, names: string[], auto: boolean, sleep: Sleep): Promise<boolean | null> {
  const targets = sessionTargets(ctx, s);
  if (!targets.length) return null;
  return postSessionNotice(ctx, s, waitPromotedPayload(ctx, s, names, auto), '繰り上げ', targets, sleep);
}

/**
 * 開催・調整中の卓のキャンセル待ちの人を、参加者にする（GMか管理者）。form: { id, name }
 * 募集の卓では、定員の中に空きが出れば自動で繰り上がるので使わない
 */
export async function promoteWaiter(ctx: Ctx, form: Form, io: Io) {
  const s = findSession(ctx, form.id);
  if (s.gm !== ctx.actor.name && !ctx.actor.isAdmin) throw adminError('GMのほかがキャンセル待ちの人を繰り上げること');
  if (s.status !== STATUS.HELD && s.status !== STATUS.ADJUSTING) throw badRequest('「' + s.name + '」は、開催・調整中の卓ではありません（' + s.status + '）。');
  const name = str(form.name);
  if (!s.want.includes(name)) throw badRequest(name + 'は「' + s.name + '」のキャンセル待ちにいません。');
  const after: Session = { ...s, members: s.members.concat(name), want: s.want.filter((n) => n !== name) };
  await ctx.db.batch([
    ...replacePeople(ctx, [{ rowId: s.rowId, people: peopleOfSession(after) }]),
    ctx.db.prepare('UPDATE sessions SET editor = ?2, updated_at = ?3 WHERE id = ?1').bind(s.rowId, ctx.actor.name, ctx.now.toISOString()),
    historyStmt(ctx, s.rowId, '繰り上げ', name + 'を参加者に'),
  ]);
  const notified = await noticeWaitPromoted(ctx, after, [name], false, io.sleep);
  return { ok: true, id: s.id, notified, message: '「' + s.name + '」のキャンセル待ちから、' + name + 'を参加者にしました。' + noticeNote(notified, '繰り上げの知らせ') };
}
