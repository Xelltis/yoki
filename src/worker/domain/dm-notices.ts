// 自分あてのDMの知らせ（本人が選ぶ。どのグループにも効く）。種類はsrc/shared/api.tsのDM_KINDS。
// 知らせを決めたところが、受け取ると決めた人の分をdm_queueに積み（dmStmt）、見回りが少しずつ送る（sendQueuedDms）。
// 1回に送るのはDM_PER_RUN通まで（Discordを呼べる数を、知らせとGoogleの同期で分け合うため）。DMのチャンネルは控えて使い回す。
// 届かなければ理由を本人の設定（users.dm_error）に残す。送れないまま古くなった控えは捨てる
import { DM_KINDS, type DmKind } from '../../shared/api';
import { openDm, postDm, type DmResult } from '../discord/dm';
import { badRequest } from '../lib/errors';
import { uniq } from '../lib/text';
import { type Form, list } from './form';
import type { Ctx } from './types';

/** 見回り1回で送るDMの数 */
export const DM_PER_RUN = 10;
/** 送れないまま、これより古くなった控えは捨てる（遅れて届いても役に立たないため） */
export const DM_STALE_MS = 12 * 3600_000;
/** 送り直す回数の上限（通信が切れた・Discordが混んでいるとき） */
export const DM_TRIES = 3;

type DmCtx = Pick<Ctx, 'db' | 'memberByName' | 'group' | 'appUrl' | 'now'>;

/**
 * 受け取ると決めた人に、DMを積む文。namesはメンバーの名前（ログインしていないメンバーには届かない）。積む人がいなければnull。
 * 文の頭にグループの名前を、終わりにグループの画面のURLを添える（DMだけでは、どのグループの話か分からないため）
 */
export function dmStmt(ctx: DmCtx, kind: DmKind, names: string[], body: string): D1PreparedStatement | null {
  const ids = uniq(names.map((n) => ctx.memberByName.get(n)?.userId ?? '').filter(Boolean));
  if (!ids.length) return null;
  const text = '【' + ctx.group.title + '】' + body + (ctx.appUrl ? '\n' + ctx.appUrl : '');
  return ctx.db
    .prepare(`INSERT INTO dm_queue (user_id, text, created_at) SELECT id, ?1, ?2 FROM users WHERE id IN (SELECT value FROM json_each(?3)) AND instr(',' || dm_kinds || ',', ?4) > 0`)
    .bind(text, ctx.now.toISOString(), JSON.stringify(ids), ',' + kind + ',');
}

/** DMを積む（積む人がいなければ何もしない） */
export async function queueDm(ctx: DmCtx, kind: DmKind, names: string[], body: string): Promise<void> {
  await dmStmt(ctx, kind, names, body)?.run();
}

/** 受け取る知らせを選ぶ（本人。どのグループにも効く）。form: { kinds: DmKind[] }。止めたら、届かなかった理由も消す */
export async function setDmNotices(ctx: Ctx, form: Form) {
  const kinds = uniq(list(form.kinds));
  const bad = kinds.filter((k) => !(k in DM_KINDS));
  if (bad.length) throw badRequest('知らない知らせの種類です: ' + bad.join('、'));
  await ctx.db.prepare("UPDATE users SET dm_kinds = ?1, dm_error = CASE WHEN ?1 = '' THEN '' ELSE dm_error END WHERE id = ?2").bind(kinds.join(','), ctx.actor.userId).run();
  return { ok: true, message: kinds.length ? 'DMで受け取る知らせを保存しました（' + kinds.length + '種類。どのグループにも効きます）。' : 'DMの知らせを止めました。' };
}

/** 試しにDMを送る（本人に、その場で）。届いたらチャンネルを控えて、届かなかった理由を消す。届かなければ理由を残して断る */
export async function testDm(ctx: Ctx) {
  const token = ctx.bot.token, user = ctx.actor.userId;
  if (!token) throw badRequest('YokiのBotのトークンが無いので、DMを送れません（運営者に伝えてください）。');
  const o = await openDm(token, user);
  const r: DmResult = o.ok ? await postDm(token, o.channel, '🔔 Yokiからの試しのDMです。選んだ知らせは、このように届きます。') : o;
  await ctx.db.prepare('UPDATE users SET dm_channel = ?2, dm_error = ?3 WHERE id = ?1').bind(user, o.ok ? o.channel : '', r.error).run();
  if (!r.ok) throw badRequest('DMを送れませんでした（' + r.error + '）。');
  return { ok: true, message: 'DMを送りました。Discordで届いたかを確かめてください。' };
}

