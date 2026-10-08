// シナリオと通過の印。グループで遊ぶシナリオを登録・変更・削除し、メンバーごとに通過の印（遊んだ・GMできる）を付ける。
// 「終了」の卓から出す通過は、読み込んだ卓から計算する（src/shared/scenario.ts）。ここで書くのは印だけ
import { SCENARIO_MAX, type ScenarioMark } from '../../shared/api';
import { type ScenarioSession, sessionPasses } from '../../shared/scenario';
import { adminError, badRequest, notFound } from '../lib/errors';
import { isHttpUrl } from '../lib/text';
import { type Form, requireSelf, str } from './form';
import type { Ctx, Scenario } from './types';

/** 通過の計算に使う形の卓 */
export const scenarioSessions = (ctx: Ctx): ScenarioSession[] =>
  ctx.sessions.map((s) => ({ id: s.id, scenarioId: s.scenarioId === null ? '' : String(s.scenarioId), status: s.status, date: s.date ?? '', gm: s.gm, members: s.members, absent: s.absent }));

export function findScenario(ctx: Ctx, id: unknown): Scenario {
  const s = ctx.scenarios.find((x) => String(x.id) === str(id));
  if (!s) throw notFound('シナリオが見つかりません: ' + str(id));
  return s;
}

/** 卓の保存で受け取るシナリオ。空ならnull。ほかのグループのシナリオは受け取らない */
export function readScenarioId(ctx: Ctx, v: unknown): number | null {
  return str(v) ? findScenario(ctx, v).id : null;
}

function readText(v: unknown, max: number, label: string): string {
  const t = str(v);
  if (t.length > max) throw badRequest(label + 'は' + max + '文字までです。');
  return t;
}

function readPlayers(v: unknown, label: string): number | null {
  const t = str(v);
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > SCENARIO_MAX.players) throw badRequest(label + 'は1〜' + SCENARIO_MAX.players + 'の数で入れてください。');
  return n;
}

