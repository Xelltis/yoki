// 選んだ日の内訳（その日の卓・メンバーの予定・日付のメモ）。卓ごとにDiscordへの通知・編集・続きの登録
import { useReducer, useState } from 'react';
import { ABSENCE_NOTE_MAX, type ConsoleData, type ConsoleSession, DAY_NOTE_SPAN_MAX, type RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { openForm, openPoll, openPrep, openRecord } from '../actions';
import { isFinished } from '../records/ledger';
import { prepSummary } from '../prep/PrepModal';
import { discordSend, failToast } from '../api/discord';
import { useConsole } from '../context';
import { googleAddUrl } from '../model/calendar';
import { addDaysYmd, daysBetween, fmtJa, parseYmd, timeRange } from '../model/dates';
import { bookedOn, dayParts, hasPoll, isActive, isAdjusting, isDated, markOn, me, notesOn, peopleOf, pollCount, scenarioOf, seriesNames, sortSessions, targetPeople, windowByDay } from '../model/model';
import { hookFor, kindOf, notifyState } from '../model/notify';
import { withSession } from '../model/optimistic';
import { useGoRecruit } from '../shell/nav';
import { Place } from '../Place';
import { WaitList } from '../recruit/WaitList';
import { notice, people as peopleRow, personChip, res, row2 } from '../styles';

/** 内訳のカード（狭い画面では、日を選ぶまで隠す）。上の帯と下のタブに隠れないように送る */
const detailCard = 'card mb-0 scroll-mt-[calc(var(--appbar-h)+12px)] scroll-mb-[calc(var(--nav-h)+12px)]';
/** その日のみんなの予定の札 */
const MARK_BG: Record<string, string> = { 'm-ok': 'bg-ok', 'm-soft': 'bg-soft', 'm-ng': 'bg-warn', 'm-bk': 'bg-session' };

/** Discordに通知したときの進み具合（卓ごと）と、日付メモの書きかけ（日ごと。文と期間の終わり）。タブを移っても、この画面を開いているあいだは残す */
const notifyRes: Record<string, string> = {};
const dayNoteDraft: Record<string, { text: string; to: string }> = {};

export function DayDetail({ d, target }: { d: ConsoleData; target: string }) {
  const { ui, sync } = useConsole();
  const { selDay } = useStore(ui);
  const goRecruit = useGoRecruit();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [notifying, setNotifying] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState({ saving: false, msg: '' });
  /** 行けなくなったことをGMに伝える窓（卓のIDと一言） */
  const [absence, setAbsence] = useState<{ id: string; text: string } | null>(null);
  if (!selDay) {
    return (
      <div className={detailCard + ' max-lg:hidden'} id="dayDetail">
        <h3 id="dayTitle">日を選んでください</h3>
        <div id="dayBody" className="hint">カレンダーの日をタップすると、その日の卓の内訳がここに出ます。</div>
      </div>
    );
  }
  const list = sortSessions(d.sessions.filter((s) => s.date === selDay)).concat(windowByDay(d)[selDay] || []);
  const n = daysBetween(d.today, selDay);
  const bk = d.booked[selDay] || {}, parts = dayParts(d);
  const people = targetPeople(d, target);
  const sn = seriesNames(d);
  const dayNote = (d.notes || {})[selDay];
  // 前の日から続く期間のメモ（この日の欄では直さず、始まりの日を開いて直す）
  const carried = notesOn(d, selDay).filter((x) => x.from !== selDay);
  const saved = { text: dayNote ? dayNote.text : '', to: dayNote ? dayNote.to : '' };
  const draft = dayNoteDraft[selDay] || saved;
  const setDraft = (patch: Partial<typeof saved>) => { dayNoteDraft[selDay] = { ...draft, ...patch }; redraw(); };
  const openDay = (k: string) => { const p = parseYmd(k); ui.set((x) => ({ ...x, selDay: k, view: { y: p.getFullYear(), m: p.getMonth() } })); };

  const notify = (id: string) => {
    const s = d.sessions.filter((x) => x.id === id)[0]; if (!s) return;
    askConfirm({ title: 'Discordに送りますか？', message: '「' + s.name + '」の案内をDiscordに送ります。', ok: '送る' }, () => {
      setNotifying((m) => ({ ...m, [id]: true }));
      void discordSend(sync, { kind: 'announce', id: s.id, me: me(d) }, (t) => { notifyRes[s.id] = t; redraw(); }).then(({ ok, r }) => {
        setNotifying((m) => ({ ...m, [id]: false }));
        if (r.notified) { notifyRes[s.id] += '（今日が開催前の知らせの日なので、開催前の知らせ済みにしました）'; redraw(); }
        toast(ok ? 'Discordに送りました: ' + s.name : failToast(r));
      });
    });
  };
  const mine = me(d);
  /** 行けなくなった印を付ける（一言を添えて、GMに知らせる）・外す。押した瞬間に画面へ出す */
  const sendAbsence = (s: ConsoleSession, absent: boolean, text: string) => {
    setAbsence(null);
    const optimistic = (cur: ConsoleData) => withSession(cur, s.id, (x) => ({
      ...x, absent: absent ? x.absent.filter((a) => a.name !== mine).concat({ name: mine, note: text.trim(), at: 'いま' }) : x.absent.filter((a) => a.name !== mine),
    }));
    sync.write<RpcResult>('setAbsence', { id: s.id, name: mine, absent, note: text }, { optimistic })
      .then((r) => toast(r.message), (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  const absS = absence ? d.sessions.filter((x) => x.id === absence.id)[0] : undefined;
  const saveNote = () => {
    const day = selDay, text = draft.text, to = draft.to > day ? draft.to : '';
    if (to && daysBetween(day, to) >= DAY_NOTE_SPAN_MAX) { setNote({ saving: false, msg: '期間のメモは' + DAY_NOTE_SPAN_MAX + '日までです。' }); return; }
    delete dayNoteDraft[day];
    setNote({ saving: true, msg: '保存しています…' });
    // 押した瞬間に仮に出す
    sync.write<{ message: string; data?: ConsoleData }>('setDayNote', { ymd: day, text, to, me: me(d) }, {
      optimistic: (cur) => {
        const notes = { ...cur.notes };
        if (text.trim()) notes[day] = { text: text.trim(), by: me(cur), at: 'いま', to }; else delete notes[day];
        return { ...cur, notes };
      },
    }).then((res) => { setNote({ saving: false, msg: '' }); toast(res.message); },
      (e: Error) => { dayNoteDraft[day] = { text, to: draft.to }; setNote({ saving: false, msg: e.message }); toast(e.message); void sync.refresh('quiet'); });
  };

  return (
    <div className={detailCard} id="dayDetail">
      <h3 id="dayTitle">
        {fmtJa(selDay)}
        {/* 今日からどれだけ先か。今日・明日は青く */}
        <span className={'rounded-full px-8 py-1 text-12 font-semibold ' + (n === 0 || n === 1 ? 'bg-accent-soft text-accent-text' : 'bg-head text-muted')}>
          {n === 0 ? '今日' : n === 1 ? '明日' : n > 1 ? n + '日後' : (-n) + '日前'}
        </span>
      </h3>
      <div id="dayBody">
        {!list.length && <div className="hint">この日の卓はありません。</div>}
        {list.map((s, i) => {
          const cand = isAdjusting(s) && s.date !== selDay, pollDay = cand && hasPoll(s);
          const done = s.status === '終了', cancel = s.status === '中止';
          const ppl = peopleOf(s);
          // これから開く卓。参加者（GMでない）は「行けなくなった」を伝えられ、GMと管理者は行けなくなった人がいれば日を組み直せる
          const upcoming = isDated(s) && !!s.date && s.date >= d.today;
          const imAbsent = s.absent.some((a) => a.name === mine), canAbsent = upcoming && !!mine && s.gm !== mine && s.members.indexOf(mine) >= 0;
          return (
            <div className={'mt-10 rounded-md border border-line bg-card p-12 tabular-nums' + (done ? ' opacity-80' : '')} data-id={s.id} key={s.id + ':' + i}>
              <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
                <b className={'text-15' + (done ? ' text-muted' : cancel ? ' text-muted line-through' : '')}>{s.name}</b>
                <span>{pollDay ? '日程調整の候補日　' + pollCount(d, s, selDay) : cand ? '候補の期間　' + s.windowLabel + 'のどこか' : timeRange(s)}</span>
                <span className="rounded-full bg-head px-8 py-1 text-11 font-semibold text-muted">{s.status + (s.status === '募集' ? '（仮の日）' : cand ? '（候補日）' : '')}</span>
              </div>
              <div className={peopleRow}>
                {ppl.map((p) => {
                  const isGm = p === s.gm, known = d.members.some((m) => m.name === p), away = s.absent.some((a) => a.name === p);
                  return <span className={personChip(isGm, !known) + (away ? ' line-through opacity-70' : '')} title={away ? '行けなくなりました' : known ? '' : 'メンバーに未登録'} key={p}>{(isGm ? 'GM ' : '') + p}</span>;
                })}
                {!ppl.length && <span className={personChip(false, true)}>参加者 未定</span>}
              </div>
              {scenarioOf(d, s) && <div className={row2 + ' hint'} data-scenario-of={s.id}>{'シナリオ: ' + scenarioOf(d, s)!.name}</div>}
              {prepSummary(d, s) && <div className={row2 + ' hint'} data-prep-of={s.id}>{prepSummary(d, s)}</div>}
              {s.absent.length > 0 && (
                <div className={notice('adjust', false) + ' mt-8'} data-absent-of={s.id}>
                  <Icon name="warning" />{'行けなくなった: ' + s.absent.map((a) => a.name + (a.note ? '（' + a.note + '）' : '')).join('、')}
                  {upcoming && (s.gm === mine || d.isAdmin) && <span className="block text-12">「日を組み直す」で候補日を出し直すか、「編集」で参加者を見直してください。</span>}
                </div>
              )}
              <WaitList s={s} />
              {s.place && <Place place={s.place} className={row2} />}
              {s.memo && <div className={row2 + ' hint'}>{s.memo}</div>}
              {s.notified ? <div className={row2 + ' hint'}>{'開催前の知らせは' + s.notified + 'に送りました'}</div>
                : isDated(s) && s.date && s.date >= d.today && d.notifySetter ? <div className={row2 + ' hint'}>{notifyState(d, s)}</div> : null}
              <div className="btns mt-10 gap-6">
                {/* 調整中の卓は、日程の操作をいちばん先に */}
                {isAdjusting(s) && (hasPoll(s)
                  ? <button type="button" className="btn small primary" data-goto-recruit onClick={() => goRecruit(s.id)}><Icon name="how_to_vote" size="sm" />回答する</button>
                  : <button type="button" className="btn small primary" data-poll={s.id} onClick={() => openPoll(ui, s.id)}><Icon name="how_to_vote" size="sm" />日程を調整する</button>)}
                {upcoming && s.absent.length > 0 && (s.gm === mine || d.isAdmin) && (
                  <button type="button" className="btn small primary" data-reschedule={s.id} title="状態を「調整中」に戻して、候補日を選び直します（参加者はそのまま）" onClick={() => openForm(ui, { id: s.id, status: '調整中' })}><Icon name="edit_calendar" size="sm" />日を組み直す</button>
                )}
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
                {(s.status === '開催' || s.status === '調整中') && (
                  <button type="button" className="btn small" data-prep={s.id} title="HO・秘匿HO・キャラシ" onClick={() => openPrep(ui, s.id)}><Icon name="checklist" size="sm" />準備</button>
                )}
                {isFinished(d, s) && (s.gm === mine || d.isAdmin || s.members.indexOf(mine) >= 0) && (
                  <button type="button" className="btn small" data-record={s.id} title="ログ・振り返り・PCの結果" onClick={() => openRecord(ui, s.id)}><Icon name="history_edu" size="sm" />記録</button>
                )}
                <button type="button" className="btn small" data-cont={s.id} title="設定を引き継いで翌日の卓を登録" onClick={() => openForm(ui, { cont: s.id })}><Icon name="add" size="sm" />続きを登録</button>
                {isDated(s) && s.date && (
                  <a className="btn small" data-gcal={s.id} href={googleAddUrl(s, d.title, d.appUrl)} target="_blank" rel="noopener" title="この卓をGoogleカレンダーに足す（新しいタブで開く）"><Icon name="event" size="sm" />Googleカレンダーに追加</a>
                )}
                {isActive(s) && (
                  <button type="button" className="btn small" data-notify={s.id} disabled={!hookFor(d, s.series, kindOf(s)) || !!notifying[s.id]} title={hookFor(d, s.series, kindOf(s)) ? '卓の案内をDiscordに送る' : 'チャンネル未設定'} onClick={() => notify(s.id)}><Icon name="notifications" size="sm" />Discordに通知</button>
                )}
                {canAbsent && (imAbsent
                  ? <button type="button" className="btn small" data-absent={s.id} data-on="1" onClick={() => sendAbsence(s, false, '')}><Icon name="undo" size="sm" />行けなくなったを取り消す</button>
                  : <button type="button" className="btn small" data-absent={s.id} onClick={() => setAbsence({ id: s.id, text: '' })}><Icon name="event_busy" size="sm" />行けなくなった</button>)}
                <span className={res} data-res={s.id}>{notifyRes[s.id] || ''}</span>
              </div>
            </div>
          );
        })}
        {people.length > 0 && (
          <>
            <div className="hint mt-10">{'メンバーの予定（' + target + '）'}</div>
            <div className="mt-6 flex flex-wrap gap-4 tabular-nums">
              {people.map((p) => {
                // 昼と夜に分けるグループでは「ソラ 昼× 夜可」のように時間帯ごとに出す。色は、時間帯で違えば △ の色
                const vs = parts.map((pt) => (bookedOn(d, selDay, p, pt) ? bk[p] || '参' : markOn(d, selDay, p, pt) || '可'));
                const v = parts.length > 1 ? parts.map((pt, i) => pt + vs[i]).join(' ') : vs[0]!;
                const one = vs.every((x) => x === vs[0]) ? vs[0]! : '△';
                const cls = one === '可' ? 'm-ok' : one === '△' ? 'm-soft' : one === '×' ? 'm-ng' : one === '参' || one === 'GM' || one === '他' ? 'm-bk' : '';
                const chip = 'relative rounded-full border border-transparent px-10 py-1 text-12 ' + (MARK_BG[cls] || 'bg-head');
                const mm = ((d.availNotes || {})[selDay] || {})[p];
                if (!mm) return <span className={chip} key={p}>{p + ' ' + v}</span>;
                // メモのある人。押すと吹き出しで全文
                const say = () => toast(fmtJa(selDay) + ' ' + p + ': ' + mm.text);
                return (
                  <span className={chip + ' cursor-pointer pl-16'} key={p} data-memo={mm.text} data-memo-of={p} data-day={selDay} role="button" tabIndex={0}
                    onClick={say} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); say(); } }}>
                    {/* メモがある印の点（予定表のマスと同じ色） */}
                    <span className="pointer-events-none absolute top-1/2 left-7 -mt-3 h-6 w-6 rounded-full bg-accent" />{p + ' ' + v}
                  </span>
                );
              })}
            </div>
          </>
        )}
        <div className="btns mt-10">
          <button type="button" className="btn small" id="newOnDay" onClick={() => openForm(ui, { date: selDay })}>この日に卓を登録</button>
          {sn.length > 0 && (
            <select id="dayCont" className="small max-w-[16em]" title="シリーズを選ぶと、直前の回のGM・参加者を引き継いでこの日に登録する" value=""
              onChange={(ev) => { const name = ev.target.value; if (name) openForm(ui, { series: name, date: selDay, status: '開催' }); }}>
              <option value="">この日に続きを登録…</option>
              {sn.map((x) => <option value={x} key={x}>{x}</option>)}
            </select>
          )}
        </div>
        <div className="mt-14 border-t border-line pt-12">
          {/* 前の日から続く期間のメモ。押すと、始まりの日を開いて直せる */}
          {carried.map((x) => (
            <div className="mb-10 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-md bg-soon px-10 py-6 text-13" data-carried={x.from} key={x.from}>
              <Icon name="date_range" size="sm" className="text-soon-text" />
              <b className="font-semibold">{fmtJa(x.from) + '〜' + fmtJa(x.to)}</b>
              <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">{x.text}</span>
              <button type="button" className="btn small" data-open-note={x.from} onClick={() => openDay(x.from)}>{fmtJa(x.from) + 'を開いて直す'}</button>
            </div>
          ))}
          <div className="hint">{'この日のメモ' + (dayNote && dayNote.by ? '　' + dayNote.by + 'が' + dayNote.at : '')}</div>
          <textarea className="h-64 w-full resize-y" id="dayNote" aria-label="この日のメモ" placeholder="卓と関係のない予定も書けます（合宿、イベント、忙しい週など）" value={draft.text}
            onChange={(ev) => setDraft({ text: ev.target.value })} />
          {/* 何日か続く予定は、終わりの日を入れて期間のメモにする */}
          <div className="mt-8 flex flex-wrap items-center gap-8 text-13">
            <label htmlFor="dayNoteTo" className="m-0 font-normal" title="合宿やテスト期間のように、何日か続く予定のとき">期間にするなら</label>
            <input type="date" className="w-auto" id="dayNoteTo" min={addDaysYmd(selDay, 1)} max={addDaysYmd(selDay, DAY_NOTE_SPAN_MAX - 1)} value={draft.to > selDay ? draft.to : ''}
              onChange={(ev) => setDraft({ to: ev.target.value })} />
            <span>まで</span>
          </div>
          <div className="btns mt-8">
            {/* 書き換えるまでは押せない */}
            <button type="button" className="btn small primary" id="dayNoteSave" disabled={note.saving || (draft.text === saved.text && (draft.to > selDay ? draft.to : '') === saved.to)} onClick={saveNote}>メモを保存</button>
            <span className="hint" id="dayNoteMsg">{note.msg}</span>
          </div>
        </div>
      </div>
      {/* 行けなくなったことを、一言を添えてGMに伝える */}
      <Modal id="absenceModal" open={!!absS} onClose={() => setAbsence(null)}>
        <form className="box" id="absenceForm" role="dialog" aria-modal="true" aria-labelledby="absenceTitle" tabIndex={-1} onSubmit={(ev) => { ev.preventDefault(); if (absS && absence) sendAbsence(absS, true, absence.text); }}>
          <h3 id="absenceTitle">{absS ? '「' + absS.name + '」に行けなくなりましたか？' : '行けなくなった'}</h3>
          <p className="hint">{absS ? fmtJa(absS.date) + ' ' + timeRange(absS) + 'の卓です。GMにDiscordで知らせます。GMが日を組み直すか、参加者を見直します。' : ''}</p>
          <label htmlFor="absenceText">GMへの一言 <small>{'任意。' + ABSENCE_NOTE_MAX + '文字まで'}</small></label>
          <textarea id="absenceText" maxLength={ABSENCE_NOTE_MAX} placeholder="例: 急な出張が入りました。翌週なら行けます" value={absence ? absence.text : ''} onChange={(ev) => setAbsence((a) => (a ? { ...a, text: ev.target.value } : a))} />
          <div className="btns">
            <button type="button" className="btn" id="absenceCancel" onClick={() => setAbsence(null)}>やめる</button>
            <button type="submit" className="btn primary" id="absenceSend">GMに伝える</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
