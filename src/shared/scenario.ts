// シナリオの通過と、遊べる日の計算。画面（シナリオのタブ・卓の窓）とサーバー（通過の印を外せるか）の両方で使う。
// 通過は、本人や管理者が付けた印（ConsoleScenario.marks）と、「終了」の卓から出すもの（そのシナリオの卓のGMと参加者）を合わせたもの
import type { ScenarioMark } from './api';
import { gmsOf } from './gm';
import { type AvailParts, bookedAt, type BookedParts, markAt, type Part, PARTS } from './parts';

/** 計算に使う卓の形。scenarioIdは無ければ空、dateは無ければ空。absentは行けなくなった参加者（遊んでいないので通過にしない） */
export type ScenarioSession = { id: string; scenarioId: string; status: string; date: string; gm: string; coGms?: string[]; members: string[]; absent?: { name: string }[] };

/** 通過。fromは、卓から出した通過なら、その卓のID（S012）。印だけなら空（外せる） */
export type Pass = { kind: ScenarioMark; from: string };

/** 印の強さ。gm（中身を知っている）のほうが強い */
const stronger = (a: ScenarioMark | undefined, b: ScenarioMark): ScenarioMark => (a === 'gm' || b === 'gm' ? 'gm' : 'played');

/** 「終了」の卓から出す通過{ 名前: Pass }。GM（共同GMも）はgm、参加者はplayed（行けなくなった人は除く）。namesに無い名前（メンバーでない人）は数えない */
export function sessionPasses(scenarioId: string, sessions: ScenarioSession[], names: Set<string>): Record<string, Pass> {
  const out: Record<string, Pass> = {};
  const put = (name: string, kind: ScenarioMark, from: string) => {
    if (!names.has(name)) return;
    const cur = out[name];
    out[name] = cur ? { kind: stronger(cur.kind, kind), from: cur.from } : { kind, from };
  };
  for (const s of sessions) {
    if (!scenarioId || s.scenarioId !== scenarioId || s.status !== '終了') continue;
    for (const n of gmsOf({ gm: s.gm, coGms: s.coGms ?? [] })) put(n, 'gm', s.id);
    for (const m of s.members) if (!(s.absent ?? []).some((a) => a.name === m)) put(m, 'played', s.id);
  }
  return out;
}

/** 通過をまとめる{ 名前: Pass }。印と卓からの通過のうち、強いほう。fromは卓から出した通過があれば、その卓 */
export function passesOf(scenario: { id: string; marks: Record<string, ScenarioMark> }, sessions: ScenarioSession[], names: Set<string>): Record<string, Pass> {
  const out = sessionPasses(scenario.id, sessions, names);
  for (const [name, kind] of Object.entries(scenario.marks)) {
    if (!names.has(name)) continue;
    const cur = out[name];
    out[name] = { kind: stronger(cur?.kind, kind), from: cur?.from ?? '' };
  }
  return out;
}

/** これから遊ぶ予定の人{ 名前: 卓のID }。そのシナリオの「開催」「調整中」の卓のGM（共同GMも）と参加者 */
export function plannedOf(scenarioId: string, sessions: ScenarioSession[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sessions) {
    if (!scenarioId || s.scenarioId !== scenarioId || (s.status !== '開催' && s.status !== '調整中')) continue;
    for (const n of [...gmsOf({ gm: s.gm, coGms: s.coGms ?? [] }), ...s.members]) if (n && !out[n]) out[n] = s.id;
  }
  return out;
}

/** 遊べる日の1日分。partは時間帯（昼と夜に分けないグループは ''）。playersはPLにできる人、maybeは △ の人、gmsはGMにできる人。okはその日に卓を立てられるか */
export type DayPlan = { date: string; part: Part | ''; players: string[]; maybe: string[]; gms: string[]; ok: boolean };

/**
 * 遊べる日。
 * PLに数えるのは、通過していない・予定に入っていない・その日に × が無い・その日にほかの卓が無い人（△ の人はmaybeに分ける）。
 * GMに数えるのは、gmの通過がある人で、その日に × が無く、ほかの卓が無い人（△ でもGMに数える）。
 * okは、PL（△ を除く）が下限（無ければ1人）以上で、GMにできる人が1人以上いる日。だれもGMの印を持っていなければ、GMは問わない
 */
export function playableDays(input: {
  days: string[];
  members: string[];
  passes: Record<string, Pass>;
  planned: Record<string, string>;
  /** { 日: { 名前: '△' | '×' } } */
  avail: Record<string, Record<string, string>>;
  /** 昼と夜に分けて入れた印 */
  availParts: AvailParts;
  /** 卓に入っている時間帯 */
  booked: BookedParts;
  min: number | null;
  /** 昼と夜に分けるグループなら、日ごとに昼と夜を別々に数える */
  dayParts: boolean;
}): DayPlan[] {
  const gmKnown = Object.values(input.passes).some((p) => p.kind === 'gm');
  const need = input.min ?? 1;
  const parts: (Part | '')[] = input.dayParts ? PARTS : [''];
  return input.days.flatMap((date) => parts.map((part) => {
    const players: string[] = [], maybe: string[] = [], gms: string[] = [];
    for (const name of input.members) {
      const mark = markAt(input.avail, input.availParts, date, name, part);
      if (mark === '×' || bookedAt(input.booked, date, name, part)) continue;
      const pass = input.passes[name];
      if (pass) {
        if (pass.kind === 'gm') gms.push(name);
        continue;
      }
      if (input.planned[name]) continue;
      (mark === '△' ? maybe : players).push(name);
    }
    return { date, part, players, maybe, gms, ok: players.length >= need && (!gmKnown || gms.length > 0) };
  }));
}
