// 選んだ日の内訳（その日の卓・メンバーの予定・日付のメモ）。卓ごとに Discord への通知・編集・続きの登録
import { useReducer, useState } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { openForm, openPoll } from '../actions';
import { discordSend, failToast } from '../api/discord';
import { useConsole } from '../context';
import { googleAddUrl } from '../model/calendar';
import { daysBetween, fmtJa, timeRange } from '../model/dates';
import { hasPoll, isActive, isAdjusting, isDated, me, peopleOf, pollOk, pollVoters, seriesNames, sortSessions, targetPeople, windowByDay } from '../model/model';
import { hookFor, kindOf, notifyState } from '../model/notify';
import { useGoRecruit } from '../shell/nav';
import { Place } from '../Place';
import { people as peopleRow, personChip, res, row2 } from '../styles';

/** 内訳のカード（狭い画面では、日を選ぶまで隠す）。上の帯と下のタブに隠れないように送る */
const detailCard = 'card mb-0 scroll-mt-[calc(var(--appbar-h)+12px)] scroll-mb-[calc(var(--nav-h)+12px)]';
/** その日のみんなの予定の札 */
const MARK_BG: Record<string, string> = { 'm-ok': 'bg-ok', 'm-soft': 'bg-soft', 'm-ng': 'bg-warn', 'm-bk': 'bg-session' };

/** Discord に通知したときの進み具合（卓ごと）と、日付メモの書きかけ（日ごと）。タブを移っても、この画面を開いているあいだは残す */
const notifyRes: Record<string, string> = {};
const dayNoteDraft: Record<string, string> = {};