type Row = { id: number; user_id: string; text: string; tries: number; dm_channel: string };

/**
 * 積んであるDMを、古い順にlimit通まで送る（見回りが毎回）。送った数を返す。
 * トークンが使えなければ（401）そこで止める。届かない断り（403など）か、送り直しの上限なら、理由を本人に残して捨てる。
 * DMのチャンネルが無くなっていたら（404）、控えを外して次の回に開き直す。書き込みは最後に1回のbatchにまとめる（D1の問い合わせの数を抑えるため）
 */
export async function sendQueuedDms(db: D1Database, token: string, now: Date, limit = DM_PER_RUN): Promise<number> {
  await db.prepare('DELETE FROM dm_queue WHERE created_at < ?').bind(new Date(now.getTime() - DM_STALE_MS).toISOString()).run();
  if (!token) return 0;
  const rows = (await db.prepare('SELECT q.id, q.user_id, q.text, q.tries, u.dm_channel FROM dm_queue q JOIN users u ON u.id = q.user_id ORDER BY q.id LIMIT ?').bind(limit).all<Row>()).results;
  const done: number[] = [], retry: number[] = [], okUsers: string[] = [];
  const errors = new Map<string, string>(), channels = new Map<string, string>();
  for (const r of rows) {
    let channel = channels.get(r.user_id) ?? r.dm_channel;
    let res: DmResult;
    if (!channel) {
      const o = await openDm(token, r.user_id);
      channel = o.channel;
      if (o.ok) channels.set(r.user_id, channel);
      res = o;
    } else res = { ok: true, status: 0, error: '' };
    if (res.ok) res = await postDm(token, channel, r.text);
    if (res.ok) { done.push(r.id); okUsers.push(r.user_id); continue; }
    if (res.status === 401) break;
    // DMのチャンネルが無くなった。控えを外し、次の回に開き直す
    if (res.status === 404) channels.set(r.user_id, '');
    const again = res.status === 0 || res.status === 404 || res.status === 429 || res.status >= 500;
    if (again && r.tries + 1 < DM_TRIES) { retry.push(r.id); continue; }
    done.push(r.id);
    errors.set(r.user_id, res.error);
  }
  const json = (v: unknown) => JSON.stringify(v);
  /** [[利用者, 値], …] の値を、その利用者の列に書く文 */
  const setByUser = (col: 'dm_error' | 'dm_channel', pairs: [string, string][]) =>
    db.prepare(`UPDATE users SET ${col} = (SELECT json_extract(value, '$[1]') FROM json_each(?1) WHERE json_extract(value, '$[0]') = users.id)
                 WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`).bind(json(pairs));
  const stmts: D1PreparedStatement[] = [];
  if (done.length) stmts.push(db.prepare('DELETE FROM dm_queue WHERE id IN (SELECT value FROM json_each(?))').bind(json(done)));
  if (retry.length) stmts.push(db.prepare('UPDATE dm_queue SET tries = tries + 1 WHERE id IN (SELECT value FROM json_each(?))').bind(json(retry)));
  // 届いた人の理由は消す（同じ回にほかのDMが届かなければ、そちらを残す）
  const cleared = uniq(okUsers).filter((u) => !errors.has(u));
  if (cleared.length) stmts.push(db.prepare("UPDATE users SET dm_error = '' WHERE dm_error <> '' AND id IN (SELECT value FROM json_each(?))").bind(json(cleared)));
  if (errors.size) stmts.push(setByUser('dm_error', [...errors]));
  if (channels.size) stmts.push(setByUser('dm_channel', [...channels]));
  if (stmts.length) await db.batch(stmts);
  return okUsers.length;
}
