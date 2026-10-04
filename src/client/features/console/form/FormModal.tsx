// 卓の登録・変更の窓。シリーズの引き継ぎ・何日分かのまとめ登録・重なりの注意・状態ごとの手順・保存と削除。
// 保存は押した瞬間にカレンダーへ仮に出して窓を閉じ、返事が来たら本物に置き換える。失敗したら入力を残したまま開き直す
import { useLayoutEffect, useRef, useState } from 'react';
import type { ConsoleData, ConsoleSession, RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import type { IconName } from '../../../ui/icons';
import { Modal } from '../../../ui/Modal';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { openPoll } from '../actions';
import { discordSend, failToast } from '../api/discord';
import { type FormReq, useConsole, useData } from '../context';
import { addDaysYmd, fmtJa, winLabel } from '../model/dates';
import { byId, hasPoll, isActive, isRecruit, me, peopleOf, pickLabel, sortSessions, sortedActive, splitNames, STATUS_DATED, STATUS_PROMOTE } from '../model/model';
import { hookFor, kindSet, seriesHook, snEntry } from '../model/notify';
import { isTmp, TMP, withoutSession, withoutTmp, withSessions } from '../model/optimistic';
import { type PromoteAsk, PromoteModal } from './PromoteModal';
import { checkPill, checkPills } from '../styles';

/** 窓の入力 */
type Fields = {
  pick: string; series: string; seriesEnd: string; name: string; status: string; date: string; start: string; end: string;
  winFrom: string; winTo: string; gm: string; members: string[]; extra: string; place: string; memo: string; notify: boolean;
  /** まとめて登録する日（開催日のほかに足した日） */
  more: { key: number; v: string }[];
};
/** 窓の下の文。cls は 'ok'（案内）・'err'（失敗）・''（保存中） */
type Msg = { text: string; cls: '' | 'ok' | 'err' } | null;

/** 状態ごとの手順。状態を選んだ時点で、何をすればよいかを窓の中に出す */
const FLOW: Record<string, { icon: IconName; lead: string; steps: string[] }> = {
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

/** 「灰の街 #3」→「灰の街」。単発の卓から続けるとき、シリーズ名の下敷きにする */
function baseSeriesName(name: string): string { return String(name || '').replace(/[\s　]*[#＃]?\s*\d+\s*$/, '').trim() || String(name || ''); }
/** 名前の末尾の数字を 1 つ進める。「#1」→「#2」「第3回」→「第4回」。数字が無ければ「（続き）」 */
function nextName(name: string): string {
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
/** 送り先（Discord に知らせる）があるか */
const canNotify = (d: ConsoleData, f: Pick<Fields, 'series' | 'status'>) => hookFor(d, f.series.trim(), f.status === '募集' ? 'recruit' : '');
/** 卓から入力を作る（無ければ空の新規） */
function fieldsOf(d: ConsoleData, s: ConsoleSession | null): Fields {
  const f: Fields = {
    pick: s ? s.id : '', series: s ? (s.series || '') : '', seriesEnd: s ? (s.seriesEnd || '') : '', name: s ? s.name : '', status: s ? s.status : '開催',
    date: s ? s.date : '', start: s ? s.start : '', end: s ? s.end : '', winFrom: s ? (s.windowFrom || '') : '', winTo: s ? (s.windowTo || '') : '',
    gm: s ? s.gm : '', ...splitMembers(d, s ? s.members : []), place: s ? s.place : '', memo: s ? s.memo : '', notify: false, more: [],
  };
  f.notify = canNotify(d, f) && !!d.notifyDefault;
  return f;
}

/** 窓の中身（保存するときにサーバーへ送る形） */
function collect(d: ConsoleData, f: Fields, seriesFrom: string) {
  const st = f.status, rec = st === '募集', adj = st === '調整中', noDate = rec || adj;   // 募集と調整中は開催日と時刻を持たない
  const seen: Record<string, boolean> = {}, all: string[] = [];
  [f.date].concat(f.more.map((x) => x.v)).forEach((x) => { if (x && !seen[x]) { seen[x] = true; all.push(x); } });
  all.sort();
  const ds = !noDate && !f.pick ? all : [];
  return {
    id: f.pick, name: f.name, gm: f.gm, me: me(d), members: rec ? [] : d.members.map((m) => m.name).filter((n) => f.members.indexOf(n) >= 0), extra: rec ? '' : f.extra, series: f.series.trim(),
    seriesEnd: f.series.trim() ? f.seriesEnd : '', seriesFrom,
    dates: ds.length > 1 ? ds : undefined,
    date: noDate ? '' : f.date, start: noDate ? '' : f.start, end: noDate ? '' : f.end, status: st,
    windowFrom: noDate ? f.winFrom : '', windowTo: noDate ? f.winTo : '',
    place: f.place, memo: f.memo, notify: f.notify,
  };
}
type SessionForm = ReturnType<typeof collect>;

/** 同じ日の重なりを探して注意を出す。× や △ を付けている人も拾う。登録は止めない（あとで直すこともあるため） */
function conflictText(d: ConsoleData, form: SessionForm): string {
  if (!form.date) return '';
  const people = [String(form.gm || '').trim()].concat(form.members || [], splitNames(form.extra)).filter(Boolean);
  const uniq: string[] = [], busyAt: string[] = [], ng: string[] = [], soft: string[] = [];
  people.forEach((n) => { if (uniq.indexOf(n) < 0) uniq.push(n); });
  uniq.forEach((n) => {
    d.sessions.forEach((s) => {
      if (!s.date || s.date !== form.date || s.id === form.id || !isActive(s)) return;
      if (peopleOf(s).indexOf(n) >= 0) busyAt.push(n + '（' + s.name + '）');
    });
    const v = ((d.avail || {})[form.date] || {})[n] || '';
    if (v === '×') ng.push(n); else if (v === '△') soft.push(n);
  });
  const parts: string[] = [];
  if (busyAt.length) parts.push('同じ日に別の卓に入っています: ' + busyAt.join('、'));
  if (ng.length) parts.push('この日に × を付けています: ' + ng.join('、'));
  if (soft.length) parts.push('この日に △ を付けています: ' + soft.join('、'));
  return parts.length ? fmtJa(form.date) + '　' + parts.join('　／　') : '';
}

export function FormModal() {
  const d = useData();
  const { ui, sync } = useConsole();
  const { form: req } = useStore(ui);
  const [f, setF] = useState<Fields>(() => fieldsOf(d, null));
  const [seriesFrom, setSeriesFrom] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [promote, setPromote] = useState<PromoteAsk | null>(null);
  const [handled, setHandled] = useState(0);
  const keyRef = useRef(0), seriesAtFocus = useRef('');
  const nameRef = useRef<HTMLInputElement>(null), dateRef = useRef<HTMLInputElement>(null), boxRef = useRef<HTMLDivElement>(null);
  const open = !!req;
  const s = byId(d, f.pick);

  /** 入力を変える。送り先が無くなったら「Discord に知らせる」を外し、送れるようになったら既定に戻す */
  const update = (patch: Partial<Fields>) => setF((cur) => {
    const next = { ...cur, ...patch };
    const before = canNotify(d, cur), after = canNotify(d, next);
    if (!after) next.notify = false; else if (!before) next.notify = !!d.notifyDefault;
    return next;
  });
  const fill = (id: string) => { setF(fieldsOf(d, byId(d, id))); setSeriesFrom(''); setMsg(null); };
  /** シリーズを選んだら、直前の回の GM・参加者・時間・場所・メモを引き継ぐ（新規のときだけ） */
  const applySeries = (base: Fields, name: string): Fields => {
    const t = seriesLatest(d, name);
    if (!t || base.pick) return base;
    const cur = base.name.trim();
    setMsg({ text: '「' + name + '」の直前の回（' + t.name + '）から GM・参加者・時間・場所・メモを引き継ぎました。名前と開催日を確かめてください。', cls: 'ok' });
    return { ...base, gm: t.gm, ...splitMembers(d, t.members), place: t.place, memo: t.memo, start: t.start, end: t.end,
      name: !cur || /#\d+$/.test(cur) || cur === t.name ? name + ' #' + (d.sessions.filter((x) => x.series === name).length + 1) : base.name };
  };
  /** 卓の設定を引き継ぎ、翌日の卓を新規登録する形にする */
  const continueFrom = (id: string) => {
    const src = byId(d, id); if (!src) return;
    const base = fieldsOf(d, src);
    const date = src.date ? addDaysYmd(src.date, 1) : '';
    // 単発の卓から続けるときは、この回からシリーズにまとめる（前の回にも同じ名前が入る）
    const series = src.series ? base.series : baseSeriesName(src.name);
    setF({ ...base, pick: '', name: nextName(src.name), date, status: date ? '開催' : base.status, series });
    setSeriesFrom(src.series ? '' : src.id);
    setMsg({ text: '「' + src.name + '」の GM・参加者・時間・場所を引き継いでいます。' + (src.series ? '' : '前の回と合わせて「' + series + '」というシリーズにします。') + '名前と開催日を確かめて登録してください。', cls: 'ok' });
  };

  // 開く頼みが来たら、入力を作り直す
  if (req && req.seq !== handled) {
    setHandled(req.seq);
    const r: FormReq = req.req;
    if (r.cont) continueFrom(r.cont);
    else if (r.id) {
      fill(r.id);
      if (r.status) update({ status: r.status });
    }
    else {
      let base = fieldsOf(d, null);
      if (r.status) base = { ...base, status: r.status };
      if (r.date) base = { ...base, date: r.date };
      setMsg(null); setSeriesFrom('');
      if (r.series) base = applySeries({ ...base, series: r.series }, r.series);
      base.notify = canNotify(d, base) && !!d.notifyDefault;
      setF(base);
    }
    if (busy) setBusy(false);
  }
  // 開いたら、窓の先頭から見せて、卓の名前に入る
  useLayoutEffect(() => {
    if (!req) return;
    if (boxRef.current) boxRef.current.scrollTop = 0;
    (req.req.focus === 'date' ? dateRef : nameRef).current?.focus();
  }, [req]);
  const close = () => ui.set((st) => ({ ...st, form: null }));
  const reopen = () => ui.set((st) => ({ ...st, form: { seq: st.form?.seq ?? handled, req: {} } }));

  const st = f.status, rec = st === '募集', adj = st === '調整中';
  const can = canNotify(d, f), kind = rec ? 'recruit' : '', e = seriesHook(d, f.series.trim()) ? snEntry(d, f.series.trim()) : null;
  const baseName = kindSet(d, kind) ? '募集のチャンネル' : '基本のチャンネル', baseOk = kindSet(d, kind) || !!d.channelSet;
  const notifyHint = !can ? '（チャンネル未設定）' : e ? (e.alsoBase && baseOk ? '（シリーズのチャンネルと' + baseName + 'へ）' : '（シリーズのチャンネルへ）') : kindSet(d, kind) ? '（募集のチャンネルへ）' : '';
  const pollNext = st === '調整中' && !(s && hasPoll(s));
  const saveLabel = pollNext ? (s ? '更新して候補日を選ぶ' : '登録して候補日を選ぶ') : (s ? '更新' : '登録');
  const conflict = open ? conflictText(d, collect(d, f, seriesFrom)) : '';
  const nDates = (() => { const xs = [f.date].concat(f.more.map((x) => x.v)).filter(Boolean); return new Set(xs).size; })();
  const moreHidden = rec || adj || !!f.pick;
  // 選ぶ欄: 動いている卓と中止の卓。終了の卓は、ほかの画面から編集を開いたときだけ足す
  const picks = sortedActive(d).concat(sortSessions(d.sessions.filter((x) => x.status === '中止')));
  if (s && picks.indexOf(s) < 0) picks.push(s);
  // いまの段。新しい卓や、状態を切り替えたところは 1 段目。今のままの状態なら、進み具合から決める
  const flow = FLOW[st];
  let now = 0;
  if (s && s.status === st) {
    if (st === '募集') now = s.want.length || s.interest.length ? 2 : 1;
    else if (st === '調整中') now = hasPoll(s) ? 2 : 1;
    else now = -1;
  }
  const wantInfo = s && isRecruit(s) && (s.want.length || s.interest.length)
    ? { text: '参加希望: ' + (s.want.length ? s.want.join('、') : 'なし') + '　／　興味あり: ' + (s.interest.length ? s.interest.join('、') : 'なし'), promote: STATUS_PROMOTE.indexOf(st) >= 0 && s.want.length > 0 }
    : null;

  /** 保存の返事で新しい卓が画面のデータに入ってから、候補日を選ぶ窓を開く */
  const openPollWhenReady = (id: string, n = 20) => {
    const x = byId(sync.data()!, id), u = ui.get();
    if (x && !isTmp(x.id) && !u.form && !u.poll) { openPoll(ui, id); return; }
    if (n > 0) setTimeout(() => openPollWhenReady(id, n - 1), 250);
  };
  const submit = (promoted: string[] | null) => {
    const form = collect(d, f, seriesFrom);
    // 募集から開催・調整中に移すとき、興味ありの人がいれば先に確かめる
    const prev = byId(d, form.id);
    if (!promoted && prev && isRecruit(prev) && STATUS_PROMOTE.indexOf(form.status) >= 0 && prev.interest.length) { setPromote({ s: prev, status: form.status }); return; }
    if (promoted) promoted.forEach((n) => { if (form.members.indexOf(n) < 0) form.members.push(n); });
    if (!form.name.trim()) { setMsg({ text: '卓の名前を入れてください。', cls: 'err' }); return; }
    if (!form.date && STATUS_DATED.indexOf(form.status) >= 0) { setMsg({ text: '開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。', cls: 'err' }); return; }
    if (!!form.windowFrom !== !!form.windowTo) { setMsg({ text: '期間は、始まりと終わりの両方の日を入れてください。', cls: 'err' }); return; }
    if (form.windowFrom && form.windowTo && form.windowFrom > form.windowTo) { const wx = form.windowFrom; form.windowFrom = form.windowTo; form.windowTo = wx; }
    setBusy(true); setMsg({ text: '保存しています…', cls: '' });
    // 押した瞬間にカレンダーへ仮に出す。予定にするなら参加希望の人も参加者に入れておく
    const tmpMembers = form.members.concat(splitNames(form.extra)), toDated = STATUS_PROMOTE.indexOf(form.status) >= 0;
    if (prev && toDated) prev.want.forEach((n) => { if (tmpMembers.indexOf(n) < 0 && n !== form.gm.trim()) tmpMembers.push(n); });
    const tmp: ConsoleSession = {
      id: form.id || TMP, name: form.name.trim(), gm: form.gm.trim(), members: tmpMembers,
      date: form.date, start: form.start, end: form.end, status: form.status as ConsoleSession['status'], place: form.place.trim(), memo: form.memo.trim(), notified: '', editor: form.me,
      want: prev && !toDated ? prev.want : [], interest: prev ? prev.interest : [], series: form.series, seriesEnd: form.seriesEnd, asked: '',
      window: '', windowFrom: form.windowFrom, windowTo: form.windowTo, windowLabel: winLabel(form.windowFrom, form.windowTo), windowKey: form.windowFrom || '',
      candidates: prev && form.status === '調整中' ? (prev.candidates || []) : [], votes: prev ? (prev.votes || {}) : {},
    };
    let tmps = [tmp];
    if (form.dates) {
      // 何日かまとめて。名前は末尾の数字を進める（サーバーと同じ決まり）
      const base = tmp.name, mm = /^(.*?)(\d+)(\D*)$/.exec(base);
      tmps = form.dates.map((dt, i) => ({ ...tmp, id: TMP + i, date: dt, name: i === 0 ? base : mm ? mm[1]! + (Number(mm[2]) + i) + mm[3]! : base + ' #' + (i + 1) }));
    }
    if (form.date) ui.set((x) => ({ ...x, selDay: form.date }));
    // 窓は押した瞬間に閉じる。カレンダーには仮に出ている。結果は吹き出しで知らせる
    close();
    toast('保存しています…');
    const wantNotify = form.notify, wasEdit = !!form.id, wantPoll = form.status === '調整中' && !(prev && hasPoll(prev));
    form.notify = false;   // Discord へは、保存が終わってから画面側が送る
    sync.write<RpcResult>('saveSession', form, { optimistic: (cur) => withSessions(cur, tmps), rollback: withoutTmp }).then((res) => {
      setBusy(false); setMsg(null);
      toast(res.message);
      if (wantPoll && res.id) openPollWhenReady(res.id);
      if (!wantNotify) return;
      const r = res.ids && res.ids.length > 1 ? { kind: 'bulk', names: res.names, ids: res.ids, label: '登録', series: form.series, me: me(d) } : { kind: 'change', id: res.id, verb: wasEdit ? '変更' : '登録', me: me(d) };
      void discordSend(sync, r, (t) => toast(t)).then(({ ok, r: sr }) => { toast(ok ? 'Discord に送りました: ' + res.message.replace(/^.*?: /, '') : failToast(sr)); });
    }, (err: Error) => {
      // 失敗したら、入力を残したまま窓を開き直す
      setBusy(false);
      reopen(); setMsg({ text: err.message, cls: 'err' }); toast('保存できませんでした');
      void sync.refresh('quiet');
    });
  };
  /** 削除。押した瞬間にカレンダーから消し、窓を閉じる */
  const remove = () => {
    const form = collect(d, f, seriesFrom); if (!form.id) return;
    askConfirm({ title: '卓を削除しますか？', message: '「' + form.name + '」を消します。元に戻せません。', ok: '削除する', danger: true }, () => {
      setBusy(true); setMsg({ text: '保存しています…', cls: '' });
      close();
      toast('削除しています…');
      sync.write<RpcResult>('deleteSession', { id: form.id, me: form.me, notify: false }, { optimistic: (cur) => withoutSession(cur, form.id) }).then((res) => {
        setBusy(false); setMsg(null);
        toast(res.message);
        if (!form.notify) return;
        void discordSend(sync, { kind: 'delete', name: form.name, series: form.series, status: form.status, me: me(d) }, (t) => toast(t))
          .then(({ ok, r }) => { toast(ok ? 'Discord に送りました: ' + form.name : failToast(r)); });
      }, (err: Error) => { setBusy(false); reopen(); setMsg({ text: err.message, cls: 'err' }); toast('削除できませんでした'); void sync.refresh('quiet'); });
    });
  };

  return (
    <>
      <Modal id="formModal" open={open} onClose={close}>
        <div className="box wide" role="dialog" aria-modal="true" aria-labelledby="formTitle" tabIndex={-1} ref={boxRef}>
          <div className={wideBar}>
            <h2 className={wideBarTitle} id="formTitle">{f.pick ? '卓を変更' : '卓を登録'}</h2>
            <button type="button" className="btn small ml-auto" id="formClose" onClick={close}><Icon name="close" size="sm" />閉じる</button>
          </div>
          <form id="f" onSubmit={(ev) => { ev.preventDefault(); submit(null); }}>
            <label htmlFor="pick">編集する卓 <small>新しく登録するなら「（新規登録）」のまま</small></label>
            <select id="pick" value={f.pick} onChange={(ev) => fill(ev.target.value)}>
              <option value="">（新規登録）</option>
              {picks.map((x) => <option value={x.id} key={x.id}>{pickLabel(x)}</option>)}
            </select>
            <div className="row" id="seriesRow">
              <div>
                <label htmlFor="series">シリーズ <small>何日かに分けて開く卓の名前。選ぶと直前の回の内容を引き継ぎます</small></label>
                <input type="text" id="series" list="seriesList" placeholder="例: 鉄鳴界の夜明け（1 日で終わる卓なら空のまま）" value={f.series}
                  onChange={(ev) => update({ series: ev.target.value })}
                  onFocus={(ev) => { seriesAtFocus.current = ev.target.value; }}
                  onBlur={(ev) => { const name = ev.target.value.trim(); if (name && ev.target.value !== seriesAtFocus.current) setF((cur) => applySeries(cur, name)); }} />
              </div>
              <div className="narrow" id="seriesEndWrap" hidden={!f.series.trim()}>
                <label htmlFor="seriesEnd">シリーズの最終日 <small>この日を過ぎると候補から消える</small></label>
                <input type="date" id="seriesEnd" value={f.seriesEnd} onChange={(ev) => update({ seriesEnd: ev.target.value })} />
              </div>
            </div>
            <div className="row">
              <div><label htmlFor="name">卓の名前 <small>必須</small></label><input type="text" id="name" required ref={nameRef} value={f.name} onChange={(ev) => update({ name: ev.target.value })} /></div>
              <div className="narrow"><label htmlFor="status">状態</label>
                <select id="status" value={f.status} onChange={(ev) => update({ status: ev.target.value, ...(ev.target.value === '募集' || ev.target.value === '調整中' || f.pick ? { more: [] } : {}) })}>
                  {d.statuses.map((x) => <option value={x} key={x}>{x}</option>)}
                </select>
              </div>
            </div>
            {/* 状態ごとの手順。いまの段を水色で示す */}
            <div id="flowGuide" className="mt-14 mb-2 rounded-lg border border-accent-line bg-accent-soft px-14 py-12" aria-live="polite" hidden={!flow}>
              {flow && (
                <>
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-4 text-14 text-fg">
                    <Icon name={flow.icon} size="sm" className="text-accent-text" /><b>{'「' + st + '」は、' + flow.lead}</b>{flow.steps.length > 0 && <span className="hint text-12">この順で進めます</span>}
                  </div>
                  {flow.steps.length > 0 && (
                    <ol className="mt-10 mb-0 grid list-none gap-6 p-0">
                      {flow.steps.map((t, i) => {
                        const cls = now < 0 ? '' : i < now ? 'done' : i === now ? 'now' : '';
                        const num = cls === 'now' ? 'border-transparent bg-accent-strong text-accent-ink' : cls === 'done' ? 'border-transparent bg-ok text-ok-text' : 'border-line-strong bg-card text-muted';
                        return (
                          <li className={'grid grid-cols-[22px_minmax(0,1fr)] items-start gap-8 text-13 leading-[1.6] text-pretty ' + (cls === 'now' ? 'font-semibold text-fg' : cls === 'done' ? 'text-muted' : 'text-fg')} key={i}>
                            <span className={'mt-1 inline-flex h-22 w-22 items-center justify-center rounded-[50%] border text-12 font-bold ' + num}>{cls === 'done' ? <Icon name="check" size="sm" /> : i + 1}</span>
                            <div>{t}{cls === 'now' && <span className="ml-6 inline-block rounded-full bg-accent-strong px-8 align-[1px] text-11 leading-[18px] font-bold text-accent-ink">いまここ</span>}</div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>
            <div className="row" id="dateRow" hidden={rec || adj}>
              <div className="max-sm:basis-full"><label htmlFor="date">開催日 <small>まだ決まっていなければ状態を「募集」に</small></label><input type="date" id="date" ref={dateRef} value={f.date} onChange={(ev) => update({ date: ev.target.value })} /></div>
              <div className="narrow"><label htmlFor="start">開始</label><input type="time" id="start" step="300" value={f.start} onChange={(ev) => update({ start: ev.target.value })} /></div>
              <div className="narrow"><label htmlFor="end">終了</label><input type="time" id="end" step="300" value={f.end} onChange={(ev) => update({ end: ev.target.value })} /></div>
            </div>
            {/* 同じ日の重なりや × の注意。止めはせず、気づけるようにするだけ */}
            <div id="conflictWarn" className="mt-12 flex items-start gap-8 rounded-md bg-soon px-12 py-10 text-13 leading-[1.6] text-fg" hidden={!conflict}>
              {conflict && <><Icon name="warning" size="sm" className="mt-2 text-violet" /><span>{conflict}</span></>}
            </div>
            <div className="mt-8" id="moreDatesWrap" hidden={moreHidden}>
              <div id="moreDates">
                {!moreHidden && f.more.map((x) => (
                  <div className="mt-6 flex items-center gap-6" key={x.key}>
                    <input type="date" className="xdate max-w-200" aria-label="まとめて登録する日" value={x.v} onChange={(ev) => update({ more: f.more.map((y) => (y.key === x.key ? { ...y, v: ev.target.value } : y)) })} />
                    <button type="button" className="btn small xdel" title="この日を外す" onClick={() => update({ more: f.more.filter((y) => y.key !== x.key) })}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn small" id="addDate" onClick={() => update({ more: f.more.concat({ key: ++keyRef.current, v: '' }) })}><Icon name="add" size="sm" />日を足す（何日かまとめて登録）</button>
              <span className="hint" id="moreDatesHint">{!moreHidden && nDates > 1 ? nDates + ' 日分をまとめて登録します。名前は末尾の数字を進めます（「#1」→「#2」）。数字が無ければ「名前 #1」「名前 #2」' : ''}</span>
            </div>
            <div className="row" id="windowRow" hidden={!rec && !adj}>
              <div>
                <label htmlFor="winFrom"><span id="winLbl">{rec ? '開きたい期間' : '候補の期間'}</span> <small id="winHint">{rec ? 'この幅のどこかで開きたい、という目安。空なら未定' : 'この期間のどこかで開く。空なら未定'}</small></label>
                <input type="date" id="winFrom" value={f.winFrom} onChange={(ev) => update({ winFrom: ev.target.value })} />
              </div>
              <div><label htmlFor="winTo">まで</label><input type="date" id="winTo" value={f.winTo} onChange={(ev) => update({ winTo: ev.target.value })} /></div>
            </div>
            <div className="row">
              <div><label htmlFor="gm">GM</label><input type="text" id="gm" list="memberList" value={f.gm} onChange={(ev) => update({ gm: ev.target.value })} /></div>
            </div>
            <fieldset id="membersRow" hidden={rec}>
              <legend>参加者</legend>
              <div className={checkPills} id="membersBox">
                {d.members.length ? d.members.map((m) => (
                  <label className={checkPill} key={m.name}>
                    <input type="checkbox" value={m.name} className="m" checked={f.members.indexOf(m.name) >= 0}
                      onChange={(ev) => update({ members: ev.target.checked ? f.members.concat(m.name) : f.members.filter((x) => x !== m.name) })} />
                    {m.name}
                  </label>
                )) : <span className="hint">管理画面の「メンバー」で名前を足すと、ここにチェック欄が出ます。</span>}
              </div>
              <input type="text" id="extra" placeholder="メンバーに無い人は、ここに「、」区切りで" aria-label="メンバーに無い参加者" value={f.extra} onChange={(ev) => update({ extra: ev.target.value })} />
            </fieldset>
            <div className="mt-12 rounded-md bg-soon px-12 py-8 text-13" id="wantInfo" hidden={!wantInfo}>{wantInfo && <>{wantInfo.text}{wantInfo.promote && <><br />{'状態を「' + st + '」にして保存すると、参加希望の人が参加者に加わります。'}</>}</>}</div>
            <label htmlFor="place">場所 / URL</label><input type="text" id="place" value={f.place} onChange={(ev) => update({ place: ev.target.value })} />
            <label htmlFor="memo">メモ</label><textarea id="memo" value={f.memo} onChange={(ev) => update({ memo: ev.target.value })} />
            <div className="btns">
              <label><input type="checkbox" id="notify" disabled={!can} checked={f.notify} onChange={(ev) => update({ notify: ev.target.checked })} /> Discord に知らせる <span className="hint" id="notifyHint">{notifyHint}</span></label>
            </div>
            <div className={formActions}>
              <div className="btns mt-0">
                <button type="submit" className="btn primary" id="save" disabled={busy}>{saveLabel}</button>
                <button type="button" className="btn" id="cont" hidden={!s} disabled={busy} title="GM・参加者・時間・場所を引き継いで、翌日の卓を新しく登録する" onClick={() => { if (f.pick) continueFrom(f.pick); }}>続けて登録（翌日・設定を引き継ぐ）</button>
                <button type="button" className="btn" id="clear" onClick={() => fill('')}>新規に戻す</button>
                <button type="button" className="btn danger" id="del" hidden={!s} disabled={busy} onClick={remove}>この卓を削除</button>
              </div>
              <div id="msg" role="status" className={'mt-6 empty:hidden' + (msg && msg.cls === 'ok' ? ' text-ok-text' : msg && msg.cls === 'err' ? ' text-err-text' : '')}>{msg ? msg.text : ''}</div>
            </div>
          </form>
        </div>
      </Modal>
      <PromoteModal ask={promote} onDone={(picked) => { setPromote(null); if (picked) submit(picked); }} />
    </>
  );
}
