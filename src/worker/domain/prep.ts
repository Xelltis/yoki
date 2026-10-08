// 卓の準備: HOの枠（公開HO）・秘匿HO・HOの希望と割り当て・キャラシの提出と締め切り。
// 秘匿HOを読めるのは、その卓のGMと割り当てた本人だけ（読み込みのSQLで絞る）。書けるのはGMだけで、管理者にも書かせない（書くには読む必要があるため）
import { PREP_MAX } from '../../shared/api';
import { adminError, badRequest, notFound } from '../lib/errors';
import { parseYmd } from '../lib/jst';
import { isHttpUrl } from '../lib/text';
import { STATUS } from './constants';
import { type Form, list, requireSelf, str } from './form';
import { findSession, peopleOf } from './model';
import type { Ctx, Session } from './types';

/** 卓のGMがメンバーか（メンバーでないGMは、秘匿HOを読み書きできない） */
export const hasMemberGm = (ctx: Ctx, s: Session): boolean => !!s.gm && ctx.memberByName.has(s.gm);
/** 読み込んだ人が、その卓のGM（メンバー）か */
export const isGmOf = (ctx: Ctx, s: Session): boolean => ctx.actor.memberId > 0 && s.gm === ctx.actor.name && hasMemberGm(ctx, s);
/** 秘匿HOのある卓か */
export const hasSecrets = (s: Session): boolean => s.slots.some((x) => x.hasSecret);

/**
 * 秘匿HOのある卓で、GMを替えてよいか。今のGM（メンバー）か、メンバーのGMがいない卓の管理者だけ。
 * 管理者でも、ほかのGMの卓で自分をGMにして秘匿HOを読めないように
 */
export function checkGmChange(ctx: Ctx, s: Session, gm: string): void {
  if (gm === s.gm || !hasSecrets(s) || isGmOf(ctx, s) || (ctx.actor.isAdmin && !hasMemberGm(ctx, s))) return;
  throw badRequest('「' + s.name + '」には秘匿HOがあるので、GMを替えられるのは今のGM（' + s.gm + '）だけです。');
}

/** 準備の書き込みに使う卓（終わった卓・中止の卓は準備しない） */
function findOpen(ctx: Ctx, id: unknown): Session {
  const s = findSession(ctx, id);
  if (s.status === STATUS.DONE || s.status === STATUS.CANCELED) throw badRequest('「' + s.name + '」は' + s.status + 'の卓なので、準備は変えられません。');
  return s;
}

/** GMか管理者だけ */
function requireGmOrAdmin(ctx: Ctx, s: Session, what: string): void {
  if (!isGmOf(ctx, s) && !ctx.actor.isAdmin) throw adminError('GMのほかが' + what);
}

/**
 * HOの枠（ラベルと公開HO）と、キャラシの締め切りを書く（GMか管理者）。form: { id, slots: [{ pos, label, summary }], sheetDue }
 * 枠は番号（pos）で書き換え、送られなかった番号の枠は消す（希望と秘匿HOは、残る枠ではそのまま）。秘匿HOのある枠を消せるのはGMだけ
 */
