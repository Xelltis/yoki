// 記録のタブで見せるもの（終わった卓と、メンバーごとのPCの台帳）。画面のデータdを受け取って計算するだけ
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { sortSessions } from '../model/model';
import { gmsOf } from '../../../../shared/gm';

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
/** メンバー1人分。gm・plはGM（共同GMも）と参加者として終えた卓の数（行けなくなった卓は数えない） */
export type LedgerRow = { name: string; gm: number; pl: number; pcs: PcRow[] };

/** メンバーごとのPCの台帳。PCは、終わった卓でそのメンバーが書いたPCの名前でまとめ、最後に出た日の新しい順に並べる */
export function ledger(d: ConsoleData): LedgerRow[] {
  const rows = new Map(d.members.map((m) => [m.name, { name: m.name, gm: 0, pl: 0, pcs: new Map<string, PcRow>() }]));
  finishedSessions(d).reverse().forEach((s) => {
    gmsOf(s).forEach((n) => { const gm = rows.get(n); if (gm) gm.gm++; });
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

/**
 * あなたの遊んだ記録（このグループ）。終わった卓のうち、GM（共同GMも）か参加者として入った卓（行けなくなった卓は数えない）から作る。
 * systemsはシステムごとの回数（多い順。シナリオの無い卓は「シナリオ未設定」、システムの無いシナリオは「システム未設定」）、
 * partnersはよく一緒に遊んだ人（GMも参加者も数える。多い順に3人まで）、first・lastは最初と最後に終えた卓の日
 */
export type MyStats = {
  gm: number; pl: number; first: string; last: string;
  systems: { system: string; gm: number; pl: number }[];
  partners: { name: string; n: number }[];
};

export function myStats(d: ConsoleData, name: string): MyStats {
  const out: MyStats = { gm: 0, pl: 0, first: '', last: '', systems: [], partners: [] };
  const systems = new Map<string, { system: string; gm: number; pl: number }>(), partners = new Map<string, number>();
  finishedSessions(d).reverse().forEach((s) => {
    const asGm = gmsOf(s).includes(name), asPl = s.members.includes(name) && !s.absent.some((a) => a.name === name);
    if (!asGm && !asPl) return;
    if (asGm) out.gm++; else out.pl++;
    out.first ||= s.date;
    out.last = s.date;
    const sc = d.scenarios.find((x) => x.id === s.scenarioId);
    const key = !sc ? 'シナリオ未設定' : sc.system || 'システム未設定';
    const row = systems.get(key) ?? { system: key, gm: 0, pl: 0 };
    if (asGm) row.gm++; else row.pl++;
    systems.set(key, row);
    for (const n of [...gmsOf(s), ...s.members]) {
      if (n !== name && !s.absent.some((a) => a.name === n)) partners.set(n, (partners.get(n) ?? 0) + 1);
    }
  });
  out.systems = [...systems.values()].sort((a, b) => b.gm + b.pl - (a.gm + a.pl) || a.system.localeCompare(b.system, 'ja'));
  out.partners = [...partners].map(([n, c]) => ({ name: n, n: c })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ja')).slice(0, 3);
  return out;
}
