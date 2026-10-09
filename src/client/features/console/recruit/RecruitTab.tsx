// 募集・調整のタブ。募集中の卓（参加希望・興味あり・興味ありの人に聞く）と、日程調整中の卓（候補日への回答・開催日を決める）
import { useEffect, useRef, useState } from 'react';
import type { ConsoleData, ConsoleSession, RpcResult } from '../../../../shared/api';
import { partOf } from '../../../../shared/parts';
import { reducedMotion, store } from '../../../app/storage';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { PageHead } from '../../../ui/PageHead';
import { useStore } from '../../../ui/store';
import { Tip } from '../../../ui/Tip';
import { toast } from '../../../ui/toast';
import { openForm, openPoll, openPrep } from '../actions';
import { prepSummary } from '../prep/PrepModal';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { fmtJa, holidayName, parseYmd, timeRange } from '../model/dates';
import { byId, hasPoll, isAdjusting, isRecruit, me, peopleOf, periodOfSession, pollCount, pollFillDays, pollPending, pollVoters, scenarioOf, sortSessions, voteFromAvail } from '../model/model';
import { hookFor } from '../model/notify';
import { withSession } from '../model/optimistic';
import { Place } from '../Place';
import { useGoTab } from '../shell/nav';
import { people, personChip, res } from '../styles';
import { notifyDecided, notifyReady } from './pollNotify';

/** 区切りの見出し（募集中・日程調整中） */
const bar = 'mt-24 mb-10 flex flex-wrap items-center gap-8';
const barTitle = 'm-0 inline-flex items-center gap-6';
/** 卓のカードを並べる（幅に合わせて列の数が変わる） */
const cards = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-14';
/** 卓のカード */
const rc = 'rounded-lg border border-line bg-card px-18 py-16 tabular-nums shadow-card transition-[box-shadow] duration-(--dur-fast) ease-out';
/** カレンダーから移ってきた卓のカードに、少しのあいだ付ける枠 */
const LIT = ['ring-2', 'ring-accent'];
/** 題の行（名前と、右に「編集」） */
const rcHead = 'flex items-start gap-8';
const rcTitle = 'mt-0 mb-2 min-w-0 flex-1 text-16';
/** 区切りの見出しの横の数 */
const count = 'inline-grid h-22 min-w-22 place-items-center rounded-full border border-line bg-card px-6 text-12 font-bold text-muted tabular-nums';
const rcWhen = 'font-semibold text-accent-text';
const rcRow = 'mt-6';
/** 次にすること（水色の帯） */
const next = 'mt-10 mb-0 flex items-start gap-6 rounded-md bg-accent-soft px-10 py-8 text-13 leading-[1.55] text-fg';
const nextIcon = 'mt-1 text-accent-text';
/** 何も無いときのカード */
const empty = 'card flex flex-col items-start gap-10';
/** 候補日への ◯ △ × のボタン */
const vote = 'btn small min-w-40 text-14';
/** 押してある回答の色 */
const VOTE_ON: Record<string, string> = { '◯': ' border-ok-text bg-ok text-ok-text', '△': ' border-ok-text bg-soft text-ok-text', '×': ' border-err-text bg-warn text-err-text' };
const VOTE_WORD: Record<string, string> = { '◯': '◯', '△': '△（調整すれば行ける）', '×': '×' };

/** 卓の人の札（GMと参加者。メンバーに無い人は印を付ける） */
function People({ d, s, none }: { d: ConsoleData; s: ConsoleSession; none: string }) {
  const ppl = peopleOf(s);
  return (
    <div className={people}>
      {ppl.map((p) => {
        const isGm = p === s.gm, known = d.members.some((m) => m.name === p);
        return <span className={personChip(isGm, !known)} key={p}>{(isGm ? 'GM ' : '') + p}</span>;
      })}
      {!ppl.length && <span className={personChip(false, true)}>{none}</span>}
    </div>
  );
}

/** 卓の、ある日の自分の回答を変える（空なら消す）。voteを関数にすると、日ごとに決める */
const withVote = (d: ConsoleData, id: string, days: string[], name: string, vote: string | ((k: string) => string)) => withSession(d, id, (s) => {
  const votes = { ...s.votes };
  days.forEach((k) => { const v = { ...votes[k] }, x = typeof vote === 'function' ? vote(k) : vote; if (x) v[name] = x; else delete v[name]; votes[k] = v; });
  return { ...s, votes };
});

