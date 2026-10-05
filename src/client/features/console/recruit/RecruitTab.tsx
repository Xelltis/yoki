// 募集・調整のタブ。募集中の卓（参加希望・興味あり・興味ありの人に聞く）と、日程調整中の卓（候補日への回答・開催日を決める）
import { useRef, useState } from 'react';
import type { ConsoleData, ConsoleSession, RpcResult } from '../../../../shared/api';
import { store } from '../../../app/storage';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { PageHead } from '../../../ui/PageHead';
import { Tip } from '../../../ui/Tip';
import { toast } from '../../../ui/toast';
import { openForm, openPoll } from '../actions';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { fmtJa, holidayName, parseYmd, timeRange } from '../model/dates';
import { byId, hasPoll, isAdjusting, isRecruit, me, peopleOf, periodOfSession, pollPending, pollVoters, sortSessions } from '../model/model';
import { hookFor } from '../model/notify';
import { withSession } from '../model/optimistic';
import { useGoTab } from '../shell/nav';
import { people, personChip, res } from '../styles';
import { notifyDecided, notifyReady } from './pollNotify';

/** 区切りの見出し（募集中・日程調整中） */
const bar = 'mt-24 mb-10 flex flex-wrap items-center gap-8';
const barTitle = 'm-0 inline-flex items-center gap-6';
/** 卓のカードを並べる（幅に合わせて列の数が変わる） */
const cards = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))] gap-14';
/** 卓のカード */
const rc = 'rounded-lg border border-line bg-card px-18 py-16 tabular-nums shadow-card';
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
/** 候補日への ◯ × のボタン */
const vote = 'btn small min-w-44 text-14';

/** 卓の人の札（GM と参加者。メンバーに無い人は印を付ける） */
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

/** 卓の、ある日の自分の回答を変える（空なら消す） */
const withVote = (d: ConsoleData, id: string, days: string[], name: string, vote: string) => withSession(d, id, (s) => {
  const votes = { ...s.votes };
  days.forEach((k) => { const v = { ...votes[k] }; if (vote) v[name] = vote; else delete v[name]; votes[k] = v; });
  return { ...s, votes };
});

