// 日程調整: 候補日を選ぶ窓。各日の右にGM・参加者の予定を出す。送ったら、Discordでみんなに聞く
import { useState } from 'react';
import type { ConsoleData, ConsoleSession, RpcResult } from '../../../../shared/api';
import { type Part, partOf } from '../../../../shared/parts';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { addDaysYmd, fmtJa, holidayName, parseYmd } from '../model/dates';
import { bookedOn, byId, hasPoll, markOn, me, peopleOf } from '../model/model';
import { hookFor } from '../model/notify';

/** 選べる日。候補の期間があればその中、無ければ予定表の範囲。足した日と選んでいる日も入れる */
function pollRange(d: ConsoleData, s: ConsoleSession, sel: string[], extra: string[]): string[] {
  const out: string[] = [];
  let from = d.today, to = d.availDays[d.availDays.length - 1] || addDaysYmd(d.today, 59);
  if (s.windowFrom && s.windowTo && s.windowTo >= d.today) { from = s.windowFrom < d.today ? d.today : s.windowFrom; to = s.windowTo; }
  for (let day = from, i = 0; day <= to && i < 120; day = addDaysYmd(day, 1), i++) out.push(day);
  sel.concat(extra).forEach((k) => { if (k >= d.today && out.indexOf(k) < 0) out.push(k); });
  return out.sort();
}
/** その日の予定の札（△・×・卓あり） */
const avChip = 'rounded-full px-8 ';
const AV_BG: Record<string, string> = { soft: 'bg-soft', ng: 'bg-warn', bk: 'bg-session' };

/** その日のGM・参加者の予定（partは時間帯。昼と夜に分けないなら ''）。空欄は参加できる扱い */
function dayAvail(d: ConsoleData, s: ConsoleSession, k: string, part: Part | ''): { free: boolean; items: { c: string; text: string }[] | null } {
  if (d.availDays.indexOf(k) < 0) return { free: false, items: null };
  const items: { c: string; text: string }[] = [];
  peopleOf(s).forEach((n) => {
    if (bookedOn(d, k, n, part)) { items.push({ c: 'bk', text: '卓あり ' + n }); return; }
    const v = markOn(d, k, n, part);
    if (v) items.push({ c: v === '△' ? 'soft' : 'ng', text: v + ' ' + n });
  });
  return { free: !items.length, items };
}