export function RecruitTab() {
  const d = useData();
  const { ui, sync } = useConsole();
  const goTab = useGoTab();
  const mine = me(d);
  /* カレンダーの「回答する」などから来たら、その卓のカードまで動かし、少しのあいだ枠を付けて目立たせる */
  const { focus } = useStore(ui);
  useEffect(() => {
    if (!focus) return;
    ui.set((s) => ({ ...s, focus: '' }));
    const el = document.querySelector<HTMLElement>('[data-card="' + CSS.escape(focus) + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    el.classList.add(...LIT);
    window.setTimeout(() => el.classList.remove(...LIT), 2400);
  }, [focus, ui]);
  /** 参加希望を付けた卓（返事が来るまで「保存しています…」）・Discordに聞いている卓の進み具合・押せなくしているボタン */
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [askRes, setAskRes] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [ask, setAsk] = useState<{ id: string; text: string } | null>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const list = sortSessions(d.sessions.filter(isRecruit));
  const adjList = sortSessions(d.sessions.filter(isAdjusting));
  const setFlag = (set: typeof setOff, key: string, on: boolean) => set((m) => ({ ...m, [key]: on }));

  /** 参加希望・興味あり・取り消す。押した瞬間に付け替える。失敗したら読み直す */
  const setLevel = (s: ConsoleSession, level: string) => {
    if (!mine) return;
    setFlag(setSaving, s.id, true);
    sync.write<RpcResult>('setInterest', { id: s.id, name: mine, level }, {
      optimistic: (cur) => withSession(cur, s.id, (x) => {
        const want = x.want.filter((n) => n !== mine), interest = x.interest.filter((n) => n !== mine);
        if (level === 'want') want.push(mine); else if (level === 'interest') interest.push(mine);
        return { ...x, want, interest };
      }),
    }).then((res) => { setFlag(setSaving, s.id, false); toast(res.message); },
      (e: Error) => { setFlag(setSaving, s.id, false); toast(e.message); void sync.refresh('quiet'); });
  };
  /** 回答。同じ印をもう一度押すと取り消す。押した瞬間に画面へ出し、返事で確定する */
  const castVote = (s: ConsoleSession, k: string, mark: string) => {
    if (!mine) return;
    const cur = ((s.votes || {})[k] || {})[mine] || '', next = cur === mark ? '' : mark;
    sync.write<RpcResult>('setPollVote', { id: s.id, ymd: k, name: mine, vote: next }, { optimistic: (x) => withVote(x, s.id, [k], mine, next) }).then((res) => {
      toast(res.message);
      if (res.ready && res.notified === false && res.id) notifyReady(sync, res.id, res.message);
    }, (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  /** 「どの日でもいい」。これからの候補日すべてに ◯ を付ける。もう一度押すと、自分の回答をすべて取り消す */
  const castAny = (s: ConsoleSession, undo: boolean) => {
    if (!mine) return;
    const days = s.candidates.filter((k) => k >= d.today);
    if (!days.length) { toast('これからの候補日がありません'); return; }
    const ng = days.filter((k) => ((s.votes || {})[k] || {})[mine] === '×');
    const go = () => {
      sync.write<RpcResult>('setPollVoteAll', { id: s.id, name: mine, vote: undo ? '' : '◯' }, { optimistic: (x) => withVote(x, s.id, days, mine, undo ? '' : '◯') }).then((res) => {
        toast(res.message);
        if (res.ready && res.notified === false && res.id) notifyReady(sync, res.id, res.message);
      }, (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
    };
    if (undo) askConfirm({ title: '回答を取り消しますか？', message: '「' + s.name + '」に付けた ◯ を、これからの候補日すべてで消します。', ok: '取り消す', danger: true }, go);
    else if (ng.length) askConfirm({ title: 'どの日でもいい、にしますか？', message: '× を付けた' + ng.length + '日も ◯ に変わります。候補日' + days.length + '日すべてに ◯ を付けます。', ok: '◯ を付ける' }, go);
    else go();
  };
  /** 予定表から答える。まだ答えていない候補日に、予定表の印（空欄は ◯、△、× と卓のある日は ×）を入れる */
  const castFromAvail = (s: ConsoleSession) => {
    if (!mine) return;
    const days = pollFillDays(d, s, mine);
    if (!days.length) { toast('予定表から入れられる候補日はありません'); return; }
    // 昼と夜に分けるグループでは、卓の開始時刻の時間帯の印で答える（サーバーと同じ）
    const part = d.settings.dayParts ? partOf(s.start) : '';
    sync.write<RpcResult>('setPollVoteFromAvail', { id: s.id, name: mine }, { optimistic: (x) => withVote(x, s.id, days, mine, (k) => voteFromAvail(x, mine, k, part)) }).then((res) => {
      toast(res.message);
      if (res.ready && res.notified === false && res.id) notifyReady(sync, res.id, res.message);
    }, (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  const decide = (s: ConsoleSession, k: string) => {
    const v = (s.votes || {})[k] || {}, maybe = peopleOf(s).filter((n) => v[n] === '△'), notOk = peopleOf(s).filter((n) => v[n] !== '◯' && v[n] !== '△');
    const who = (maybe.length ? '　△ の人: ' + maybe.join('、') : '') + (notOk.length ? '　× か未回答の人: ' + notOk.join('、') : '');
    askConfirm({ title: fmtJa(k) + 'に決めますか？', message: '「' + s.name + '」の開催日を' + fmtJa(k) + 'にして、状態を「開催」にします。候補日とみんなの回答は消えます。' + who, ok: 'この日に決める' }, () => {
      const key = 'decide:' + s.id + ':' + k;
      setFlag(setOff, key, true);
      sync.write<RpcResult>('decidePoll', { id: s.id, ymd: k, me: mine }).then((res) => {
        toast(res.message);
        if (res.notified === false && res.id) notifyDecided(sync, res.id, res.message);
      }, (e: Error) => { setFlag(setOff, key, false); toast(e.message); });
    });
  };
  const cancelPoll = (s: ConsoleSession) => {
    askConfirm({ title: '日程調整をやめますか？', message: '「' + s.name + '」の候補日とみんなの回答は消えます。卓は調整中のまま残ります。', ok: '調整をやめる', danger: true }, () => {
      const key = 'cancel:' + s.id;
      setFlag(setOff, key, true);
      sync.write<RpcResult>('cancelPoll', { id: s.id }).then((res) => { setFlag(setOff, key, false); toast(res.message); }, (e: Error) => { setFlag(setOff, key, false); toast(e.message); });
    });
  };
  /** 「都合を見る卓」をこの卓にしてカレンダーへ。候補日（無ければ候補の期間の初め）を選ぶ */
  const showOnCalendar = (s: ConsoleSession) => {
    store('target', s.name);
    const first = hasPoll(s) ? (s.candidates.filter((k) => k >= d.today)[0] || s.candidates[0]) : s.windowFrom;
    ui.set((x) => {
      const next = { ...x, target: s.name };
      if (!first) return next;
      const p = parseYmd(first);
      return { ...next, selDay: first, view: { y: p.getFullYear(), m: p.getMonth() } };
    });
    goTab('cal');
  };
  const sendAsk = () => {
    if (!ask) return;
    const sa = byId(d, ask.id); if (!sa) return;
    const text = ask.text.trim(), key = 'ask:' + sa.id;
    setAsk(null);
    setFlag(setOff, key, true);
    void discordSend(sync, { kind: 'ask', id: sa.id, me: mine, message: text }, (t) => setAskRes((m) => ({ ...m, [sa.id]: t }))).then(({ ok, r }) => {
      setFlag(setOff, key, false);
      toast(ok ? 'Discordに送りました: ' + sa.name : failToast(r));
    });
  };
  const askS = ask ? byId(d, ask.id) : null;

  return (
    <section id="tab-recruit">
      <PageHead title="募集・調整" lead="参加者を集めている卓と、開催日を選んでいる卓です。" />
      <div className={bar}>
        <h2 className={barTitle}><Icon name="campaign" size="sm" />募集中{list.length > 0 && <span className={count}>{list.length}</span>}</h2>
        <Tip className="ml-2" text="参加者を集めている卓です。カードの「参加希望」か「興味あり」を押します。押してもDiscordには流れません。" label="募集中とは" />
        <button type="button" className="btn small primary" id="barRecruit" onClick={() => openForm(ui, { status: '募集' })}><Icon name="add" size="sm" />募集を始める</button>
      </div>
      <div id="recruitList" className={cards}>
        {!list.length && (
          <div className={empty}>
            <p className="hint m-0">募集中の卓はありません。状態を「募集」にして登録すると、ここに並びます。</p>
            <button type="button" className="btn primary" data-new-recruit onClick={() => openForm(ui, { status: '募集' })}><Icon name="add" />募集を始める</button>
          </div>
        )}
        {list.map((s) => {
          const level = s.want.indexOf(mine) >= 0 ? 'want' : s.interest.indexOf(mine) >= 0 ? 'interest' : 'none';
          // 定員に達した卓は参加希望を、締め切りを過ぎた卓はどちらも、新しく付けられない（取り消しはできる）
          const full = s.capacity > 0 && s.want.length >= s.capacity, closed = !!s.recruitDue && d.today > s.recruitDue;
          const member = !!mine && peopleOf(s).indexOf(mine) >= 0;
          const canAsk = hookFor(d, s.series, 'recruit');
          const askTitle = !canAsk ? 'チャンネル未設定' : !s.interest.length ? '興味ありの人がいません' : '興味ありの人にメンションして、参加できるかDiscordで聞く';
          return (
            <div className={rc} data-id={s.id} data-card={s.id} key={s.id}>
              <div className={rcHead}>
                <h3 className={rcTitle}>{s.name}</h3>
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
              </div>
              <div className={rcWhen}>{periodOfSession(s)}</div>
              {s.series && <div className="hint">{'シリーズ: ' + s.series}</div>}
              {scenarioOf(d, s) && <div className="hint" data-scenario-of={s.id}>{'シナリオ: ' + scenarioOf(d, s)!.name}</div>}
              <People d={d} s={s} none="GM・参加者 未定" />
              <div className="mt-10 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12 gap-y-2 text-13">
                <div className="contents"><b className="font-semibold text-muted">参加希望</b><span data-want-of={s.id}>{s.want.length ? s.want.join('、') : <span className="hint">まだいません</span>}{s.capacity > 0 && <span className={'ml-6 text-12 font-semibold ' + (full ? 'text-soon-text' : 'text-muted')}>{s.want.length + '/' + s.capacity + '人' + (full ? '（定員）' : '')}</span>}</span></div>
                <div className="contents"><b className="font-semibold text-muted">興味あり</b>{s.interest.length ? s.interest.join('、') : <span className="hint">まだいません</span>}</div>
                {s.recruitDue && <div className="contents"><b className="font-semibold text-muted">締め切り</b><span data-due-of={s.id} className={closed ? 'text-soon-text' : ''}>{fmtJa(s.recruitDue) + (closed ? '（締め切りました）' : s.recruitDue === d.today ? '（今日まで）' : 'まで')}</span></div>}
              </div>
              {s.place && <Place place={s.place} className={rcRow} />}
              {s.memo && <div className={rcRow + ' hint'}>{s.memo}</div>}
              {s.gm === mine && <p className={next}><Icon name="arrow_forward" size="sm" className={nextIcon} /><span>集まったら「編集」で状態を「開催」（日が決まっている）か「調整中」（みんなで日を選ぶ）にします。参加希望の人はそのまま参加者に入ります。</span></p>}
              <div className="btns mt-12 gap-6">
                {member ? <span className="hint">{'あなたはこの卓の' + (s.gm === mine ? ' GM ' : '参加者') + 'です'}</span> : (
                  <>
                    <button type="button" className={'btn small' + (level === 'want' ? ' on' : '')} aria-pressed={level === 'want'} data-level="want" data-id={s.id}
                      disabled={level !== 'want' && (closed || full)} title={level !== 'want' && closed ? '募集は締め切りました' : level !== 'want' && full ? '定員に達しています' : undefined} onClick={() => setLevel(s, 'want')}>参加希望</button>
                    <button type="button" className={'btn small' + (level === 'interest' ? ' on' : '')} aria-pressed={level === 'interest'} data-level="interest" data-id={s.id}
                      disabled={level !== 'interest' && closed} title={level !== 'interest' && closed ? '募集は締め切りました' : undefined} onClick={() => setLevel(s, 'interest')}>興味あり</button>
                    {level !== 'none' && <button type="button" className="btn small" data-level="none" data-id={s.id} onClick={() => setLevel(s, 'none')}>取り消す</button>}
                    {level === 'none' && (closed || full) && <span className="hint">{closed ? '募集は締め切りました' : '定員に達しています。「興味あり」なら付けられます'}</span>}
                  </>
                )}
                <span className={res} data-rres={s.id}>{saving[s.id] ? '保存しています…' : ''}</span>
              </div>
              {/* GM向け: 開催にする・興味ありの人にDiscordで聞く。返事は各自が募集タブの「参加希望」で。GMと管理者（GMが未定ならだれでも）にだけ出す */}
              <div className="btns mt-12 gap-6 border-t border-line pt-12" hidden={!(s.gm === mine || !s.gm || d.isAdmin)}>
                <button type="button" className="btn small primary" data-hold={s.id} title="状態を「開催」にした登録の窓を開きます" onClick={() => openForm(ui, { id: s.id, status: '開催', focus: 'date' })}><Icon name="event" size="sm" />開催にする</button>
                <button type="button" className="btn small" data-ask={s.id} disabled={!(canAsk && s.interest.length) || !!off['ask:' + s.id]} title={askTitle}
                  onClick={() => { setAsk({ id: s.id, text: '' }); setTimeout(() => askRef.current?.focus(), 0); }}>興味ありの人に聞く</button>
                <span className={res} data-ares={s.id}>{askRes[s.id] || (s.asked ? '確認文を送りました（' + s.asked + '）' : '')}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={bar}>
        <h2 className={barTitle}><Icon name="edit_calendar" size="sm" />日程調整中{adjList.length > 0 && <span className={count}>{adjList.length}</span>}</h2>
        <Tip className="ml-2" text="開催日を選んでいる卓です。GMが候補日を出すと知らせが届き、候補日ごとに ◯・△（調整すれば行ける）・× を押します。全員が答えるとGMに知らせが届き、GMが選んだ日に決まって、状態は「開催」になります。" label="日程調整中とは" />
        <button type="button" className="btn small" id="barAdjust" onClick={() => openForm(ui, { status: '調整中' })}><Icon name="add" size="sm" />日程調整を始める</button>
      </div>
      <div id="adjustList" className={cards}>
        {!adjList.length && (
          <div className={empty}>
            <p className="hint m-0">日程を調整している卓はありません。状態を「調整中」にして候補の期間を入れると、ここに並びます。</p>
            <button type="button" className="btn" data-new-adjust onClick={() => openForm(ui, { status: '調整中' })}><Icon name="add" />日程調整を始める</button>
          </div>
        )}
        {adjList.map((s) => {
          const poll = hasPoll(s), voters = pollVoters(d, s), isVoter = !!mine && voters.indexOf(mine) >= 0;
          // 開催日を選べるのはGMと管理者
          const canDecide = (!!mine && mine === s.gm) || d.isAdmin !== false;
          const futureDays = s.candidates.filter((k) => k >= d.today);
          const allOk = isVoter && futureDays.length > 0 && futureDays.every((k) => ((s.votes || {})[k] || {})[mine] === '◯');
          const fillDays = isVoter ? pollFillDays(d, s, mine) : [];
          // 回答は本人だけが入れる。ゲストと、DiscordのIDの無いメンバーは答えられないので数えない
          const cant = peopleOf(s).filter((n) => voters.indexOf(n) < 0);
          return (
            <div className={rc} data-id={s.id} data-card={s.id} key={s.id}>
              <div className={rcHead}>
                <h3 className={rcTitle}>{s.name}</h3>
                <button type="button" className="btn small" data-prep={s.id} title="HO・秘匿HO・キャラシ" onClick={() => openPrep(ui, s.id)}><Icon name="checklist" size="sm" />準備</button>
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
              </div>
              <div className={rcWhen}>{s.windowLabel ? s.windowLabel + 'のどこか' : '候補の期間は未定'}</div>
              {s.series && <div className="hint">{'シリーズ: ' + s.series}</div>}
              {scenarioOf(d, s) && <div className="hint" data-scenario-of={s.id}>{'シナリオ: ' + scenarioOf(d, s)!.name}</div>}
              {prepSummary(d, s) && <div className="hint" data-prep-of={s.id}>{prepSummary(d, s)}</div>}
              <People d={d} s={s} none="GM・参加者 未定" />
              {s.place && <Place place={s.place} className={rcRow} />}
              {s.memo && <div className={rcRow + ' hint'}>{s.memo}</div>}
              {poll && (
                <div className="mt-12 rounded-md bg-head px-12 py-10 tabular-nums">
                  <div className="flex flex-wrap items-center gap-6 font-semibold">
                    <Icon name="how_to_vote" size="sm" />候補日
                    {(s.start || s.end) && <span className="font-normal">{timeRange(s)}</span>}
                    {isVoter && futureDays.length > 0 && (
                      <span className="ml-auto flex flex-wrap justify-end gap-6">
                        {fillDays.length > 0 && (
                          <button type="button" className="btn small" data-fill={s.id} title="まだ答えていない候補日に、予定表の印を入れます（空欄は ◯、△ は △、× と卓のある日は ×）" onClick={() => castFromAvail(s)}>
                            <Icon name="event_available" size="sm" />予定表から入れる
                          </button>
                        )}
                        <button type="button" className={'btn small' + (allOk ? ' border-ok bg-ok text-ok-text' : '')} data-any={s.id} aria-pressed={allOk} title={allOk ? 'いまは「どの日でもいい」です。押すと回答を取り消します' : 'これからの候補日すべてに ◯ を付けます'} onClick={() => castAny(s, allOk)}>
                          <Icon name="check" size="sm" />どの日でもいい
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="hint mt-2 mb-4">
                    {s.pollDue && (
                      <span data-poll-due-of={s.id} className={'font-semibold ' + (d.today > s.pollDue ? 'text-soon-text' : '')}>
                        {'回答の締め切り ' + fmtJa(s.pollDue) + (d.today > s.pollDue ? '（過ぎました）' : s.pollDue === d.today ? '（今日まで）' : 'まで') + '。'}
                      </span>
                    )}
                    全員が答えたら、GMが開催日を選びます
                  </p>
                  {s.candidates.map((k) => {
                    const v = (s.votes || {})[k] || {}, past = k < d.today, dow = parseYmd(k).getDay(), hol = holidayName(k);
                    const ok = voters.filter((n) => v[n] === '◯'), maybe = voters.filter((n) => v[n] === '△'), ng = voters.filter((n) => v[n] === '×'), no = voters.filter((n) => !v[n]);
                    const my = v[mine] || '';
                    return (
                      // 1段目に日付・自分の ◯ ×・「この日に決める」（入りきらなければ、決めるボタンだけ次の行の右へ）、2段目にみんなの回答（幅いっぱい）
                      <div className={'border-b border-line py-8 last-of-type:border-b-0' + (past ? ' opacity-55' : '')} data-day={k} key={k}>
                        <div className="flex flex-wrap items-center gap-x-8 gap-y-6">
                          <div className="flex min-w-[7.5em] flex-1 items-baseline gap-8 whitespace-nowrap"><b className={dow === 0 || hol ? 'text-sun' : dow === 6 ? 'text-sat' : ''}>{fmtJa(k)}</b><span className="text-12 text-muted">{pollCount(d, s, k)}</span></div>
                          {isVoter && !past && (
                            <div className="flex gap-4">
                              {['◯', '△', '×'].map((m) => (
                                <button type="button" className={vote + (my === m ? VOTE_ON[m] : '')} data-vote={m} data-id={s.id} data-day={k} aria-pressed={my === m} aria-label={fmtJa(k) + 'は ' + VOTE_WORD[m]} title={m === '△' ? '調整すれば行ける' : undefined} key={m} onClick={() => castVote(s, k, m)}>{m}</button>
                              ))}
                            </div>
                          )}
                          {/* 開催日を決めるボタン（全員が ◯ なら青く） */}
                          {canDecide && !past && (
                            <button type="button" className={'btn small ml-auto' + (ok.length === voters.length ? ' primary' : '')} data-decide={s.id} data-day={k} disabled={!!off['decide:' + s.id + ':' + k]} onClick={() => decide(s, k)}><Icon name="event_available" size="sm" />この日に決める</button>
                          )}
                        </div>
                        <div className="hint mt-4">{[ok.length ? '◯ ' + ok.join('、') : '', maybe.length ? '△ ' + maybe.join('、') : '', ng.length ? '× ' + ng.join('、') : '', no.length ? '未回答' + no.join('、') : ''].filter(Boolean).join('　')}</div>
                      </div>
                    );
                  })}
                  {canDecide && !pollPending(d, s).length && <p className={next}><Icon name="arrow_forward" size="sm" className={nextIcon} /><span>全員の回答がそろいました。開催日を「この日に決める」で選んでください。</span></p>}
                  {cant.length > 0 && <p className="hint">{cant.join('、') + 'はDiscordで入らないので、回答できません（数えません）。'}</p>}
                  {!isVoter && <p className="hint">{mine + 'はこの卓のGMでも参加者でもないので、回答できません。'}</p>}
                </div>
              )}
              {!poll && <p className={next}><Icon name="arrow_forward" size="sm" className={nextIcon} /><span>{s.members.length ? '次は「日程を調整する」で候補日を選び、参加者に聞きます。' : '次は「編集」で参加者を入れてから、「日程を調整する」で候補日を選びます。'}</span></p>}
              <div className="btns mt-12 gap-6">
                {poll ? (
                  <>
                    <button type="button" className="btn small" data-poll={s.id} onClick={() => openPoll(ui, s.id)}><Icon name="edit_calendar" size="sm" />候補日を選び直す</button>
                    <button type="button" className="btn small" data-win={s.id} title="カレンダーの「都合を見る卓」をこの卓にして、候補の日に枠を付ける" onClick={() => showOnCalendar(s)}><Icon name="date_range" size="sm" />カレンダーで見る</button>
                    <button type="button" className="btn small danger" data-poll-cancel={s.id} disabled={!!off['cancel:' + s.id]} onClick={() => cancelPoll(s)}>調整をやめる</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn small primary" data-poll={s.id} onClick={() => openPoll(ui, s.id)}><Icon name="how_to_vote" size="sm" />日程を調整する</button>
                    <button type="button" className="btn small" data-win={s.id} title="カレンダーの「都合を見る卓」をこの卓にして、候補の期間に枠を付ける" onClick={() => showOnCalendar(s)}><Icon name="date_range" size="sm" />カレンダーで見る</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 興味ありの人に聞く。一言を添える窓を出してから送る */}
      <Modal id="askModal" open={!!askS} onClose={() => setAsk(null)}>
        <form className="box" id="askForm" role="dialog" aria-modal="true" aria-labelledby="askTitle" tabIndex={-1} onSubmit={(ev) => { ev.preventDefault(); sendAsk(); }}>
          <h3 id="askTitle">{askS ? '「' + askS.name + '」に興味ありの人に聞く' : '興味ありの人に聞く'}</h3>
          <p className="hint" id="askWho">{askS ? askS.interest.join('、') + 'さんに、参加できそうかをDiscordで聞きます。' + '返事は「募集・調整」タブの「参加希望」を押してもらいます。' : ''}</p>
          <label htmlFor="askText">添える一言 <small>任意。500文字まで</small></label>
          <textarea id="askText" ref={askRef} maxLength={500} placeholder="例: 10月の土曜のどこかを考えています。都合を教えてください" value={ask ? ask.text : ''} onChange={(ev) => setAsk((a) => (a ? { ...a, text: ev.target.value } : a))} />
          <div className="btns">
            <button type="button" className="btn" id="askCancel" onClick={() => setAsk(null)}>閉じる</button>
            <button type="submit" className="btn primary" id="askSend">Discordに送る</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
