// グループの書き出し（管理者だけ）。グループの中身を、手元に控えるためのJSONにする（画面がファイルにして渡す）。
// 運営者はグループの中身を見ないので、控えを持てるのはグループの管理者だけ。秘匿HO・Discordのチャンネル・購読URL・Googleの情報は入れない
import type { GroupExport } from '../../shared/api';
import { APP_VERSION } from '../version';
import type { Form } from './form';
import type { Ctx } from './types';

export async function exportGroup(ctx: Ctx, _form: Form) {
  const db = ctx.db, g = ctx.group;
  // 画面のデータには今日からの予定しか無いので、残っている日すべてと、卓の履歴をここで読む
  const [avail, notes, history] = await db.batch([
    db.prepare(`SELECT a.date, a.part, a.mark, m.name FROM availability a JOIN members m ON m.id = a.member_id WHERE m.group_id = ? ORDER BY a.date, m.id`).bind(g.id),
    db.prepare(`SELECT n.date, n.text, m.name FROM avail_notes n JOIN members m ON m.id = n.member_id WHERE m.group_id = ? ORDER BY n.date, m.id`).bind(g.id),
    db.prepare(`SELECT h.session_id, h.at, h.by_name, h.action, h.detail FROM session_history h JOIN sessions s ON s.id = h.session_id WHERE s.group_id = ? ORDER BY h.id`).bind(g.id),
  ]);
  const hist = new Map<number, GroupExport['sessions'][number]['history']>();
  for (const h of history!.results as { session_id: number; at: string; by_name: string; action: string; detail: string }[]) {
    const list = hist.get(h.session_id) ?? [];
    list.push({ at: h.at, by: h.by_name, action: h.action, detail: h.detail });
    hist.set(h.session_id, list);
  }
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  const scName = new Map(ctx.scenarios.map((s) => [s.id, s.name]));
  const out: GroupExport = {
    format: 'yoki-group-export',
    version: APP_VERSION,
    exportedAt: ctx.now.toISOString(),
    group: { id: g.id, title: g.title, guildName: g.guild_name },
    members: ctx.members.map((m) => ({ name: m.name, discordId: m.discordId, note: m.note, admin: m.isAdmin })),
    sessions: ctx.sessions.map((s) => ({
      id: s.id, name: s.name, status: s.status, date: s.date ?? '', start: s.start, end: s.end, place: s.place, memo: s.memo, series: s.series, seriesEnd: s.seriesEnd ?? '',
      windowFrom: s.windowFrom ?? '', windowTo: s.windowTo ?? '', gm: s.gm, members: s.members, want: s.want, interest: s.interest,
      // シナリオを消すと卓から外れる（外部キー）ので、付いていればいつもある
      scenario: s.scenarioId === null ? '' : scName.get(s.scenarioId)!,
      candidates: s.candidates, votes: ctx.votes.get(s.rowId) ?? {}, capacity: s.capacity ?? 0, recruitDue: s.recruitDue ?? '',
      absent: s.absent.map((a) => ({ name: a.name, note: a.note })),
      // 秘匿HOは入れない（管理者も読めないもの）
      prep: {
        sheetDue: s.sheetDue ?? '',
        slots: s.slots.map((x) => ({ label: x.label, summary: x.summary, assigned: x.memberId === null ? '' : nameOf.get(x.memberId)! })),
        sheets: Object.fromEntries(s.sheets.map((x) => [nameOf.get(x.memberId)!, { url: x.url, pc: x.pc, outcome: x.outcome }])),
      },
      record: { logUrl: s.logUrl, recap: s.recap },
      history: hist.get(s.rowId) ?? [],
    })),
    availability: (avail!.results as { date: string; part: string; mark: string; name: string }[]).map((a) => ({ date: a.date, name: a.name, part: a.part, mark: a.mark })),
    availNotes: (notes!.results as { date: string; text: string; name: string }[]).map((n) => ({ date: n.date, name: n.name, text: n.text })),
    dayNotes: Object.keys(ctx.dayNotes).sort().map((k) => ({ date: k, to: ctx.dayNotes[k]!.to, text: ctx.dayNotes[k]!.text, by: ctx.dayNotes[k]!.by })),
    scenarios: ctx.scenarios.map((s) => ({
      name: s.name, system: s.system, playersMin: s.playersMin, playersMax: s.playersMax, hours: s.hours, url: s.url, memo: s.memo,
      marks: Object.fromEntries(ctx.scenarioMarks.filter((m) => m.scenarioId === s.id).map((m) => [nameOf.get(m.memberId)!, m.kind])),
    })),
  };
  return { ok: true, message: 'グループを書き出しました（卓' + out.sessions.length + '件・メンバー' + out.members.length + '人）。', export: out };
}
