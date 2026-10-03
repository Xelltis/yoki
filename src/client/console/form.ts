// 卓の登録・変更の窓。シリーズの引き継ぎ・何日分かのまとめ登録・重なりの注意・保存と削除
import type { ConsoleSession } from '../../shared/api';
import { api, discordSend, failToast, refetch, useData } from './api';
import { renderCal } from './calendar';
import { addDaysYmd, fmtJa, parseYmd, winLabel } from './dates';
import { $, esc, hit, mi, toast } from './dom';
import { askConfirm } from './modal';
import { STATUS_DATED, STATUS_PROMOTE, byId, hasPoll, isActive, isRecruit, me, peopleOf, pickLabel, sortSessions, splitNames } from './model';
import { renderNotices } from './notices';
import { hookFor, kindSet, seriesHook, snEntry } from './notify';
import { renderOps } from './ops';
import { openPoll } from './poll';
import { askPromote, takePromoteAdd } from './promote';
import { renderRecruit } from './recruit';
import { D, selDay, setSelDay } from './state';

export function openForm(): void {
  // 前の書き込みの返事が来ないまま押せなくなっていたら、ここで戻す
  if ($('save').disabled) { busy(false); if ($('msg').textContent === '保存しています…') { $('msg').textContent = ''; $('msg').className = ''; } }
  $('formTitle').textContent = $('pick').value ? '卓を変更' : '卓を登録';
  $('formModal').hidden = false;
  $('formModal').querySelector('.box')!.scrollTop = 0;
  $('name').focus();
}
function closeForm(): void { $('formModal').hidden = true; }
/** 「卓を登録」の隣の「募集を始める」「日程調整を始める」。状態を入れた登録の窓を開く（日付は持たない） */
export function openNewWithStatus(st: string): void { fillForm(''); $('status').value = st; syncStatusUi(); openForm(); }
/** 「＋卓を登録」の名前。カレンダーで日を選んでいれば、その日の卓になる */
export function syncNewSessionLabel(): void {
  const d = selDay ? parseYmd(selDay) : null;
  $('newSessionLbl').textContent = d ? (d.getMonth() + 1) + '/' + d.getDate() + ' に卓を登録' : '卓を登録';
  $('newSession').title = d ? fmtJa(selDay) + ' の卓を登録します' : 'カレンダーで日を選んでから押すと、その日の卓になります。日付の無い卓（募集・調整中）もここから登録できます';
}

/** 単発の卓から「続けて登録」したときの、前の回の ID */
let seriesFrom = '';

export function fillForm(id: string): void {
  const s = byId(id);
  // 終了卓は一覧に出さない。ほかの画面から編集を開いたときだけ、その 1 件を足す
  const pk = $<HTMLSelectElement>('pick');
  for (let oi = pk.options.length - 1; oi >= 1; oi--) {
    const sx = byId(pk.options[oi]!.value);
    if (sx && sx.status === '終了' && sx.id !== id) pk.remove(oi);
  }
  if (s && !Array.prototype.some.call(pk.options, (o: HTMLOptionElement) => o.value === s.id)) {
    const op = document.createElement('option');
    op.value = s.id; op.textContent = pickLabel(s);
    pk.appendChild(op);
  }
  pk.value = s ? s.id : '';
  $('series').value = s ? (s.series || '') : '';
  $('moreDates').innerHTML = ''; $('moreDatesHint').textContent = '';
  $('name').value = s ? s.name : ''; $('gm').value = s ? s.gm : ''; $('date').value = s ? s.date : '';
  $('start').value = s ? s.start : ''; $('end').value = s ? s.end : ''; $('status').value = s ? s.status : '開催';
  $('place').value = s ? s.place : ''; $('memo').value = s ? s.memo : '';
  $('winFrom').value = s ? (s.windowFrom || '') : ''; $('winTo').value = s ? (s.windowTo || '') : '';
  $('seriesEnd').value = s ? (s.seriesEnd || '') : '';
  seriesFrom = '';
  syncStatusUi();
  setMembers(s ? s.members : []);
  $('del').hidden = !s; $('cont').hidden = !s; syncSaveLabel();
  $('formTitle').textContent = s ? '卓を変更' : '卓を登録';
  $('msg').textContent = ''; $('msg').className = '';
}
/** 参加者のチェックを入れる。メンバーに無い名前は「その他」の欄へ */
function setMembers(list: string[]): void {
  const cbs = document.querySelectorAll<HTMLInputElement>('input.m'), extra: string[] = [];
  cbs.forEach((cb) => { cb.checked = false; });
  (list || []).forEach((n) => {
    let found = false;
    cbs.forEach((cb) => { if (cb.value === n) { cb.checked = true; found = true; } });
    if (!found) extra.push(n);
  });
  $('extra').value = extra.join('、');
}

