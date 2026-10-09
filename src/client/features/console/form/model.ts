// 卓の登録の窓と変更の窓で共通の決まり（入力の形・サーバーへ送る形・重なりの注意・状態ごとの手順・シリーズの引き継ぎ）
import { CAPACITY_MAX, type ConsoleData, type ConsoleSession, SESSION_DATES_MAX } from '../../../../shared/api';
import { partOf } from '../../../../shared/parts';
import { passesOf } from '../../../../shared/scenario';
import type { IconName } from '../../../ui/icons';
import { addDaysYmd, fmtJa, parseYmd, ymdOf } from '../model/dates';
import { bookedOn, isActive, markOn, me, peopleOf, sortSessions, splitNames, STATUS_DATED } from '../model/model';
import { hookFor, kindSet, seriesHook, snEntry } from '../model/notify';
import { CO_GM_MAX } from '../../../../shared/gm';

/** 窓の入力。idは変える卓（新しく登録するなら空） */
export type Fields = {
  id: string; series: string; seriesEnd: string; name: string; status: string; date: string; start: string; end: string;
  winFrom: string; winTo: string; gm: string; members: string[]; extra: string; place: string; memo: string; notify: boolean;
  /** 共同GM（「、」区切り） */
  coGms: string;
  /** 遊ぶシナリオ（ConsoleScenarioのid）。無ければ空 */
  scenarioId: string;
  /** まとめて登録する日（開催日のほかに足した日） */
  more: { key: number; v: string }[];
  /** 募集の定員（空なら決めない）と締め切り（空なら決めない）。募集の卓だけ */
  capacity: string; recruitDue: string;
};
/** 窓の下の文。clsは 'ok'（案内）・'err'（失敗） */
export type Msg = { text: string; cls: 'ok' | 'err' } | null;

/** 状態ごとの説明と手順。登録の窓では選んだ状態の手順を、変更の窓では状態を変えたときに説明を出す */
export const FLOW: Record<string, { icon: IconName; lead: string; steps: string[] }> = {
  '開催': { icon: 'event', lead: '日が決まっている卓', steps: [
    '開催日と時間を入れる（何日か続けるなら「日を足す」）',
    'GMと参加者を選ぶ。× の人がいれば下に注意が出る',
    '登録する。「Discordに知らせる」で告知、開催前には開催前の知らせ'] },
  '募集': { icon: 'campaign', lead: 'メンバーを集める卓（日はまだ決めない）', steps: [
    '開きたい期間を入れて登録する（「Discordに知らせる」で告知）',
    '「参加希望」「興味あり」が付くのを待つ。「興味ありの人に聞く」で声もかけられる',
    '集まったら「開催」か「調整中」にする。参加希望の人は参加者に入る'] },
  '調整中': { icon: 'edit_calendar', lead: 'メンバーは決まった。みんなで日を選ぶ卓', steps: [
    '参加者と候補の期間を入れて登録する',
    '候補日を選んで聞く（登録するとそのまま窓が開く）',
    '参加者が ◯・△・× で答える。全員が答えるとGMに知らせが届く',
    'GMが「この日に決める」で開催日を選ぶ。状態は「開催」になる'] },
  '終了': { icon: 'task_alt', lead: '終わった卓。カレンダーには灰色で残る', steps: [] },
  '中止': { icon: 'block', lead: '開けなくなった卓。カレンダーには残り、開催前の知らせは送らない', steps: [] },
};
/** 新しく登録するときに選べる状態（終了・中止の卓は、登録してから変える）。labelは札の短い説明 */
export const KINDS: { status: string; label: string }[] = [
  { status: '開催', label: '日が決まっている' },
  { status: '募集', label: 'メンバーを集める' },
  { status: '調整中', label: 'みんなで日を決める' },
];