export async function savePrep(ctx: Ctx, form: Form) {
  const s = findOpen(ctx, form.id);
  requireGmOrAdmin(ctx, s, 'HOと締め切りを変えること');
  const raw = Array.isArray(form.slots) ? (form.slots as Record<string, unknown>[]) : [];
  if (raw.length > PREP_MAX.slots) throw badRequest('HOは' + PREP_MAX.slots + '個までです。');
  const slots = raw.map((x) => {
    const pos = Number(x?.pos);
    if (!Number.isInteger(pos) || pos < 1 || pos > PREP_MAX.slots) throw badRequest('HOの番号が正しくありません。');
    const label = str(x.label), summary = str(x.summary);
    if (!label) throw badRequest('HOの名前を入れてください（HO1など）。');
    if (label.length > PREP_MAX.label) throw badRequest('HOの名前は' + PREP_MAX.label + '文字までです。');
    if (summary.length > PREP_MAX.summary) throw badRequest('公開HOは' + PREP_MAX.summary + '文字までです。');
    return { pos, label, summary };
  });
  if (new Set(slots.map((x) => x.pos)).size !== slots.length) throw badRequest('HOの番号が重なっています。');
  const due = str(form.sheetDue) ? parseYmd(form.sheetDue) : null;
  if (str(form.sheetDue) && !due) throw badRequest('キャラシの締め切りの日付が読めません: ' + str(form.sheetDue));
  const keep = new Set(slots.map((x) => x.pos));
  const removed = s.slots.filter((x) => !keep.has(x.pos));
  if (removed.some((x) => x.hasSecret) && !isGmOf(ctx, s)) throw badRequest('秘匿HOのあるHOを消せるのは、GMだけです。');
  const db = ctx.db;
  const at = ctx.now.toISOString();
  const json = JSON.stringify(slots);
  const stmts: D1PreparedStatement[] = [];
  if (removed.length) stmts.push(db.prepare('DELETE FROM session_slots WHERE session_id = ?1 AND pos IN (SELECT value FROM json_each(?2))').bind(s.rowId, JSON.stringify(removed.map((x) => x.pos))));
  if (slots.length) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO session_slots (session_id, pos, label, summary, updated_at)
           SELECT ?1, json_extract(value, '$.pos'), json_extract(value, '$.label'), json_extract(value, '$.summary'), ?3 FROM json_each(?2) WHERE true
           ON CONFLICT (session_id, pos) DO UPDATE SET label = excluded.label, summary = excluded.summary, updated_at = excluded.updated_at`,
        )
        .bind(s.rowId, json, at),
    );
  }
  // 締め切りを変えたら、締め切り前の催促を送り直せるようにする
  stmts.push(db.prepare('UPDATE sessions SET sheet_due = ?2, sheet_urged_at = CASE WHEN sheet_due IS ?2 THEN sheet_urged_at END, updated_at = ?3 WHERE id = ?1').bind(s.rowId, due, at));
  await db.batch(stmts);
  return { ok: true, id: s.id, message: '「' + s.name + '」の準備を保存しました（HO ' + slots.length + '個' + (due ? '・キャラシの締め切り ' + due : '') + '）' };
}

/** 枠を番号で探す */
function findSlot(s: Session, pos: unknown) {
  const slot = s.slots.find((x) => String(x.pos) === str(pos));
  if (!slot) throw notFound('HOが見つかりません: ' + str(pos));
  return slot;
}

/** 秘匿HOを書く（GMだけ。管理者も書けない）。form: { id, pos, secret } */
export async function saveSlotSecret(ctx: Ctx, form: Form) {
  const s = findOpen(ctx, form.id);
  if (!isGmOf(ctx, s)) throw badRequest('秘匿HOを書けるのは、その卓のGMだけです。');
  const slot = findSlot(s, form.pos);
  const secret = str(form.secret);
  if (secret.length > PREP_MAX.secret) throw badRequest('秘匿HOは' + PREP_MAX.secret + '文字までです。');
  await ctx.db.prepare('UPDATE session_slots SET secret = ?3, updated_at = ?4 WHERE session_id = ?1 AND pos = ?2').bind(s.rowId, slot.pos, secret, ctx.now.toISOString()).run();
  return { ok: true, id: s.id, message: slot.label + 'の秘匿HOを' + (secret ? '保存しました' : '消しました') };
}

/**
 * HOを割り当てる（GM。メンバーのGMがいない卓だけ管理者も）。form: { id, assign: { pos: 名前（空なら外す） } }
 * 割り当てられるのは、その卓の参加者（メンバー）だけ。1人に1つまで。送られなかった枠は、今の割り当てのまま
 */
export async function assignSlots(ctx: Ctx, form: Form) {
  const s = findOpen(ctx, form.id);
  if (!isGmOf(ctx, s) && !(ctx.actor.isAdmin && !hasMemberGm(ctx, s))) throw badRequest('HOを割り当てられるのは、その卓のGMだけです。');
  const assign = form.assign && typeof form.assign === 'object' ? (form.assign as Record<string, unknown>) : {};
  const next = new Map(s.slots.map((x) => [x.pos, x.memberId]));
  for (const [pos, v] of Object.entries(assign)) {
    const slot = findSlot(s, pos);
    const name = str(v);
    if (!name) { next.set(slot.pos, null); continue; }
    const m = ctx.memberByName.get(name);
    if (!m || !s.members.includes(name)) throw badRequest(name + 'は「' + s.name + '」の参加者（メンバー）ではないので、HOを割り当てられません。');
    next.set(slot.pos, m.id);
  }
  const ids = [...next.values()].filter((x) => x !== null);
  if (new Set(ids).size !== ids.length) throw badRequest('1人に割り当てられるHOは1つまでです。');
  await ctx.db
    .prepare(
      `UPDATE session_slots SET member_id = (SELECT json_extract(value, '$[1]') FROM json_each(?2) WHERE json_extract(value, '$[0]') = session_slots.pos), updated_at = ?3
        WHERE session_id = ?1`,
    )
    .bind(s.rowId, JSON.stringify([...next.entries()]), ctx.now.toISOString())
    .run();
  return { ok: true, id: s.id, message: '「' + s.name + '」のHOを割り当てました' };
}

/** HOの希望を出す（その卓の参加者本人）。form: { id, name, hopes: [第1希望の番号, 第2希望の番号] }（空なら取り消す） */
export async function setSlotHope(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name);
  const s = findOpen(ctx, form.id);
  if (!s.members.includes(name)) throw badRequest(name + 'は「' + s.name + '」の参加者ではないので、HOの希望は出せません。');
  const hopes = list(form.hopes).map((p) => findSlot(s, p).pos);
  if (hopes.length > 2) throw badRequest('HOの希望は、第2希望までです。');
  if (new Set(hopes).size !== hopes.length) throw badRequest('第1希望と第2希望は、別のHOにしてください。');
  const db = ctx.db;
  await db.batch([
    db.prepare('DELETE FROM slot_hopes WHERE member_id = ?2 AND slot_id IN (SELECT id FROM session_slots WHERE session_id = ?1)').bind(s.rowId, ctx.actor.memberId),
    db
      .prepare(
        `INSERT INTO slot_hopes (slot_id, member_id, rank)
         SELECT sl.id, ?2, j.key + 1 FROM json_each(?3) j JOIN session_slots sl ON sl.session_id = ?1 AND sl.pos = j.value`,
      )
      .bind(s.rowId, ctx.actor.memberId, JSON.stringify(hopes)),
  ]);
  const label = (pos: number) => s.slots.find((x) => x.pos === pos)!.label;
  return { ok: true, id: s.id, message: hopes.length ? name + 'のHOの希望: ' + hopes.map((p, i) => '第' + (i + 1) + '希望 ' + label(p)).join('、') : name + 'のHOの希望を取り消しました' };
}

/**
 * キャラシを出す・取り下げる（その卓のGMか参加者の本人）。管理者は、ほかの人のキャラシを取り下げることだけできる。
 * form: { id, name, url, pc }（urlが空なら取り下げる）
 */
export async function submitSheet(ctx: Ctx, form: Form) {
  const s = findOpen(ctx, form.id);
  const name = str(form.name);
  const url = str(form.url), pc = str(form.pc);
  if (name !== ctx.actor.name && !(ctx.actor.isAdmin && !url)) requireSelf(ctx, name);
  const m = ctx.memberByName.get(name);
  if (!m) throw notFound('メンバーが見つかりません: ' + name);
  const db = ctx.db;
  if (!url) {
    await db.prepare('DELETE FROM session_sheets WHERE session_id = ? AND member_id = ?').bind(s.rowId, m.id).run();
    return { ok: true, id: s.id, message: name + 'のキャラシを取り下げました' };
  }
  if (!peopleOf(s).includes(name)) throw badRequest(name + 'は「' + s.name + '」のGMでも参加者でもないので、キャラシは出せません。');
  if (url.length > PREP_MAX.url) throw badRequest('キャラシのURLは' + PREP_MAX.url + '文字までです。');
  if (!isHttpUrl(url)) throw badRequest('キャラシのURLは、http:// か https:// で始まるアドレスを入れてください。');
  if (pc.length > PREP_MAX.pc) throw badRequest('キャラクターの名前は' + PREP_MAX.pc + '文字までです。');
  await db
    .prepare(
      `INSERT INTO session_sheets (session_id, member_id, url, pc_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (session_id, member_id) DO UPDATE SET url = excluded.url, pc_name = excluded.pc_name, updated_at = excluded.updated_at`,
    )
    .bind(s.rowId, m.id, url, pc, ctx.now.toISOString())
    .run();
  return { ok: true, id: s.id, message: name + 'のキャラシを出しました' + (pc ? '（' + pc + '）' : '') };
}

/**
 * 参加者でなくなった人のHOの割り当てを外す文（参加者を書き直したあとに、同じbatchで流す）。
 * 外さないと、卓から外れた人が秘匿HOを読み続けられるため。rowIdsは参加者を書き直した卓
 */
export function unassignGoneStmt(ctx: Ctx, rowIds: number[]): D1PreparedStatement {
  return ctx.db
    .prepare(
      `UPDATE session_slots SET member_id = NULL
        WHERE session_id IN (SELECT value FROM json_each(?1)) AND member_id IS NOT NULL
          AND member_id NOT IN (SELECT p.member_id FROM session_people p WHERE p.session_id = session_slots.session_id AND p.role = 'member' AND p.member_id IS NOT NULL)`,
    )
    .bind(JSON.stringify(rowIds));
}