/* シリーズ（キャンペーン）。同じシリーズ名の卓を束ね、新しい回は直前の回から引き継ぐ */
/** 「灰の街 #3」→「灰の街」。単発の卓から続けるとき、シリーズ名の下敷きにする */
function baseSeriesName(name: string): string { return String(name || '').replace(/[\s　]*[#＃]?\s*\d+\s*$/, '').trim() || String(name || ''); }
function syncSeriesUi(): void { $('seriesEndWrap').hidden = !$('series').value.trim(); syncNotifyUi(false); }
function seriesLatest(name: string): ConsoleSession | null {
  const list = sortSessions(D.sessions.filter((s) => s.series === name));
  if (!list.length) return null;
  const dated = list.filter((s) => s.date);
  return dated.length ? dated[dated.length - 1]! : list[list.length - 1]!;
}
function nextSeriesName(name: string): string { return name + ' #' + (D.sessions.filter((s) => s.series === name).length + 1); }
/** シリーズを選んだら、直前の回の GM・参加者・時間・場所・メモを引き継ぐ（新規のときだけ） */
export function applySeries(name: string): void {
  const t = seriesLatest(name);
  if (!t || $('pick').value) return;
  $('gm').value = t.gm; setMembers(t.members); $('place').value = t.place; $('memo').value = t.memo; $('start').value = t.start; $('end').value = t.end;
  const cur = $('name').value.trim();
  if (!cur || /#\d+$/.test(cur) || cur === t.name) $('name').value = nextSeriesName(name);
  showMsg('「' + name + '」の直前の回（' + t.name + '）から GM・参加者・時間・場所・メモを引き継ぎました。名前と開催日を確かめてください。', false);
}

/* 複数日のまとめ登録。新規で「開催」のときだけ */
function extraDates(): string[] {
  const out: string[] = [];
  document.querySelectorAll<HTMLInputElement>('#moreDates input.xdate').forEach((el) => { if (el.value) out.push(el.value); });
  return out;
}
function allDates(): string[] {
  const seen: Record<string, boolean> = {}, out: string[] = [];
  [$('date').value].concat(extraDates()).forEach((d) => { if (d && !seen[d]) { seen[d] = true; out.push(d); } });
  return out.sort();
}
function updateDatesHint(): void {
  const n = allDates().length;
  $('moreDatesHint').textContent = n > 1 ? n + ' 日分をまとめて登録します。名前は末尾の数字を進めます（「#1」→「#2」）。数字が無ければ「名前 #1」「名前 #2」' : '';
}

/** 状態に合わせて、開催日の行と期間の行を切り替える。募集中の卓には参加希望・興味ありの人を見せる */
export function syncStatusUi(): void {
  const st = $('status').value, rec = st === '募集', adj = st === '調整中', s = byId($('pick').value);
  $('dateRow').hidden = rec || adj; $('windowRow').hidden = !rec && !adj;
  $('winLbl').textContent = rec ? '開きたい期間' : '候補の期間';
  $('winHint').textContent = rec ? 'この幅のどこかで開きたい、という目安。空なら未定' : 'この期間のどこかで開く。空なら未定';
  $('membersRow').hidden = rec;   // 募集は、これから集めるので参加者を書かない
  syncSeriesUi();
  showConflicts();
  $('moreDatesWrap').hidden = rec || adj || !!$('pick').value;
  if ($('moreDatesWrap').hidden) { $('moreDates').innerHTML = ''; $('moreDatesHint').textContent = ''; }
  let info = '';
  if (s && isRecruit(s) && (s.want.length || s.interest.length)) {
    info = '参加希望: ' + (s.want.length ? esc(s.want.join('、')) : 'なし') + '　／　興味あり: ' + (s.interest.length ? esc(s.interest.join('、')) : 'なし');
    if (STATUS_PROMOTE.indexOf(st) >= 0 && s.want.length) info += '<br>状態を「' + esc(st) + '」にして保存すると、参加希望の人が参加者に加わります。';
  }
  $('wantInfo').innerHTML = info; $('wantInfo').hidden = !info;
  renderFlow(); syncSaveLabel();
}
/** 卓の登録画面の「Discord に知らせる」。シリーズの欄に合わせて、押せるかと送り先を変える */
export function syncNotifyUi(reset: boolean): void {
  const series = $('series').value.trim(), kind = $('status').value === '募集' ? 'recruit' : '', can = hookFor(series, kind), wasOff = $('notify').disabled, e = seriesHook(series) ? snEntry(series) : null;
  const baseName = kindSet(kind) ? '募集のチャンネル' : '基本のチャンネル', baseOk = kindSet(kind) || !!D.webhookSet;
  $('notify').disabled = !can;
  if (!can) $('notify').checked = false;
  else if (reset || wasOff) $('notify').checked = !!D.notifyDefault;
  $('notifyHint').textContent = !can ? '（Webhook 未設定）' : e ? (e.alsoBase && baseOk ? '（シリーズのチャンネルと' + baseName + 'へ）' : '（シリーズのチャンネルへ）') : kindSet(kind) ? '（募集のチャンネルへ）' : '';
}

/** 状態ごとの手順。状態を選んだ時点で、何をすればよいかを窓の中に出す */
const FLOW: Record<string, { icon: string; lead: string; steps: string[] }> = {
  '開催': { icon: 'event', lead: '日が決まっている卓', steps: [
    '開催日と時間を入れる（何日か続けるなら「日を足す」）',
    'GM と参加者を選ぶ。× の人がいれば下に注意が出る',
    '登録する。「Discord に知らせる」で告知、開催前には開催前の知らせ'] },
  '募集': { icon: 'campaign', lead: 'メンバーを集める卓（日はまだ決めない）', steps: [
    '開きたい期間を入れて登録する（「Discord に知らせる」で告知）',
    '「参加希望」「興味あり」が付くのを待つ。「興味ありの人に聞く」で声もかけられる',
    '集まったら「開催」か「調整中」にする。参加希望の人は参加者に入る'] },
  '調整中': { icon: 'edit_calendar', lead: 'メンバーは決まった。みんなで日を選ぶ卓', steps: [
    '参加者と候補の期間を入れて保存する',
    '候補日を選んで聞く（保存するとそのまま窓が開く）',
    '参加者が ◯ か × を押す。全員が答えると GM に知らせが届く',
    'GM が「この日に決める」で開催日を選ぶ。状態は「開催」になる'] },
  '終了': { icon: 'task_alt', lead: '終わった卓。カレンダーには灰色で残る', steps: [] },
  '中止': { icon: 'block', lead: '開けなくなった卓。カレンダーには残り、開催前の知らせは送らない', steps: [] },
};
function renderFlow(): void {
  const box = $('flowGuide'), st = $('status').value, f = FLOW[st], s = byId($('pick').value);
  if (!f) { box.hidden = true; box.innerHTML = ''; return; }
  // いまの段。新しい卓や、状態を切り替えたところは 1 段目。今のままの状態なら、進み具合から決める
  let now = 0;
  if (s && s.status === st) {
    if (st === '募集') now = s.want.length || s.interest.length ? 2 : 1;
    else if (st === '調整中') now = hasPoll(s) ? 2 : 1;
    else now = -1;
  }
  let html = '<div class="flow-head">' + mi(f.icon, 'sm') + '<b>「' + esc(st) + '」は、' + esc(f.lead) + '</b>' + (f.steps.length ? '<span class="hint">この順で進めます</span>' : '') + '</div>';
  if (f.steps.length) {
    html += '<ol>' + f.steps.map((t, i) => {
      const cls = now < 0 ? '' : i < now ? 'done' : i === now ? 'now' : '';
      return '<li class="' + cls + '"><span class="n">' + (cls === 'done' ? mi('check', 'sm') : i + 1) + '</span><div>' + esc(t) + (cls === 'now' ? '<span class="tag">いまここ</span>' : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  box.innerHTML = html; box.hidden = false;
}
/** 保存ボタンの名前。調整中でまだ候補日を出していなければ、保存のあとに候補日を選ぶ窓を開く */
function pollNext(): boolean { const s = byId($('pick').value); return $('status').value === '調整中' && !(s && hasPoll(s)); }
function syncSaveLabel(): void {
  const s = byId($('pick').value);
  $('save').textContent = pollNext() ? (s ? '更新して候補日を選ぶ' : '登録して候補日を選ぶ') : (s ? '更新' : '登録');
}
/** 保存の返事で新しい卓が画面のデータに入ってから、候補日を選ぶ窓を開く */
function openPollWhenReady(id: string, n = 20): void {
  const s = byId(id);
  if (s && String(s.id).indexOf('__tmp__') !== 0 && $('formModal').hidden && $('pollModal').hidden) { openPoll(id); return; }
  if (n > 0) setTimeout(() => { openPollWhenReady(id, n - 1); }, 250);
}
/** 名前の末尾の数字を 1 つ進める。「#1」→「#2」「第3回」→「第4回」。数字が無ければ「（続き）」 */
function nextName(name: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  if (m) return m[1]! + (parseInt(m[2]!, 10) + 1) + m[3]!;
  return name + '（続き）';
}
/** 編集中の卓の設定を引き継ぎ、翌日の卓を新規登録する形にする */
export function continueFrom(id: string): void {
  const s = byId(id); if (!s) return;
  fillForm(s.id);
  $('pick').value = '';
  $('name').value = nextName(s.name);
  $('date').value = s.date ? addDaysYmd(s.date, 1) : '';
  if ($('date').value) $('status').value = '開催';
  // 単発の卓から続けるときは、この回からシリーズにまとめる（前の回にも同じ名前が入る）
  if (!s.series) { $('series').value = baseSeriesName(s.name); seriesFrom = s.id; } else seriesFrom = '';
  syncSeriesUi();
  syncStatusUi();
  $('del').hidden = true; $('cont').hidden = true; syncSaveLabel();
  showMsg('「' + s.name + '」の GM・参加者・時間・場所を引き継いでいます。' + (s.series ? '' : '前の回と合わせて「' + $('series').value + '」というシリーズにします。') + '名前と開催日を確かめて登録してください。', false);
  openForm();
  $('name').focus();
}

/** 窓の中身（保存するときにサーバーへ送る形） */
type SessionForm = ReturnType<typeof collect>;
/**
 * 同じ日の重なりを探して注意を出す。× や △ を付けている人も拾う。
 * 登録は止めない（あとで直すこともあるため）
 */
function conflictText(form: SessionForm): string {
  if (!form.date || !D) return '';
  const people = [String(form.gm || '').trim()].concat(form.members || [], splitNames(form.extra)).filter(Boolean);
  const uniqPeople: string[] = [], busyAt: string[] = [], ng: string[] = [], soft: string[] = [];
  people.forEach((n) => { if (uniqPeople.indexOf(n) < 0) uniqPeople.push(n); });
  uniqPeople.forEach((n) => {
    D.sessions.forEach((s) => {
      if (!s.date || s.date !== form.date || s.id === form.id || !isActive(s)) return;
      if (peopleOf(s).indexOf(n) >= 0) busyAt.push(n + '（' + s.name + '）');
    });
    const v = ((D.avail || {})[form.date] || {})[n] || '';
    if (v === '×') ng.push(n); else if (v === '△') soft.push(n);
  });
  const parts: string[] = [];
  if (busyAt.length) parts.push('同じ日に別の卓に入っています: ' + busyAt.join('、'));
  if (ng.length) parts.push('この日に × を付けています: ' + ng.join('、'));
  if (soft.length) parts.push('この日に △ を付けています: ' + soft.join('、'));
  return parts.length ? fmtJa(form.date) + '　' + parts.join('　／　') : '';
}
function showConflicts(): void {
  const box = document.getElementById('conflictWarn');
  if (!box || $('formModal').hidden) { if (box) { box.hidden = true; box.innerHTML = ''; } return; }
  const text = conflictText(collect());
  box.innerHTML = text ? mi('warning', 'sm') + '<span>' + esc(text) + '</span>' : '';
  box.hidden = !text;
}
function collect() {
  const members: string[] = [];
  document.querySelectorAll<HTMLInputElement>('input.m').forEach((cb) => { if (cb.checked) members.push(cb.value); });
  const st = $('status').value, rec = st === '募集', adj = st === '調整中', noDate = rec || adj;   // 募集と調整中は開催日と時刻を持たない
  const ds = !noDate && !$('pick').value ? allDates() : [];
  return {
    id: $('pick').value, name: $('name').value, gm: $('gm').value, me: me(), members: rec ? [] : members, extra: rec ? '' : $('extra').value, series: $('series').value.trim(),
    seriesEnd: $('series').value.trim() ? $('seriesEnd').value : '', seriesFrom,
    dates: ds.length > 1 ? ds : undefined,
    date: noDate ? '' : $('date').value, start: noDate ? '' : $('start').value, end: noDate ? '' : $('end').value, status: st,
    windowFrom: noDate ? $('winFrom').value : '', windowTo: noDate ? $('winTo').value : '',
    place: $('place').value, memo: $('memo').value, notify: $('notify').checked,
  };
}
function busy(on: boolean): void { $('save').disabled = on; $('del').disabled = on; $('cont').disabled = on; if (on) { $('msg').textContent = '保存しています…'; $('msg').className = ''; } }
function showMsg(t: string, err: boolean): void { $('msg').textContent = t; $('msg').className = err ? 'err' : 'ok'; }

/** 保存。押した瞬間にカレンダーへ仮に出し、窓を閉じる。返事が来たら本物に置き換える */
function submit(ev: Event): void {
  ev.preventDefault();
  const form = collect();
  // 募集から開催・調整中に移すとき、興味ありの人がいれば先に確かめる
  const prevRec = byId(form.id);
  const promoted = takePromoteAdd();
  if (!promoted && prevRec && isRecruit(prevRec) && STATUS_PROMOTE.indexOf(form.status) >= 0 && prevRec.interest.length) {
    askPromote(prevRec, form.status, () => { $<HTMLFormElement>('f').requestSubmit(); });
    return;
  }
  if (promoted) promoted.forEach((n) => { if (form.members.indexOf(n) < 0) form.members.push(n); });
  if (!form.name.trim()) { showMsg('卓の名前を入れてください。', true); return; }
  if (!form.date && STATUS_DATED.indexOf(form.status) >= 0) { showMsg('開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。', true); return; }
  if (!!form.windowFrom !== !!form.windowTo) { showMsg('期間は、始まりと終わりの両方の日を入れてください。', true); return; }
  if (form.windowFrom && form.windowTo && form.windowFrom > form.windowTo) { const wx = form.windowFrom; form.windowFrom = form.windowTo; form.windowTo = wx; }
  busy(true);
  // 押した瞬間にカレンダーへ仮に出す。返事が来たら本物に置き換える。予定にするなら参加希望の人も参加者に入れておく
  const prev = byId(form.id), tmpMembers = form.members.concat(splitNames(form.extra)), toDated = STATUS_PROMOTE.indexOf(form.status) >= 0;
  if (prev && toDated) prev.want.forEach((n) => { if (tmpMembers.indexOf(n) < 0 && n !== form.gm.trim()) tmpMembers.push(n); });
  const tmp: ConsoleSession = {
    id: form.id || '__tmp__', name: form.name.trim(), gm: form.gm.trim(), members: tmpMembers,
    date: form.date, start: form.start, end: form.end, status: form.status as ConsoleSession['status'], place: form.place.trim(), memo: form.memo.trim(), notified: '', editor: form.me,
    want: prev && !toDated ? prev.want : [], interest: prev ? prev.interest : [], series: form.series, seriesEnd: form.seriesEnd, asked: '',
    window: '', windowFrom: form.windowFrom, windowTo: form.windowTo, windowLabel: winLabel(form.windowFrom, form.windowTo), windowKey: form.windowFrom || '',
    candidates: prev && form.status === '調整中' ? (prev.candidates || []) : [], votes: prev ? (prev.votes || {}) : {},
  };
  if (form.dates) {
    // 何日かまとめて。名前は末尾の数字を進める（サーバーと同じ決まり）
    const base = tmp.name, mm = /^(.*?)(\d+)(\D*)$/.exec(base);
    form.dates.forEach((d, i) => {
      const t: ConsoleSession = JSON.parse(JSON.stringify(tmp));
      t.id = '__tmp__' + i; t.date = d;
      t.name = i === 0 ? base : mm ? mm[1]! + (Number(mm[2]) + i) + mm[3]! : base + ' #' + (i + 1);
      D.sessions.push(t);
    });
  } else {
    let replaced = false;
    for (let ti = 0; ti < D.sessions.length; ti++) if (D.sessions[ti]!.id === tmp.id) { D.sessions[ti] = tmp; replaced = true; }
    if (!replaced) D.sessions.push(tmp);
  }
  if (form.date) setSelDay(form.date);
  renderNotices(); renderCal(); renderRecruit(); renderOps();
  // 窓は押した瞬間に閉じる。カレンダーには仮に出ている。結果は吹き出しで知らせる
  closeForm();
  toast('保存しています…');
  const wantNotify = form.notify, wasEdit = !!form.id, wantPoll = form.status === '調整中' && !(prev && hasPoll(prev));
  form.notify = false;   // Discord へは、保存が終わってから画面側が送る
  api().withSuccessHandler((res) => {
    busy(false);
    toast(res.message);
    useData(res, () => { if ($('formModal').hidden && res.id) { $('pick').value = res.id; fillForm(res.id); } });
    if (wantPoll && res.id) openPollWhenReady(res.id);
    if (!wantNotify) return;
    const req = res.ids && res.ids.length > 1 ? { kind: 'bulk', names: res.names, ids: res.ids, label: '登録', series: form.series, me: me() } : { kind: 'change', id: res.id, verb: wasEdit ? '変更' : '登録', me: me() };
    discordSend(req,
      (t) => { toast(t); },
      (ok, r) => { toast(ok ? 'Discord に送りました: ' + res.message.replace(/^.*?: /, '') : failToast(r)); });
  }).withFailureHandler((e) => {
    // 失敗したら、入力を残したまま窓を開き直す
    busy(false);
    D.sessions = D.sessions.filter((s) => String(s.id).indexOf('__tmp__') !== 0);
    $('formModal').hidden = false; showMsg(e.message, true); toast('保存できませんでした');
    refetch();
  }).saveSession(form);
}
/** 削除。押した瞬間にカレンダーから消し、窓を閉じる */
function remove(): void {
  const form = collect(); if (!form.id) return;
  askConfirm({ title: '卓を削除しますか？', message: '「' + form.name + '」を消します。元に戻せません。', ok: '削除する', danger: true }, () => {
    busy(true);
    D.sessions = D.sessions.filter((s) => s.id !== form.id);
    renderNotices(); renderCal(); renderRecruit(); renderOps();
    closeForm();
    toast('削除しています…');
    const delName = form.name, delSeries = form.series, delStatus = form.status, wantDelNotify = form.notify;
    api().withSuccessHandler((res) => {
      busy(false);
      toast(res.message);
      useData(res, () => { if ($('formModal').hidden) fillForm(''); });
      if (!wantDelNotify) return;
      discordSend({ kind: 'delete', name: delName, series: delSeries, status: delStatus, me: me() },
        (t) => { toast(t); },
        (ok, r) => { toast(ok ? 'Discord に送りました: ' + delName : failToast(r)); });
    }).withFailureHandler((e) => { busy(false); $('formModal').hidden = false; showMsg(e.message, true); toast('削除できませんでした'); refetch(); })
      .deleteSession({ id: form.id, me: form.me, notify: false });
  });
}

export function init(): void {
  $('formClose').onclick = closeForm;
  $('newSession').onclick = () => { fillForm(''); if (selDay) $('date').value = selDay; openForm(); };
  $('newRecruit').onclick = $('barRecruit').onclick = () => { openNewWithStatus('募集'); };
  $('newAdjust').onclick = $('barAdjust').onclick = () => { openNewWithStatus('調整中'); };
  $('series').addEventListener('input', syncSeriesUi);
  $('series').addEventListener('change', () => { applySeries($('series').value.trim()); });
  $('addDate').onclick = () => {
    const d = document.createElement('div');
    d.className = 'dline';
    d.innerHTML = '<input type="date" class="xdate"><button type="button" class="btn small xdel" title="この日を外す">×</button>';
    $('moreDates').appendChild(d); d.querySelector('input')!.focus();
  };
  $('moreDates').addEventListener('click', (ev) => { const b = hit(ev, '.xdel'); if (b) { (b.parentNode as Element).remove(); updateDatesHint(); } });
  $('moreDates').addEventListener('change', updateDatesHint);
  $('date').addEventListener('change', updateDatesHint);
  $('status').addEventListener('change', syncStatusUi);
  ['date', 'gm', 'extra', 'membersBox'].forEach((id) => { $(id).addEventListener('change', showConflicts); });
  $('gm').addEventListener('input', showConflicts);
  $('pick').addEventListener('change', () => { fillForm($('pick').value); });
  $('clear').onclick = () => { fillForm(''); };
  $('cont').onclick = () => { if ($('pick').value) continueFrom($('pick').value); };
  $('f').addEventListener('submit', submit);
  $('del').onclick = remove;
}