export function DayDetail({ d, target }: { d: ConsoleData; target: string }) {
  const { ui, sync } = useConsole();
  const { selDay } = useStore(ui);
  const goRecruit = useGoRecruit();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [notifying, setNotifying] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState({ saving: false, msg: '' });
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
  const marks = d.avail[selDay] || {}, bk = d.booked[selDay] || {};
  const people = targetPeople(d, target);
  const sn = seriesNames(d);
  const dayNote = (d.notes || {})[selDay];
  const noteText = dayNoteDraft[selDay] !== undefined ? dayNoteDraft[selDay] : dayNote ? dayNote.text : '';

  const notify = (id: string) => {
    const s = d.sessions.filter((x) => x.id === id)[0]; if (!s) return;
    askConfirm({ title: 'Discord に送りますか？', message: '「' + s.name + '」の案内を Discord に送ります。', ok: '送る' }, () => {
      setNotifying((m) => ({ ...m, [id]: true }));
      void discordSend(sync, { kind: 'announce', id: s.id, me: me(d) }, (t) => { notifyRes[s.id] = t; redraw(); }).then(({ ok, r }) => {
        setNotifying((m) => ({ ...m, [id]: false }));
        if (r.notified) { notifyRes[s.id] += '（今日が開催前の知らせの日なので、開催前の知らせ済みにしました）'; redraw(); }
        toast(ok ? 'Discord に送りました: ' + s.name : failToast(r));
      });
    });
  };
  const saveNote = () => {
    const day = selDay, text = noteText;
    delete dayNoteDraft[day];
    setNote({ saving: true, msg: '保存しています…' });
    // 押した瞬間に仮に出す
    sync.write<{ message: string; data?: ConsoleData }>('setDayNote', { ymd: day, text, me: me(d) }, {
      optimistic: (cur) => {
        const notes = { ...cur.notes };
        if (text.trim()) notes[day] = { text: text.trim(), by: me(cur), at: 'いま' }; else delete notes[day];
        return { ...cur, notes };
      },
    }).then((res) => { setNote({ saving: false, msg: '' }); toast(res.message); },
      (e: Error) => { dayNoteDraft[day] = text; setNote({ saving: false, msg: e.message }); toast(e.message); void sync.refresh('quiet'); });
  };

  return (
    <div className={detailCard} id="dayDetail">
      <h3 id="dayTitle">
        {fmtJa(selDay)}
        {/* 今日からどれだけ先か。今日・明日は青く */}
        <span className={'rounded-full px-8 py-1 text-12 font-semibold ' + (n === 0 || n === 1 ? 'bg-accent-soft text-accent-text' : 'bg-head text-muted')}>
          {n === 0 ? '今日' : n === 1 ? '明日' : n > 1 ? n + ' 日後' : (-n) + ' 日前'}
        </span>
      </h3>
      <div id="dayBody">
        {!list.length && <div className="hint">この日の卓はありません。</div>}
        {list.map((s, i) => {
          const cand = isAdjusting(s) && s.date !== selDay, pollDay = cand && hasPoll(s);
          const done = s.status === '終了', cancel = s.status === '中止';
          const ppl = peopleOf(s);
          return (
            <div className={'mt-10 rounded-md border border-line bg-card p-12 tabular-nums' + (done ? ' opacity-80' : '')} data-id={s.id} key={s.id + ':' + i}>
              <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
                <b className={'text-15' + (done ? ' text-muted' : cancel ? ' text-muted line-through' : '')}>{s.name}</b>
                <span>{pollDay ? '日程調整の候補日　◯ ' + pollOk(d, s, selDay).length + '/' + pollVoters(d, s).length : cand ? '候補の期間 ' + s.windowLabel + ' のどこか' : timeRange(s)}</span>
                <span className="rounded-full bg-head px-8 py-1 text-11 font-semibold text-muted">{s.status + (s.status === '募集' ? '（仮の日）' : cand ? '（候補日）' : '')}</span>
              </div>
              <div className={peopleRow}>
                {ppl.map((p) => {
                  const isGm = p === s.gm, known = d.members.some((m) => m.name === p);
                  return <span className={personChip(isGm, !known)} title={known ? '' : 'メンバーに未登録'} key={p}>{(isGm ? 'GM ' : '') + p}</span>;
                })}
                {!ppl.length && <span className={personChip(false, true)}>参加者 未定</span>}
              </div>
              {s.place && <Place place={s.place} className={row2} />}
              {s.memo && <div className={row2 + ' hint'}>{s.memo}</div>}
              {s.notified ? <div className={row2 + ' hint'}>{'開催前の知らせ 送信済み ' + s.notified}</div>
                : isDated(s) && s.date && s.date >= d.today && d.notifySetter ? <div className={row2 + ' hint'}>{notifyState(d, s)}</div> : null}
              <div className="btns mt-10 gap-6">
                {/* 調整中の卓は、日程の操作をいちばん先に */}
                {isAdjusting(s) && (hasPoll(s)
                  ? <button type="button" className="btn small primary" data-goto-recruit onClick={() => goRecruit(s.id)}><Icon name="how_to_vote" size="sm" />回答する</button>
                  : <button type="button" className="btn small primary" data-poll={s.id} onClick={() => openPoll(ui, s.id)}><Icon name="how_to_vote" size="sm" />日程を調整する</button>)}
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}><Icon name="edit" size="sm" />編集</button>
                <button type="button" className="btn small" data-cont={s.id} title="設定を引き継いで翌日の卓を登録" onClick={() => openForm(ui, { cont: s.id })}><Icon name="add" size="sm" />続きを登録</button>
                {isDated(s) && s.date && (
                  <a className="btn small" data-gcal={s.id} href={googleAddUrl(s, d.title, d.appUrl)} target="_blank" rel="noopener" title="この卓を Google カレンダーに足す（新しいタブで開く）"><Icon name="event" size="sm" />Google カレンダーに追加</a>
                )}
                {isActive(s) && (
                  <button type="button" className="btn small" data-notify={s.id} disabled={!hookFor(d, s.series, kindOf(s)) || !!notifying[s.id]} title={hookFor(d, s.series, kindOf(s)) ? '卓の案内を Discord に送る' : 'チャンネル未設定'} onClick={() => notify(s.id)}><Icon name="notifications" size="sm" />Discord に通知</button>
                )}
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
                const v = bk[p] || marks[p] || '可';
                const cls = v === '可' ? 'm-ok' : v === '△' ? 'm-soft' : v === '×' ? 'm-ng' : v === '参' || v === 'GM' ? 'm-bk' : '';
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
            <select id="dayCont" className="small max-w-[16em]" title="シリーズを選ぶと、直前の回の GM・参加者を引き継いでこの日に登録する" value=""
              onChange={(ev) => { const name = ev.target.value; if (name) openForm(ui, { series: name, date: selDay, status: '開催' }); }}>
              <option value="">この日に続きを登録…</option>
              {sn.map((x) => <option value={x} key={x}>{x}</option>)}
            </select>
          )}
        </div>
        <div className="mt-14 border-t border-line pt-12">
          <div className="hint">{'この日のメモ' + (dayNote && dayNote.by ? '　' + dayNote.by + ' が ' + dayNote.at : '')}</div>
          <textarea className="h-64 w-full resize-y" id="dayNote" aria-label="この日のメモ" placeholder="卓と関係のない予定も書けます（合宿、イベント、忙しい週など）" value={noteText}
            onChange={(ev) => { dayNoteDraft[selDay] = ev.target.value; redraw(); }} />
          <div className="btns mt-8">
            {/* 書き換えるまでは押せない */}
            <button type="button" className="btn small primary" id="dayNoteSave" disabled={note.saving || noteText === (dayNote ? dayNote.text : '')} onClick={saveNote}>メモを保存</button>
            <span className="hint" id="dayNoteMsg">{note.msg}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