/** シナリオを登録・変更する（メンバーならだれでも）。form: { id?, name, system, playersMin, playersMax, hours, url, memo } */
export async function saveScenario(ctx: Ctx, form: Form) {
  const existing = form.id ? findScenario(ctx, form.id) : null;
  const name = readText(form.name, SCENARIO_MAX.name, 'シナリオの名前');
  if (!name) throw badRequest('シナリオの名前を入れてください。');
  if (ctx.scenarios.some((x) => x.name === name && x.id !== existing?.id)) throw badRequest('同じ名前のシナリオがあります: ' + name);
  if (!existing && ctx.scenarios.length >= SCENARIO_MAX.count) throw badRequest('シナリオは' + SCENARIO_MAX.count + '件までです。使わないシナリオを消してから登録してください。');
  const system = readText(form.system, SCENARIO_MAX.system, 'システム');
  const min = readPlayers(form.playersMin, 'PLの人数（下限）');
  const max = readPlayers(form.playersMax, 'PLの人数（上限）');
  if (min !== null && max !== null && min > max) throw badRequest('PLの人数は、下限を上限より大きくできません。');
  const hours = readText(form.hours, SCENARIO_MAX.hours, '時間の目安');
  const url = readText(form.url, SCENARIO_MAX.url, 'URL');
  if (url && !isHttpUrl(url)) throw badRequest('URLは、http:// か https:// で始まるアドレスを入れてください。');
  const memo = readText(form.memo, SCENARIO_MAX.memo, 'メモ');
  const at = ctx.now.toISOString();
  if (existing) {
    await ctx.db
      .prepare('UPDATE scenarios SET name = ?2, system = ?3, players_min = ?4, players_max = ?5, hours = ?6, url = ?7, memo = ?8, updated_at = ?9 WHERE id = ?1')
      .bind(existing.id, name, system, min, max, hours, url, memo, at)
      .run();
    return { ok: true, id: String(existing.id), message: 'シナリオを更新しました: ' + name };
  }
  const r = await ctx.db
    .prepare(
      `INSERT INTO scenarios (group_id, name, system, players_min, players_max, hours, url, memo, created_by, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
    )
    .bind(ctx.group.id, name, system, min, max, hours, url, memo, ctx.actor.memberId, at)
    .first<{ id: number }>();
  return { ok: true, id: String(r!.id), message: 'シナリオを登録しました: ' + name };
}

/** シナリオを消す（登録した人と管理者）。卓からは外れ（卓は残る）、通過の印も消える。form: { id } */
export async function deleteScenario(ctx: Ctx, form: Form) {
  const sc = findScenario(ctx, form.id);
  if (!ctx.actor.isAdmin && sc.createdBy !== ctx.actor.memberId) throw adminError('ほかの人が登録したシナリオの削除');
  const used = ctx.sessions.filter((s) => s.scenarioId === sc.id).length;
  await ctx.db.prepare('DELETE FROM scenarios WHERE id = ?').bind(sc.id).run();
  return { ok: true, message: 'シナリオを削除しました: ' + sc.name + (used ? '（' + used + '件の卓から外しました）' : '') };
}

const MARK_LABEL: Record<ScenarioMark, string> = { played: '通過', gm: 'GMできる' };

/**
 * 通過の印を付ける・外す（本人。管理者はだれの分でも）。form: { id, name, kind: 'played' | 'gm' | '' }
 * 「終了」の卓から出した通過は、未通過には戻せない（印を外しても、卓からの通過は残る）
 */
export async function setScenarioMark(ctx: Ctx, form: Form) {
  const sc = findScenario(ctx, form.id);
  const name = ctx.actor.isAdmin ? str(form.name) : requireSelf(ctx, form.name);
  const member = ctx.memberByName.get(name);
  if (!member) throw notFound('メンバーが見つかりません: ' + name);
  const kind = str(form.kind);
  if (kind && kind !== 'played' && kind !== 'gm') throw badRequest('通過の印は「通過」か「GMできる」です。');
  const db = ctx.db;
  if (!kind) {
    const from = sessionPasses(String(sc.id), scenarioSessions(ctx), new Set([name]))[name];
    if (from) throw badRequest(name + 'は「' + sc.name + '」の卓（' + from.from + '）で通過しているので、未通過にはできません。');
    await db.prepare('DELETE FROM member_scenarios WHERE scenario_id = ? AND member_id = ?').bind(sc.id, member.id).run();
    return { ok: true, message: sc.name + ' ' + name + ': 未通過にしました' };
  }
  await db
    .prepare(
      `INSERT INTO member_scenarios (scenario_id, member_id, kind, at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (scenario_id, member_id) DO UPDATE SET kind = excluded.kind, at = excluded.at`,
    )
    .bind(sc.id, member.id, kind, ctx.now.toISOString())
    .run();
  return { ok: true, message: sc.name + ' ' + name + ': ' + MARK_LABEL[kind as ScenarioMark] + 'にしました' };
}

/**
 * 「終了」の卓を消す前に、その卓から出していた通過を印に書き写す文（卓が消えても通過が残るように）。rowIdsは消す卓（sessions.id）。
 * GMはgm、参加者はplayed。もう印があれば、gmのほうを残す
 */
export function keepPassesStmt(ctx: Ctx, rowIds: number[]): D1PreparedStatement {
  return ctx.db
    .prepare(
      `INSERT INTO member_scenarios (scenario_id, member_id, kind, at)
       SELECT s.scenario_id, p.member_id, CASE p.role WHEN 'gm' THEN 'gm' ELSE 'played' END, ?2
         FROM sessions s JOIN session_people p ON p.session_id = s.id
        WHERE s.id IN (SELECT value FROM json_each(?1)) AND s.status = '終了' AND s.scenario_id IS NOT NULL
          AND p.member_id IS NOT NULL AND p.role IN ('gm', 'member')
          AND NOT EXISTS (SELECT 1 FROM session_absences a WHERE a.session_id = s.id AND a.member_id = p.member_id)
       ON CONFLICT (scenario_id, member_id) DO UPDATE SET kind = 'gm' WHERE excluded.kind = 'gm'`,
    )
    .bind(JSON.stringify(rowIds), ctx.now.toISOString());
}