export function RecruitTab() {
  const d = useData();
  const { ui, sync } = useConsole();
  const goTab = useGoTab();
  const mine = me(d);
  /** 参加希望を付けた卓（返事が来るまで「保存しています…」）・Discord に聞いている卓の進み具合・押せなくしているボタン */
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
    else if (ng.length) askConfirm({ title: 'どの日でもいい、にしますか？', message: '× を付けた ' + ng.length + ' 日も ◯ に変わります。候補日 ' + days.length + ' 日すべてに ◯ を付けます。', ok: '◯ を付ける' }, go);
    else go();
  };
  const decide = (s: ConsoleSession, k: string) => {
    const v = (s.votes || {})[k] || {}, notOk = peopleOf(s).filter((n) => v[n] !== '◯');
    askConfirm({ title: fmtJa(k) + ' に決めますか？', message: '「' + s.name + '」の開催日を ' + fmtJa(k) + ' にして、状態を「開催」にします。候補日とみんなの回答は消えます。' + (notOk.length ? '　◯ でない人: ' + notOk.join('、') : ''), ok: 'この日に決める' }, () => {
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
      toast(ok ? 'Discord に送りました: ' + sa.name : failToast(r));
    });
  };
  const askS = ask ? byId(d, ask.id) : null;

  return (
    <section id="tab-recruit">
      <PageHead title="募集・調整" lead="参加者を集めている卓と、開催日を選んでいる卓です。" />
      <div className={bar}>
        <h2 className={barTitle}><Icon name="campaign" size="sm" />募集中<span className={count}>{list.length}</span></h2>
        <Tip className="ml-2" text="参加者を集めている卓です。カードの「参加希望」か「興味あり」を押します。押しても Discord には流れません。" label="募集中とは" />
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
          const member = !!mine && peopleOf(s).indexOf(mine) >= 0;
          const canAsk = hookFor(d, s.series, 'recruit');
          const askTitle = !canAsk ? 'チャンネル未設定' : !s.interest.length ? '興味ありの人がいません' : '興味ありの人にメンションして、参加できるか Discord で聞く';
          return (
            <div className={rc} data-id={s.id} key={s.id}>
              <div className={rcHead}>
                <h3 className={rcTitle}>{s.name}</h3>
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
              </div>
              <div className={rcWhen}>{periodOfSession(s)}</div>
              {s.series && <div className="hint">{'シリーズ: ' + s.series}</div>}
              <People d={d} s={s} none="GM・参加者 未定" />
              <div className="mt-10 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12 gap-y-2 text-13">
                <div className="contents"><b className="font-semibold text-muted">参加希望</b>{s.want.length ? s.want.join('、') : <span className="hint">まだいません</span>}</div>
                <div className="contents"><b className="font-semibold text-muted">興味あり</b>{s.interest.length ? s.interest.join('、') : <span className="hint">まだいません</span>}</div>
              </div>
              {s.place && <div className={rcRow}>{'場所: ' + s.place}</div>}
              {s.memo && <div className={rcRow + ' hint'}>{s.memo}</div>}
              {s.gm === mine && <p className={next}><Icon name="arrow_forward" size="sm" className={nextIcon} /><span>集まったら「編集」で状態を「開催」（日が決まっている）か「調整中」（みんなで日を選ぶ）にします。参加希望の人はそのまま参加者に入ります。</span></p>}
              <div className="btns mt-12 gap-6">
                {member ? <span className="hint">{'あなたはこの卓の' + (s.gm === mine ? ' GM ' : '参加者') + 'です'}</span> : (
                  <>
                    <button type="button" className={'btn small' + (level === 'want' ? ' on' : '')} aria-pressed={level === 'want'} data-level="want" data-id={s.id} onClick={() => setLevel(s, 'want')}>参加希望</button>
                    <button type="button" className={'btn small' + (level === 'interest' ? ' on' : '')} aria-pressed={level === 'interest'} data-level="interest" data-id={s.id} onClick={() => setLevel(s, 'interest')}>興味あり</button>
                    {level !== 'none' && <button type="button" className="btn small" data-level="none" data-id={s.id} onClick={() => setLevel(s, 'none')}>取り消す</button>}
                  </>
                )}
                <span className={res} data-rres={s.id}>{saving[s.id] ? '保存しています…' : ''}</span>
              </div>
              {/* GM 向け: 興味ありの人に Discord で聞く。返事は各自が募集タブの「参加希望」で */}
              <div className="btns mt-12 gap-6 border-t border-line pt-12">
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
        <h2 className={barTitle}><Icon name="edit_calendar" size="sm" />日程調整中<span className={count}>{adjList.length}</span></h2>
        <Tip className="ml-2" text="開催日を選んでいる卓です。GM が候補日を出すと知らせが届き、候補日ごとに ◯ か × を押します。全員が答えると GM に知らせが届き、GM が選んだ日に決まって、状態は「開催」になります。" label="日程調整中とは" />
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
          // 開催日を選べるのは GM と管理者
          const canDecide = (!!mine && mine === s.gm) || d.isAdmin !== false;
          const futureDays = s.candidates.filter((k) => k >= d.today);
          const allOk = isVoter && futureDays.length > 0 && futureDays.every((k) => ((s.votes || {})[k] || {})[mine] === '◯');
          // 回答は本人だけが入れる。ゲストと、Discord の ID の無いメンバーは答えられないので数えない
          const cant = peopleOf(s).filter((n) => voters.indexOf(n) < 0);
          return (
            <div className={rc} data-id={s.id} key={s.id}>
              <div className={rcHead}>
                <h3 className={rcTitle}>{s.name}</h3>
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
              </div>
              <div className={rcWhen}>{s.windowLabel ? s.windowLabel + ' のどこか' : '候補の期間は未定'}</div>
              {s.series && <div className="hint">{'シリーズ: ' + s.series}</div>}
              <People d={d} s={s} none="GM・参加者 未定" />
              {s.place && <div className={rcRow}>{'場所: ' + s.place}</div>}
              {s.memo && <div className={rcRow + ' hint'}>{s.memo}</div>}
              {poll && (
                <div className="mt-12 rounded-md bg-head px-12 py-10 tabular-nums">
                  <div className="flex flex-wrap items-center gap-6 font-semibold">
                    <Icon name="how_to_vote" size="sm" />候補日
                    {(s.start || s.end) && <span className="font-normal">{timeRange(s)}</span>}
                    {isVoter && futureDays.length > 0 && (
                      <button type="button" className={'btn small ml-auto' + (allOk ? ' border-ok bg-ok text-ok-text' : '')} data-any={s.id} aria-pressed={allOk} title={allOk ? 'いまは「どの日でもいい」です。押すと回答を取り消します' : 'これからの候補日すべてに ◯ を付けます'} onClick={() => castAny(s, allOk)}>
                        <Icon name="check" size="sm" />どの日でもいい
                      </button>
                    )}
                  </div>
                  <p className="hint mt-2 mb-4">全員が答えたら、GM が開催日を選びます</p>
                  {s.candidates.map((k) => {
                    const v = (s.votes || {})[k] || {}, past = k < d.today, dow = parseYmd(k).getDay(), hol = holidayName(k);
                    const ok = voters.filter((n) => v[n] === '◯'), ng = voters.filter((n) => v[n] === '×'), no = voters.filter((n) => !v[n]);
                    const my = v[mine] || '';
                    return (
                      <div className={'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-2 border-b border-line py-8 last-of-type:border-b-0' + (past ? ' opacity-55' : '')} data-day={k} key={k}>
                        <div className="flex items-baseline gap-8"><b className={dow === 0 || hol ? 'text-sun' : dow === 6 ? 'text-sat' : ''}>{fmtJa(k)}</b><span className="text-12 text-muted">{'◯ ' + ok.length + '/' + voters.length}</span></div>
                        {isVoter && !past && (
                          <div className="flex gap-4">
                            <button type="button" className={vote + (my === '◯' ? ' border-ok-text bg-ok text-ok-text' : '')} data-vote="◯" data-id={s.id} data-day={k} aria-pressed={my === '◯'} aria-label={fmtJa(k) + ' は ◯'} onClick={() => castVote(s, k, '◯')}>◯</button>
                            <button type="button" className={vote + (my === '×' ? ' border-err-text bg-warn text-err-text' : '')} data-vote="×" data-id={s.id} data-day={k} aria-pressed={my === '×'} aria-label={fmtJa(k) + ' は ×'} onClick={() => castVote(s, k, '×')}>×</button>
                          </div>
                        )}
                        <div className="hint m-0 self-center">{[ok.length ? '◯ ' + ok.join('、') : '', ng.length ? '× ' + ng.join('、') : '', no.length ? '未回答 ' + no.join('、') : ''].filter(Boolean).join('　')}</div>
                        {/* 開催日を決めるボタンは、回答の横に（全員が ◯ なら青く） */}
                        {canDecide && !past && (
                          <button type="button" className={'btn small justify-self-end' + (ok.length === voters.length ? ' primary' : '')} data-decide={s.id} data-day={k} disabled={!!off['decide:' + s.id + ':' + k]} onClick={() => decide(s, k)}><Icon name="event_available" size="sm" />この日に決める</button>
                        )}
                      </div>
                    );
                  })}
                  {canDecide && !pollPending(d, s).length && <p className={next}><Icon name="arrow_forward" size="sm" className={nextIcon} /><span>全員の回答がそろいました。開催日を「この日に決める」で選んでください。</span></p>}
                  {cant.length > 0 && <p className="hint">{cant.join('、') + ' は Discord で入らないので、回答できません（数えません）。'}</p>}
                  {!isVoter && <p className="hint">{mine + ' はこの卓の GM でも参加者でもないので、回答できません。'}</p>}
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
          <p className="hint" id="askWho">{askS ? askS.interest.join('、') + ' さんに、参加できそうかを Discord で聞きます。' + '返事は「募集・調整」タブの「参加希望」を押してもらいます。' : ''}</p>
          <label htmlFor="askText">添える一言 <small>任意。500 文字まで</small></label>
          <textarea id="askText" ref={askRef} maxLength={500} placeholder="例: 10 月の土曜のどこかを考えています。都合を教えてください" value={ask ? ask.text : ''} onChange={(ev) => setAsk((a) => (a ? { ...a, text: ev.target.value } : a))} />
          <div className="btns">
            <button type="button" className="btn" id="askCancel" onClick={() => setAsk(null)}>閉じる</button>
            <button type="submit" className="btn primary" id="askSend">Discord に送る</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