/** 「灰の街 #3」→「灰の街」。単発の卓から続けるとき、シリーズ名の下敷きにする */
export function baseSeriesName(name: string): string { return String(name || '').replace(/[\s　]*[#＃]?\s*\d+\s*$/, '').trim() || String(name || ''); }
/** 名前の末尾の数字を1つ進める。「#1」→「#2」「第3回」→「第4回」。数字が無ければ「（続き）」 */
export function nextName(name: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  if (m) return m[1]! + (parseInt(m[2]!, 10) + 1) + m[3]!;
  return name + '（続き）';
}
function seriesLatest(d: ConsoleData, name: string): ConsoleSession | null {
  const list = sortSessions(d.sessions.filter((s) => s.series === name));
  if (!list.length) return null;
  const dated = list.filter((s) => s.date);
  return dated.length ? dated[dated.length - 1]! : list[list.length - 1]!;
}
/** 参加者を、メンバーのチェックと「その他」の欄に分ける */
function splitMembers(d: ConsoleData, list: string[]): { members: string[]; extra: string } {
  const names = d.members.map((m) => m.name), members: string[] = [], extra: string[] = [];
  (list || []).forEach((n) => { if (names.indexOf(n) >= 0) members.push(n); else extra.push(n); });
  return { members, extra: extra.join('、') };
}
/** 送り先（Discordに知らせる）があるか */
export const canNotify = (d: ConsoleData, f: Pick<Fields, 'series' | 'status'>) => hookFor(d, f.series.trim(), f.status === '募集' ? 'recruit' : '');
/** 「Discordに知らせる」の横に出す、送り先の説明 */
export function notifyHint(d: ConsoleData, f: Pick<Fields, 'series' | 'status'>): string {
  const kind = f.status === '募集' ? 'recruit' : '', e = seriesHook(d, f.series.trim()) ? snEntry(d, f.series.trim()) : null;
  const baseName = kindSet(d, kind) ? '募集のチャンネル' : '基本のチャンネル', baseOk = kindSet(d, kind) || !!d.channelSet;
  return !canNotify(d, f) ? '（チャンネル未設定）' : e ? (e.alsoBase && baseOk ? '（シリーズのチャンネルと' + baseName + 'へ）' : '（シリーズのチャンネルへ）') : kindSet(d, kind) ? '（募集のチャンネルへ）' : '';
}

/** 卓から入力を作る（無ければ空の新規） */
export function fieldsOf(d: ConsoleData, s: ConsoleSession | null): Fields {
  const f: Fields = {
    id: s ? s.id : '', series: s ? (s.series || '') : '', seriesEnd: s ? (s.seriesEnd || '') : '', name: s ? s.name : '', status: s ? s.status : '開催',
    date: s ? s.date : '', start: s ? s.start : '', end: s ? s.end : '', winFrom: s ? (s.windowFrom || '') : '', winTo: s ? (s.windowTo || '') : '',
    gm: s ? s.gm : '', coGms: s ? s.coGms.join('、') : '', ...splitMembers(d, s ? s.members : []), place: s ? s.place : '', memo: s ? s.memo : '', notify: false, more: [],
    scenarioId: s ? s.scenarioId : '', capacity: s && s.capacity ? String(s.capacity) : '', recruitDue: s ? s.recruitDue : '',
  };
  f.notify = canNotify(d, f) && !!d.notifyDefault;
  return f;
}
/** 入力を変える。送り先が無くなったら「Discordに知らせる」を外し、送れるようになったら既定に戻す */
export function patchFields(d: ConsoleData, cur: Fields, patch: Partial<Fields>): Fields {
  const next = { ...cur, ...patch };
  // 募集の卓でシナリオを選んだら、定員が空ならシナリオのPLの人数（上限）を入れる
  const sc = patch.scenarioId ? d.scenarios.find((x) => x.id === patch.scenarioId) : undefined;
  if (sc && sc.playersMax && next.status === '募集' && !next.capacity.trim()) next.capacity = String(sc.playersMax);
  const before = canNotify(d, cur), after = canNotify(d, next);
  if (!after) next.notify = false; else if (!before) next.notify = !!d.notifyDefault;
  return next;
}
/** シリーズを選んだら、直前の回のGM・参加者・時間・場所・メモを引き継ぐ（新しく登録するときだけ）。直前の回が無ければnull */
export function inheritSeries(d: ConsoleData, base: Fields, name: string): { f: Fields; msg: string } | null {
  const t = seriesLatest(d, name);
  if (!t || base.id) return null;
  const cur = base.name.trim();
  return {
    f: { ...base, gm: t.gm, coGms: t.coGms.join('、'), ...splitMembers(d, t.members), place: t.place, memo: t.memo, start: t.start, end: t.end, scenarioId: t.scenarioId,
      name: !cur || /#\d+$/.test(cur) || cur === t.name ? name + ' #' + (d.sessions.filter((x) => x.series === name).length + 1) : base.name },
    msg: '「' + name + '」の直前の回（' + t.name + '）からGM・参加者・時間・場所・メモを引き継ぎました。名前と開催日を確かめてください。',
  };
}
/** 卓の設定を引き継ぎ、翌日の卓を新しく登録する形にする。単発の卓から続けるときは、この回からシリーズにまとめる（前の回にも同じ名前が入る） */
export function continueFrom(d: ConsoleData, src: ConsoleSession): { f: Fields; seriesFrom: string; msg: string } {
  const base = fieldsOf(d, src);
  const date = src.date ? addDaysYmd(src.date, 1) : '';
  const series = src.series ? base.series : baseSeriesName(src.name);
  return {
    f: { ...base, id: '', name: nextName(src.name), date, status: date ? '開催' : base.status, series },
    seriesFrom: src.series ? '' : src.id,
    msg: '「' + src.name + '」のGM・参加者・時間・場所を引き継いでいます。' + (src.series ? '' : '前の回と合わせて「' + series + '」というシリーズにします。') + '名前と開催日を確かめて登録してください。',
  };
}

/** くり返しの決まり。week は毎週、week2 は2週ごと、month は毎月の同じ「第N曜日」 */
export type Repeat = 'week' | 'week2' | 'month';
export const REPEATS: { v: Repeat; label: string }[] = [{ v: 'week', label: '毎週' }, { v: 'week2', label: '2週ごと' }, { v: 'month', label: '毎月（同じ第N曜日）' }];

/** その日が、その月の第何の曜日か（1から） */
function nthOf(ymd: string): number { return Math.ceil(+ymd.slice(8, 10) / 7); }
/** y年m月（mは1から）の、第nの曜日dow。その月に無ければ空 */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
  const first = new Date(y, m - 1, 1).getDay(), day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return day <= new Date(y, m, 0).getDate() ? ymdOf(y, m - 1, day) : '';
}
/**
 * 開催日からくり返して、続きの日をcount回分（開催日を含まない）作る。毎月で「第5の曜日」が無い月は飛ばす。
 * どれも開催日より後の日
 */
export function repeatDates(from: string, rule: Repeat, count: number): string[] {
  const out: string[] = [];
  if (rule === 'month') {
    const p = parseYmd(from), dow = p.getDay(), n = nthOf(from);
    for (let i = 1; out.length < count && i <= count + 12; i++) {
      const t = new Date(p.getFullYear(), p.getMonth() + i, 1), k = nthWeekday(t.getFullYear(), t.getMonth() + 1, dow, n);
      if (k) out.push(k);
    }
    return out;
  }
  const step = rule === 'week' ? 7 : 14;
  for (let i = 1; i <= count; i++) out.push(addDaysYmd(from, step * i));
  return out;
}

/** 窓の中身（保存するときにサーバーへ送る形） */
export function collect(d: ConsoleData, f: Fields, seriesFrom: string) {
  const st = f.status, rec = st === '募集', adj = st === '調整中', noDate = rec || adj;   // 募集と調整中は開催日と時刻を持たない
  const seen: Record<string, boolean> = {}, all: string[] = [];
  [f.date].concat(f.more.map((x) => x.v)).forEach((x) => { if (x && !seen[x]) { seen[x] = true; all.push(x); } });
  all.sort();
  const ds = !noDate && !f.id ? all : [];
  return {
    id: f.id, name: f.name, gm: f.gm, coGms: splitNames(f.coGms), me: me(d), members: rec ? [] : d.members.map((m) => m.name).filter((n) => f.members.indexOf(n) >= 0), extra: rec ? '' : f.extra, series: f.series.trim(),
    seriesEnd: f.series.trim() ? f.seriesEnd : '', seriesFrom,
    dates: ds.length > 1 ? ds : undefined,
    date: noDate ? '' : f.date, start: noDate ? '' : f.start, end: noDate ? '' : f.end, status: st,
    windowFrom: noDate ? f.winFrom : '', windowTo: noDate ? f.winTo : '',
    place: f.place, memo: f.memo, notify: f.notify, scenarioId: f.scenarioId,
    capacity: rec ? f.capacity.trim() : '', recruitDue: rec ? f.recruitDue : '',
  };
}
export type SessionForm = ReturnType<typeof collect>;

/** 保存の前の確かめ。だめなら理由、よければ空。期間の前後が逆なら入れ替える */
export function checkForm(form: SessionForm): string {
  if (!form.name.trim()) return '卓の名前を入れてください。';
  if (form.coGms.length && !form.gm.trim()) return '共同GMを入れるときは、GMも入れてください。';
  if (form.coGms.length > CO_GM_MAX) return '共同GMは' + CO_GM_MAX + '人までです。';
  if (!form.date && STATUS_DATED.indexOf(form.status) >= 0) return '開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。';
  if (form.dates && form.dates.length > SESSION_DATES_MAX) return 'まとめて登録できるのは' + SESSION_DATES_MAX + '日分までです。';
  if (!!form.windowFrom !== !!form.windowTo) return '期間は、始まりと終わりの両方の日を入れてください。';
  if (form.capacity && !(/^\d+$/.test(form.capacity) && +form.capacity >= 1 && +form.capacity <= CAPACITY_MAX)) return '定員は1〜' + CAPACITY_MAX + '人で入れてください（決めないなら空のまま）。';
  if (form.windowFrom && form.windowTo && form.windowFrom > form.windowTo) { const wx = form.windowFrom; form.windowFrom = form.windowTo; form.windowTo = wx; }
  return '';
}

/** 同じ日の重なりを探して注意を出す。× や △ を付けている人も拾う。登録は止めない（あとで直すこともあるため） */
export function conflictText(d: ConsoleData, form: SessionForm): string {
  if (!form.date) return '';
  const people = [String(form.gm || '').trim()].concat(form.coGms, form.members || [], splitNames(form.extra)).filter(Boolean);
  const uniq: string[] = [], busyAt: string[] = [], ng: string[] = [], soft: string[] = [];
  people.forEach((n) => { if (uniq.indexOf(n) < 0) uniq.push(n); });
  // 昼と夜に分けるグループでは、開始時刻の時間帯で見る（ほかの時間帯の卓や印は重ならない）
  const part = d.settings.dayParts ? partOf(form.start) : '';
  uniq.forEach((n) => {
    d.sessions.forEach((s) => {
      if (!s.date || s.date !== form.date || s.id === form.id || !isActive(s)) return;
      const sp = d.settings.dayParts ? partOf(s.start) : '';
      if (part && sp && sp !== part) return;
      if (peopleOf(s).indexOf(n) >= 0) busyAt.push(n + '（' + s.name + '）');
    });
    // ほかのグループの卓（名前は分からない）
    if ((d.booked[form.date] || {})[n] === '他' && bookedOn(d, form.date, n, part)) busyAt.push(n + '（ほかのグループの卓）');
    const v = markOn(d, form.date, n, part);
    if (v === '×') ng.push(n); else if (v === '△') soft.push(n);
  });
  const parts: string[] = [];
  if (busyAt.length) parts.push('同じ日に別の卓に入っています: ' + busyAt.join('、'));
  if (ng.length) parts.push('この日に × を付けています: ' + ng.join('、'));
  if (soft.length) parts.push('この日に △ を付けています: ' + soft.join('、'));
  return parts.length ? fmtJa(form.date) + '　' + parts.join('　／　') : '';
}

/**
 * シナリオを通過した人が、参加者に入っていれば注意する（PLとしては遊べないため。GMはよい）。登録は止めない。
 * 変える卓そのものから出る通過（終了の卓）は数えない
 */
export function passWarnText(d: ConsoleData, form: SessionForm): string {
  const sc = form.scenarioId ? d.scenarios.find((x) => x.id === form.scenarioId) : undefined;
  if (!sc) return '';
  const passes = passesOf(sc, d.sessions.filter((s) => s.id !== form.id), new Set(d.members.map((m) => m.name)));
  const gm = String(form.gm || '').trim();
  const hit = (form.members || []).concat(splitNames(form.extra)).filter((n, i, a) => a.indexOf(n) === i && n !== gm && form.coGms.indexOf(n) < 0 && passes[n]);
  return hit.length ? '「' + sc.name + '」を通過している人が参加者にいます: ' + hit.map((n) => n + (passes[n]!.kind === 'gm' ? '（GMできる）' : '')).join('、') : '';
}