export function PollModal() {
  const d = useData();
  const { ui, sync } = useConsole();
  const { poll: req } = useStore(ui);
  const [st, setSt] = useState({ id: '', sel: [] as string[], extra: [] as string[], okOnly: false, start: '', end: '', due: '', notify: false, add: '', msg: '', sending: false });
  const [handled, setHandled] = useState(0);
  const [open, setOpen] = useState(false);
  // 開く頼みが来たら、その卓の候補日（これからの日）を選んだ状態から始める
  if (req && req.seq !== handled) {
    setHandled(req.seq);
    const s = byId(d, req.id);
    if (s && !s.members.length) toast('「' + s.name + '」にはまだ参加者がいません。「編集」で入れてから調整します');
    else if (s) {
      setSt({ id: s.id, sel: (s.candidates || []).filter((k) => k >= d.today), extra: [], okOnly: false, start: s.start || '', end: s.end || '', due: hasPoll(s) ? s.pollDue : '', notify: hookFor(d, s.series), add: '', msg: '', sending: false });
      setOpen(true);
    }
  }
  const close = () => { setOpen(false); ui.set((x) => ({ ...x, poll: null })); };
  const s = byId(d, st.id);
  const canPoll = s ? hookFor(d, s.series) : false;
  // 昼と夜に分けるグループでは、開始時刻の時間帯の予定を見る
  const part = d.settings.dayParts ? partOf(st.start) : '';
  const days = s ? pollRange(d, s, st.sel, st.extra).map((k) => ({ k, a: dayAvail(d, s, k, part), on: st.sel.indexOf(k) >= 0 })).filter((x) => !st.okOnly || x.a.free || x.on) : [];
  const toggle = (k: string, on: boolean) => setSt((x) => ({ ...x, sel: on ? x.sel.concat(k) : x.sel.filter((y) => y !== k) }));
  // 回答の締め切りは、いちばん早い候補日の前日まで
  const first = st.sel.slice().sort()[0], dueMax = first ? addDaysYmd(first, -1) : undefined;
  const submit = () => {
    if (!s) return;
    const dates = st.sel.slice().sort();
    if (!dates.length) { setSt((x) => ({ ...x, msg: '候補日を1日以上選んでください。' })); return; }
    const wantNotify = st.notify && hookFor(d, s.series);
    setSt((x) => ({ ...x, sending: true, msg: '' }));
    sync.write<RpcResult>('startPoll', { id: s.id, dates, start: st.start, end: st.end, due: st.due, me: me(d) }).then((res) => {
      setSt((x) => ({ ...x, sending: false }));
      close();
      toast(res.message);
      if (!wantNotify) return;
      void discordSend(sync, { kind: 'poll', id: res.id, me: me(d) }, () => {}).then(({ ok, r }) => { toast(res.message + (ok ? '　Discordに送りました。' : '　' + failToast(r))); });
    }, (e: Error) => { setSt((x) => ({ ...x, sending: false, msg: e.message })); });
  };
  return (
    <Modal id="pollModal" open={open && !!s} onClose={close}>
      <form className="box wide" id="pollForm" role="dialog" aria-modal="true" aria-labelledby="pollTitle" tabIndex={-1} onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <div className={wideBar}>
          <h2 className={wideBarTitle} id="pollTitle">{s ? '「' + s.name + '」の日程を調整する' : '日程を調整する'}</h2>
          <button type="button" className="btn small ml-auto" id="pollClose" onClick={close}><Icon name="close" size="sm" />閉じる</button>
        </div>
        <p className="hint" id="pollWho">{s ? '候補日を選んでください。各日の右に、' + peopleOf(s).join('、') + 'の予定が出ます。' + '全員が答えるとGMに知らせが届き、GMが選んだ日が開催日になります。' : ''}</p>
        <div className="row">
          <div className="narrow"><label htmlFor="pollStart">開始</label><input type="time" id="pollStart" step="300" value={st.start} onChange={(ev) => setSt((x) => ({ ...x, start: ev.target.value }))} /></div>
          <div className="narrow"><label htmlFor="pollEnd">終了</label><input type="time" id="pollEnd" step="300" value={st.end} onChange={(ev) => setSt((x) => ({ ...x, end: ev.target.value }))} /></div>
          <div className="narrow"><label htmlFor="pollDue">回答の締め切り</label><input type="date" id="pollDue" min={d.today} max={dueMax} value={st.due} onChange={(ev) => setSt((x) => ({ ...x, due: ev.target.value }))} /></div>
        </div>
        <p className="hint mt-4">締め切りを決めると、前日にまだ答えていない人へ、締め切りが過ぎたらGMへ、Discordで知らせます（空なら決めません）。</p>
        <div className="mt-14 mb-8 flex flex-wrap items-center justify-between gap-8">
          <span className="font-semibold">候補日 <small className="hint" id="pollCount">{(st.sel.length ? st.sel.length + '日を選んでいます' : '') + (d.settings.dayParts ? (st.sel.length ? '。' : '') + (part ? part + 'の予定で見ています' : '開始時刻を入れると、昼か夜の予定で見ます') : '')}</small></span>
          <label className="chk"><input type="checkbox" id="pollOkOnly" checked={st.okOnly} onChange={(ev) => setSt((x) => ({ ...x, okOnly: ev.target.checked }))} /> 全員空きの日だけ</label>
        </div>
        <div id="pollDays" className="max-h-[calc(46dvh/var(--zoom,1))] overflow-auto rounded-md border border-line">
          {days.length ? days.map(({ k, a, on }) => {
            const dow = parseYmd(k).getDay(), hol = holidayName(k);
            return (
              <label className={'m-0 flex cursor-pointer items-center gap-10 border-b border-line px-12 py-8 font-normal last:border-b-0 ' + (on ? 'bg-accent-soft' : 'hover:bg-hover')} key={k}>
                <input type="checkbox" className="pdc" value={k} checked={on} onChange={(ev) => toggle(k, ev.target.checked)} />
                <span className={'min-w-[6.5em] font-semibold' + (dow === 0 || hol ? ' text-sun' : dow === 6 ? ' text-sat' : '')}>{fmtJa(k)}{hol && <small className="text-10 font-normal">{' ' + hol}</small>}</span>
                <span className="flex flex-wrap gap-4 text-12">
                  {!a.items ? <span className={avChip + 'border border-dashed border-line-strong bg-transparent text-muted'}>予定表の範囲外</span>
                    : a.free ? <span className={avChip + 'bg-ok'}>全員空き</span>
                      : a.items.map((x) => <span className={avChip + (AV_BG[x.c] || 'bg-head')} key={x.text}>{x.text}</span>)}
                </span>
              </label>
            );
          }) : <div className="hint p-10">{st.okOnly ? '全員が空いている日はありません。「全員空きの日だけ」を外してください。' : '選べる日がありません。下の欄で日を足してください。'}</div>}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-8">
          <input type="date" className="w-auto" id="pollAddDate" aria-label="候補に足す日" value={st.add} onChange={(ev) => setSt((x) => ({ ...x, add: ev.target.value }))} />
          <button type="button" className="btn small" id="pollAddBtn" onClick={() => {
            const k = st.add; if (!k) return;
            if (k < d.today) { setSt((x) => ({ ...x, msg: '過ぎた日は候補にできません。' })); return; }
            setSt((x) => ({ ...x, msg: '', extra: x.extra.concat(k), sel: x.sel.indexOf(k) >= 0 ? x.sel : x.sel.concat(k), add: '' }));
          }}><Icon name="add" size="sm" />日を足す</button>
        </div>
        <div className={formActions}>
          <div className="btns mt-0">
            <label><input type="checkbox" id="pollNotify" disabled={!canPoll} checked={st.notify && canPoll} onChange={(ev) => setSt((x) => ({ ...x, notify: ev.target.checked }))} /> Discordで知らせる <span className="hint" id="pollNotifyHint">{canPoll ? '' : '（チャンネル未設定）'}</span></label>
            <button type="submit" className="btn primary ml-auto" id="pollSend" disabled={!st.sel.length || st.sending}>{s && hasPoll(s) ? 'この候補日に変える' : 'この候補日で聞く'}</button>
          </div>
          <div className="mt-6 text-err-text empty:hidden" id="pollMsg" role="alert">{st.msg}</div>
        </div>
      </form>
    </Modal>
  );
}
