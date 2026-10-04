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
import { daysBetween, fmtJa, timeRange } from '../model/dates';
import { hasPoll, isActive, isAdjusting, isDated, me, peopleOf, pollOk, pollVoters, seriesNames, sortSessions, targetPeople, windowByDay } from '../model/model';
import { hookFor, kindOf, notifyState } from '../model/notify';
import { useGoTab } from '../shell/nav';

/** Discord に通知したときの進み具合（卓ごと）と、日付メモの書きかけ（日ごと）。タブを移っても、この画面を開いているあいだは残す */
const notifyRes: Record<string, string> = {};
const dayNoteDraft: Record<string, string> = {};

export function DayDetail({ d, target }: { d: ConsoleData; target: string }) {
  const { ui, sync } = useConsole();
  const { selDay } = useStore(ui);
  const goTab = useGoTab();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [notifying, setNotifying] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState({ saving: false, msg: '' });
  if (!selDay) {
    return (
      <div className="card nosel" id="dayDetail">
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
    <div className="card" id="dayDetail">
      <h3 id="dayTitle">{fmtJa(selDay) + (n === 0 ? '　今日' : n === 1 ? '　明日' : n > 1 ? '　' + n + ' 日後' : '　' + (-n) + ' 日前')}</h3>
      <div id="dayBody" className="">
        {!list.length && <div className="hint">この日の卓はありません。</div>}
        {list.map((s, i) => {
          const cand = isAdjusting(s) && s.date !== selDay, pollDay = cand && hasPoll(s);
          const cls = s.status === '募集' || isAdjusting(s) ? ' adj' : s.status === '終了' ? ' done' : s.status === '中止' ? ' cancel' : '';
          const ppl = peopleOf(s);
          return (
            <div className={'sess' + cls} data-id={s.id} key={s.id + ':' + i}>
              <div className="sess-h">
                <b>{s.name}</b>
                <span>{pollDay ? '日程調整の候補日　◯ ' + pollOk(d, s, selDay).length + '/' + pollVoters(d, s).length : cand ? '候補の期間 ' + s.windowLabel + ' のどこか' : timeRange(s)}</span>
                <span className="st">{s.status + (s.status === '募集' ? '（仮の日）' : cand ? '（候補日）' : '')}</span>
              </div>
              <div className="people">
                {ppl.map((p) => {
                  const isGm = p === s.gm, known = d.members.some((m) => m.name === p);
                  return <span className={(isGm ? 'gm' : '') + (known ? '' : ' no')} title={known ? '' : 'メンバーに未登録'} key={p}>{(isGm ? 'GM ' : '') + p}</span>;
                })}
                {!ppl.length && <span className="no">参加者 未定</span>}
              </div>
              {s.place && <div className="row2">{'場所: ' + s.place}</div>}
              {s.memo && <div className="row2 hint">{s.memo}</div>}
              {s.notified ? <div className="row2 hint">{'開催前の知らせ 送信済み ' + s.notified}</div>
                : isDated(s) && s.date && s.date >= d.today && d.notifySetter ? <div className="row2 hint">{notifyState(d, s)}</div> : null}
              <div className="btns">
                {isActive(s) && (
                  <button type="button" className="btn small primary" data-notify={s.id} disabled={!hookFor(d, s.series, kindOf(s)) || !!notifying[s.id]} title={hookFor(d, s.series, kindOf(s)) ? undefined : 'チャンネル未設定'} onClick={() => notify(s.id)}>Discord に通知</button>
                )}
                {isAdjusting(s) && (hasPoll(s)
                  ? <button type="button" className="btn small" data-goto-recruit onClick={() => goTab('recruit')}><Icon name="how_to_vote" size="sm" />回答する</button>
                  : <button type="button" className="btn small" data-poll={s.id} onClick={() => openPoll(ui, s.id)}><Icon name="how_to_vote" size="sm" />日程を調整する</button>)}
                <button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}>編集</button>
                <button type="button" className="btn small" data-cont={s.id} title="設定を引き継いで翌日の卓を登録" onClick={() => openForm(ui, { cont: s.id })}>続きを登録</button>
                <span className="res" data-res={s.id}>{notifyRes[s.id] || ''}</span>
              </div>
            </div>
          );
        })}
        {people.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 10 }}>{'メンバーの予定（' + target + '）'}</div>
            <div className="marks">
              {people.map((p) => {
                const v = bk[p] || marks[p] || '可';
                const cls = v === '可' ? 'm-ok' : v === '△' ? 'm-soft' : v === '×' ? 'm-ng' : v === '参' || v === 'GM' ? 'm-bk' : '';
                const mm = ((d.availNotes || {})[selDay] || {})[p];
                if (!mm) return <span className={cls} key={p}>{p + ' ' + v}</span>;
                // メモのある人。押すと吹き出しで全文
                const say = () => toast(fmtJa(selDay) + ' ' + p + ': ' + mm.text);
                return (
                  <span className={cls + ' has-memo'} key={p} data-memo={mm.text} data-memo-of={p} data-day={selDay} role="button" tabIndex={0}
                    onClick={say} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); say(); } }}>
                    <span className="mdot" />{p + ' ' + v}
                  </span>
                );
              })}
            </div>
          </>
        )}
        <div className="btns" style={{ marginTop: 10 }}>
          <button type="button" className="btn small" id="newOnDay" onClick={() => openForm(ui, { date: selDay })}>この日に卓を登録</button>
          {sn.length > 0 && (
            <select id="dayCont" className="small" title="シリーズを選ぶと、直前の回の GM・参加者を引き継いでこの日に登録する" value=""
              onChange={(ev) => { const name = ev.target.value; if (name) openForm(ui, { series: name, date: selDay, status: '開催' }); }}>
              <option value="">この日に続きを登録…</option>
              {sn.map((x) => <option value={x} key={x}>{x}</option>)}
            </select>
          )}
        </div>
        <div className="note-box">
          <div className="hint">{'この日のメモ' + (dayNote && dayNote.by ? '　' + dayNote.by + ' が ' + dayNote.at : '')}</div>
          <textarea id="dayNote" aria-label="この日のメモ" placeholder="卓と関係のない予定も書けます（合宿、イベント、忙しい週など）" value={noteText}
            onChange={(ev) => { dayNoteDraft[selDay] = ev.target.value; redraw(); }} />
          <div className="btns">
            <button type="button" className="btn small primary" id="dayNoteSave" disabled={note.saving} onClick={saveNote}>メモを保存</button>
            <span className="hint" id="dayNoteMsg">{note.msg}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
