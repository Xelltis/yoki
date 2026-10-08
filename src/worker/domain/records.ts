// 卓の記録とPCの台帳。終わった卓（「終了」か、開催日の過ぎた「開催」）に、ログ（リプレイ）のURLと振り返り、参加者ごとのPCの名前と結果を残す。
// 記録を書けるのはGMと管理者、PCを書けるのはその卓の参加者本人（管理者も、ほかの人の代わりには書かない）
import { PREP_MAX, RECORD_MAX } from '../../shared/api';
import { adminError, badRequest } from '../lib/errors';
import { isHttpUrl } from '../lib/text';
import { STATUS } from './constants';
import { type Form, requireSelf, str } from './form';
import { historyStmt } from './history';
import { findSession } from './model';
import { isGmOf } from './prep';
import type { Ctx, Session } from './types';

/** 記録を書ける卓（終わった卓）。「終了」か、開催日が今日までの「開催」 */
function findDone(ctx: Ctx, id: unknown): Session {
  const s = findSession(ctx, id);
  if (!(s.status === STATUS.DONE || (s.status === STATUS.HELD && !!s.date && s.date <= ctx.today))) throw badRequest('「' + s.name + '」は、まだ終わっていない卓なので、記録は書けません。');
  return s;
}

/** 卓の記録を書く（GMか管理者）。form: { id, logUrl, recap } */
export async function saveRecord(ctx: Ctx, form: Form) {
  const s = findDone(ctx, form.id);
  if (!isGmOf(ctx, s) && !ctx.actor.isAdmin) throw adminError('GMのほかが卓の記録を書くこと');
  const logUrl = str(form.logUrl), recap = str(form.recap);
  if (logUrl.length > RECORD_MAX.url) throw badRequest('ログのURLは' + RECORD_MAX.url + '文字までです。');
  if (logUrl && !isHttpUrl(logUrl)) throw badRequest('ログのURLは、http:// か https:// で始まるアドレスを入れてください。');
  if (recap.length > RECORD_MAX.recap) throw badRequest('振り返りは' + RECORD_MAX.recap + '文字までです。');
  await ctx.db.batch([
    ctx.db.prepare('UPDATE sessions SET log_url = ?2, recap = ?3 WHERE id = ?1').bind(s.rowId, logUrl, recap),
    historyStmt(ctx, s.rowId, '記録', (logUrl ? 'ログ' : '') + (logUrl && recap ? '・' : '') + (recap ? '振り返り' : '') || '記録を消した'),
  ]);
  return { ok: true, id: s.id, message: '「' + s.name + '」の記録を保存しました。' };
}

/** 自分のPCの名前と結果を書く（その卓の参加者本人）。キャラシのURLはそのまま（出していなければ空）。form: { id, name, pc, outcome } */
export async function setPcRecord(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name);
  const s = findDone(ctx, form.id);
  if (!s.members.includes(name)) throw badRequest(name + 'は「' + s.name + '」の参加者ではありません。');
  const pc = str(form.pc), outcome = str(form.outcome);
  if (pc.length > PREP_MAX.pc) throw badRequest('キャラクターの名前は' + PREP_MAX.pc + '文字までです。');
  if (outcome.length > RECORD_MAX.outcome) throw badRequest('結果は' + RECORD_MAX.outcome + '文字までです。');
  await ctx.db
    .prepare(
      `INSERT INTO session_sheets (session_id, member_id, url, pc_name, outcome, updated_at) VALUES (?1, ?2, '', ?3, ?4, ?5)
       ON CONFLICT (session_id, member_id) DO UPDATE SET pc_name = excluded.pc_name, outcome = excluded.outcome, updated_at = excluded.updated_at`,
    )
    .bind(s.rowId, ctx.actor.memberId, pc, outcome, ctx.now.toISOString())
    .run();
  return { ok: true, id: s.id, message: '「' + s.name + '」の' + name + 'のPCを保存しました' + (pc ? '（' + pc + (outcome ? '・' + outcome : '') + '）' : '') + '。' };
}
