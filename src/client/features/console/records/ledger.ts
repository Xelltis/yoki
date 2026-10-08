// 記録のタブで見せるもの（終わった卓と、メンバーごとのPCの台帳）。画面のデータdを受け取って計算するだけ
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { sortSessions } from '../model/model';

/** 終わった卓か（記録を書ける）。「終了」か、開催日が今日までの「開催」 */
export function isFinished(d: ConsoleData, s: ConsoleSession): boolean {
  return s.status === '終了' || (s.status === '開催' && !!s.date && s.date <= d.today);
}
/** 終わった卓（新しい順） */
export function finishedSessions(d: ConsoleData): ConsoleSession[] {
  return sortSessions(d.sessions.filter((s) => isFinished(d, s))).reverse();
}

/** PCの1人分。sessionsは出た卓（古い順）、urlはいちばん新しいキャラシ */
export type PcRow = { pc: string; sessions: { id: string; name: string; date: string; outcome: string }[]; url: string };
/** メンバー1人分。gm・plはGMと参加者として終えた卓の数（行けなくなった卓は数えない） */
export type LedgerRow = { name: string; gm: number; pl: number; pcs: PcRow[] };

/** メンバーごとのPCの台帳。PCは、終わった卓でそのメンバーが書いたPCの名前でまとめ、最後に出た日の新しい順に並べる */
export function ledger(d: ConsoleData): LedgerRow[] {
  const rows = new Map(d.members.map((m) => [m.name, { name: m.name, gm: 0, pl: 0, pcs: new Map<string, PcRow>() }]));
  finishedSessions(d).reverse().forEach((s) => {
    const gm = rows.get(s.gm);
    if (gm) gm.gm++;
    s.members.forEach((n) => {
      const r = rows.get(n);
      if (!r || s.absent.some((a) => a.name === n)) return;
      r.pl++;
      const sh = s.prep.sheets[n];
      if (!sh || !sh.pc) return;
      const pc = r.pcs.get(sh.pc) ?? { pc: sh.pc, sessions: [], url: '' };
      pc.sessions.push({ id: s.id, name: s.name, date: s.date, outcome: sh.outcome });
      if (sh.url) pc.url = sh.url;
      r.pcs.set(sh.pc, pc);
    });
  });
  return [...rows.values()].map((r) => ({
    name: r.name, gm: r.gm, pl: r.pl,
    pcs: [...r.pcs.values()].sort((a, b) => (b.sessions.at(-1)!.date).localeCompare(a.sessions.at(-1)!.date)),
  }));
}
