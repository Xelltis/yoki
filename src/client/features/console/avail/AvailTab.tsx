// メンバーの予定のタブ。予定表（狭い画面では日ごとのリスト）・絞り込み・まとめて入れる・いつもの予定・自分の印と予定のメモ
import { useEffect, useRef, useState } from 'react';
import type { ConsoleData, ConsoleSession, RpcResult } from '../../../../shared/api';
import type { Part } from '../../../../shared/parts';
import { load, store } from '../../../app/storage';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { PageHead } from '../../../ui/PageHead';
import { Tip } from '../../../ui/Tip';
import { createStore, useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { WD, fmtJa } from '../model/dates';
import { active, isAdjusting, isRecruit, markOn, me, peopleOf, sortSessions, sortedActive } from '../model/model';
import { withAvail, withAvailNote } from '../model/optimistic';
import { checkPill, notice } from '../styles';
import { AvailList, AvailTable } from './AvailTable';
import { WeeklyCard } from './WeeklyCard';
import { type AvailFilter, type Mark, activeNames, availRows, markIn, targetNames, visibleNames } from './rows';

const ALL_WDS = [0, 1, 2, 3, 4, 5, 6];
/** 絞り込み。タブを移っても、この画面を開いているあいだは残す。卓で絞る・参加者だけは、あなたごとにこの端末に控える */
const filterStore = createStore<AvailFilter & { mineFor: string }>({ members: null, wds: ALL_WDS, hol: false, free: false, mineOnly: false, from: '', to: '', cond: '', target: '（なし）', only: false, mineFor: '' });
/** 卓の多い人を左に（この端末に控える。卓をまとめて変える表と同じ） */
export const sortStore = createStore(load('sortByLoad') !== '0');
const afKey = (k: string, mine: string) => 'av' + k + ':' + (mine || '-');
/** まとめて入れるの入力（タブを移っても残す）。markの 'none' は印を変えない。partは時間帯（昼と夜に分けるグループだけ）。noteModeは メモを '' 変えない・'set' 入れる・'clear' 消す */
const bulkStore = createStore({ mark: '△', part: '', from: '', to: '', wds: ALL_WDS, keep: true, noteMode: '', note: '' });

/** 絞り込み・まとめて入れるの枠（名前と欄を2列に並べる。狭い画面では1列） */
const pgrid = 'grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-16 gap-y-10 max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-4';
const plabel = 'm-0 text-12 font-semibold text-muted max-sm:mt-6';
const pctl = 'flex min-w-0 flex-wrap items-center gap-6';
const panelBtns = 'btns mt-14 border-t border-line pt-12';
/** 表の上の絞り込みのボタン（押すたびに入り切り） */
const avChip = 'h-32 cursor-pointer rounded-full border border-line bg-card px-12 py-0 font-inherit text-13 font-semibold text-muted hover:bg-hover aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-accent-text max-tab:flex-none';

const COND_TEXT: Record<string, string> = { '': 'すべての日', has: '卓のある日', free: '卓のない日', soft: '表示中の誰も × を付けていない日' };

/** 表の上の注意。動いている卓に、メンバーに無い参加者がいる */
function UnknownWarn({ d }: { d: ConsoleData }) {
  const names = d.members.map((m) => m.name), unknown: string[] = [];
  sortedActive(d).forEach((s) => { peopleOf(s).forEach((n) => { if (names.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n); }); });
  return (
    <div id="unknownWarn">
      {unknown.length > 0 && <div className={notice('adjust', false) + ' mb-8'}><Icon name="warning" />{'メンバーに無い参加者: ' + unknown.join('、') + '　→ 管理画面の「メンバー」で足すと、予定表に列ができます。'}</div>}
    </div>
  );
}

export function AvailTab() {
  const d = useData();
  const { sync } = useConsole();
  const mine = me(d);
  const stored = useStore(filterStore), sortByLoad = useStore(sortStore), bulk = useStore(bulkStore);
  const [fold, setFold] = useState({ availFilter: load('fold.availFilter') === '1', availBulk: load('fold.availBulk') === '1' });
  const [bulkMsg, setBulkMsg] = useState({ text: '', running: false });
  const [memo, setMemo] = useState<{ day: string; text: string; had: boolean } | null>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null), wrapRef = useRef<HTMLDivElement>(null), suppress = useRef(false);
  // 卓で絞る・参加者だけは、あなたごとに控えたものから始める（描き終わったら入れ物にも入れる）
  const f = stored.mineFor === mine ? stored : { ...stored, mineFor: mine, target: load(afKey('Target', mine)) || '（なし）', only: load(afKey('Only', mine)) === '1' };
  useEffect(() => { if (filterStore.get().mineFor !== f.mineFor) filterStore.set(f); });
  const setF = (patch: Partial<AvailFilter>) => {
    filterStore.set({ ...f, ...patch });
    if ('target' in patch || 'only' in patch) { const n = { ...f, ...patch }; store(afKey('Target', mine), n.target); store(afKey('Only', mine), n.only ? '1' : ''); }
  };
  const targetOpts = active(d).map((s) => s.name);
  const target = targetOpts.indexOf(f.target) >= 0 ? f.target : '（なし）';
  const ff: AvailFilter = { ...f, target };
  const names = visibleNames(d, ff, mine, sortByLoad), rows = availRows(d, ff, names);
  const filtering = !!(f.from || f.to || f.members || f.wds.length < 7 || f.cond || targetNames(d, ff) || activeNames(d, ff) || f.hol || f.free || f.mineOnly);
  const summary = filtering ? '絞り込み中: ' + rows.length + '日' + (f.members || targetNames(d, ff) || activeNames(d, ff) || f.mineOnly ? '・' + names.length + '人' : '') + (f.cond ? '・' + COND_TEXT[f.cond] : '') : '';
  const bulkFrom = bulk.from || d.today, bulkTo = bulk.to || d.availDays[d.availDays.length - 1] || '';
  const hotRec = sortSessions(active(d).filter(isRecruit)), hotAdj = sortSessions(active(d).filter(isAdjusting));

  /* 表をつかんで動かす（マウス）。少し動かしたら、押したことにしない。動かしているあいだは自動の読み直しを待つ（.wrap.dragging） */
  useEffect(() => {
    const w = wrapRef.current!;
    let drag: { x: number; y: number; l: number; t: number; moved: boolean } | null = null;
    const down = (e: MouseEvent) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, l: w.scrollLeft, t: w.scrollTop, moved: false }; };
    const move = (e: MouseEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      drag.moved = true; w.classList.add('dragging');
      w.scrollLeft = drag.l - dx; w.scrollTop = drag.t - dy; e.preventDefault();
    };
    const up = () => {
      if (drag && drag.moved) { suppress.current = true; setTimeout(() => { suppress.current = false; }, 0); }
      drag = null; w.classList.remove('dragging');
    };
    // ほかの人のマスのメモは、押すと吹き出しで全文（マスはボタンではないので、表で受ける）
    const click = (ev: MouseEvent) => {
      if (suppress.current) return;
      const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>('td[data-memo-of]') : null;
      if (t && t.dataset.memo) toast(fmtJa(t.dataset.day!) + ' ' + t.dataset.memoOf + ': ' + t.dataset.memo);
    };
    w.addEventListener('mousedown', down);
    w.addEventListener('click', click);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { w.removeEventListener('mousedown', down); w.removeEventListener('click', click); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const toggleFold = (id: 'availFilter' | 'availBulk') => setFold((x) => { const open = !x[id]; store('fold.' + id, open ? '1' : '0'); return { ...x, [id]: open }; });
  /** 自分の印を変える（partは時間帯。昼と夜に分けないなら ''）。押した瞬間に画面へ出し、保存できなかったら戻す */
  const setMark = (key: string, next: Mark, part: Part | '') => {
    if (suppress.current || !mine) return;
    const cur = markOn(d, key, mine, part);
    if (next === markIn({ [mine]: cur }, mine)) return;
    sync.write<RpcResult>('setAvailability', { name: mine, ymd: key, mark: next, part }, { optimistic: (x) => withAvail(x, key, mine, next, part), rollback: (x) => withAvail(x, key, mine, cur, part) })
      .then(() => toast(fmtJa(key) + (part ? 'の' + part : '') + ' ' + mine + ': ' + (next || '空欄')), (e: Error) => toast('保存できませんでした: ' + e.message));
  };
  const openMemo = (key: string) => {
    if (suppress.current || !mine) return;
    const cur = ((d.availNotes || {})[key] || {})[mine];
    setMemo({ day: key, text: cur ? cur.text : '', had: !!cur });
    setTimeout(() => memoRef.current?.focus(), 0);
  };
  /** 予定のメモ。押した瞬間に画面へ出し、返事で確定する */
  const saveMemo = (text: string) => {
    if (!memo || !mine) return;
    const key = memo.day;
    setMemo(null);
    sync.write<RpcResult>('setAvailNote', { name: mine, ymd: key, text }, { optimistic: (x) => withAvailNote(x, key, mine, text) })
      .then((res) => toast(res.message), (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  const runBulk = () => {
    if (!mine) return;
    const skipMark = bulk.mark === 'none', note = bulk.noteMode === 'set' ? bulk.note.trim() : bulk.noteMode === 'clear' ? '' : undefined;
    const part = d.settings.dayParts ? bulk.part : '';
    const form = { name: mine, from: bulkFrom, to: bulkTo, weekdays: bulk.wds.slice().sort(), mark: skipMark ? '' : bulk.mark, part, skipMark, note, keep: bulk.keep };
    if (!form.from || !form.to) { setBulkMsg({ text: '期間を入れてください。', running: false }); return; }
    if (!form.weekdays.length) { setBulkMsg({ text: '曜日を選んでください。', running: false }); return; }
    if (skipMark && note === undefined) { setBulkMsg({ text: '入れる印かメモを選んでください。', running: false }); return; }
    if (bulk.noteMode === 'set' && !note) { setBulkMsg({ text: '入れるメモを書いてください。', running: false }); return; }
    const markText = bulk.mark === '△' ? '△ 調整すれば可' : bulk.mark === '×' ? '× 不可' : '空欄に戻す（参加できる）';
    const what = [skipMark ? '' : (part ? part + 'に' : '') + '「' + markText + '」', note ? 'メモ「' + note + '」' : ''].filter(Boolean).join('と');
    const message = mine + 'の' + fmtJa(form.from) + '〜' + fmtJa(form.to) + '（' + form.weekdays.map((x) => WD[x]).join('') + '）' + (what ? 'に' + what + 'を入れます。' : 'のメモを消します。')
      + (what && note === '' ? 'メモは消します。' : '') + (form.keep ? '\n入力済みのマスは残します。' : '\n入力済みのマスも上書きします。');
    askConfirm({ title: '自分の列にまとめて入れますか？', message, ok: '入れる' }, () => {
      setBulkMsg({ text: '保存しています…', running: true });
      sync.write<RpcResult>('setAvailabilityBulk', form).then((res) => { setBulkMsg({ text: res.message, running: false }); toast(res.message); },
        (e: Error) => { setBulkMsg({ text: e.message, running: false }); toast(e.message); });
    });
  };
  const hotChip = (s: ConsoleSession, label: string) => (
    // 卓の名前が長くても、札の中で折り返す（高さを決めると字が重なる）
    <button type="button" className={'min-h-28 cursor-pointer rounded-[14px] border px-10 py-3 text-left font-inherit text-12 leading-[1.45] font-semibold ' + (target === s.name ? 'border-transparent bg-accent-strong text-accent-ink' : 'border-line bg-card text-fg hover:bg-hover')} data-hot={s.name} key={s.id} onClick={() => setF({ target: target === s.name ? '（なし）' : s.name })}>
      {s.name}<span className="hint">{' ' + label}</span>
    </button>
  );
  const wdsBox = (sel: number[], set: (wds: number[]) => void, cls: string) => (
    <span className="inline-flex flex-wrap gap-6" id={cls === 'afwd' ? 'afWds' : 'abWds'}>
      {WD.map((w, i) => (
        <label className={checkPill + (i === 0 ? 'text-sun' : i === 6 ? 'text-sat' : '')} key={i}>
          <input type="checkbox" className={cls} value={i} checked={sel.indexOf(i) >= 0} onChange={(ev) => set(ev.target.checked ? sel.concat(i) : sel.filter((x) => x !== i))} />
          {w}
        </label>
      ))}
    </span>
  );
  const memberChecked = (n: string) => !f.members || f.members.indexOf(n) >= 0;
  const setMembers = (list: string[]) => setF({ members: list.length === d.members.length ? null : list });

  return (
    <section id="tab-avail">
      <PageHead
        title={<>メンバーの予定 <Tip text={(d.settings.dayParts ? 'このグループは、予定を昼（左）と夜（右）に分けて入れます。' : '') + "自分の列のマスをタップすると 空 → △ → × → 空 と変わります。空欄は「参加できる」扱いです。マスの右上の鉛筆（マウスを載せると出ます）で、その日のメモ（「21時から」など）を書けます。ほかの人の列は見るだけです。スマホでは日ごとのリストになり、◯ △ × のボタンで選べます。"} label="予定表の使い方" /></>}
        lead="空欄は「参加できる」扱いです。都合の悪い日だけ、自分の印（△ か ×）を付けます。" />
      <UnknownWarn d={d} />
      <div id="availHot" className="mb-12 flex flex-wrap items-center gap-x-8 gap-y-6 rounded-lg border border-[color-mix(in_srgb,var(--soon-text)_35%,var(--line))] bg-soon px-10 py-8 text-13" hidden={!hotRec.length && !hotAdj.length}>
        {(hotRec.length > 0 || hotAdj.length > 0) && (
          <>
            <span className="inline-flex items-center gap-4 font-semibold"><Icon name="campaign" size="sm" className="text-soon-text" />日が未定の卓</span>
            {hotRec.map((s) => hotChip(s, '募集　' + (s.windowLabel || '期間未定')))}
            {hotAdj.map((s) => hotChip(s, '調整　' + (s.windowLabel || '期間未定')))}
            <span className="hint">押すと、その卓の人だけに絞ります</span>
          </>
        )}
      </div>
      <div className="mb-12 flex flex-wrap items-center gap-8">
        <button type="button" className={'btn small' + (fold.availFilter ? ' on bg-head' : '')} id="foldFilter" data-target="availFilter" aria-expanded={fold.availFilter ? 'true' : 'false'} onClick={() => toggleFold('availFilter')}>
          <Icon name={fold.availFilter ? 'expand_more' : 'chevron_right'} size="sm" className="-ml-4" />絞り込み
        </button>
        <Tip className="ml-2" text="出す人・期間・曜日をしぼります。卓を選ぶと、その卓のGMと参加者だけになります。" label="絞り込みとは" />
        <span className="hint" id="afSummary">{summary}</span>
        <button type="button" className={'btn small' + (fold.availBulk ? ' on bg-head' : '')} id="foldBulk" data-target="availBulk" aria-expanded={fold.availBulk ? 'true' : 'false'} onClick={() => toggleFold('availBulk')}>
          <Icon name={fold.availBulk ? 'expand_more' : 'chevron_right'} size="sm" className="-ml-4" />まとめて入れる
        </button>
        <Tip className="ml-2" text="自分の列に、期間と曜日を決めて △ か × とメモをまとめて入れます。旅行のような何日か続く予定に使えます。印は、卓のある日を飛ばします。" label="まとめて入れるとは" />
        {/* 列の並び順は表だけのもの。狭い画面の日ごとのリストでは出さない */}
        <label className="chk ml-auto max-tab:hidden!">
          <input type="checkbox" id="sortByLoad" checked={sortByLoad} onChange={(ev) => { store('sortByLoad', ev.target.checked ? '1' : '0'); sortStore.set(ev.target.checked); }} /> 卓の多い人を左に
        </label>
        <Tip className="ml-2 max-tab:hidden!" text="いま動いている卓に多く入っている人ほど、左の列に並べます。外すと登録した順になります。" label="並び順" />
      </div>
      <div className="card" id="availFilter" hidden={!fold.availFilter}>
        <h3>絞り込み</h3>
        <div className={pgrid}>
          <span className={plabel}>卓</span>
          <div className={pctl}><label className="chk"><input type="checkbox" id="afOnly" checked={f.only} onChange={(ev) => setF({ only: ev.target.checked })} /> どれかの卓に入っている人だけ</label></div>
          <span className={plabel}>メンバー</span>
          <div className={pctl}>
            <span className="inline-flex flex-wrap gap-6" id="afMembers">
              {d.members.map((m) => (
                <label className={checkPill} key={m.name}>
                  <input type="checkbox" className="afm" value={m.name} checked={memberChecked(m.name)}
                    onChange={(ev) => { const cur = d.members.map((x) => x.name).filter(memberChecked); setMembers(ev.target.checked ? cur.concat(m.name) : cur.filter((x) => x !== m.name)); }} />
                  {m.name}
                </label>
              ))}
            </span>
            <button type="button" className="btn small" id="afMe" onClick={() => { if (mine) setMembers([mine]); }}>自分だけ</button>
            <button type="button" className="btn small" id="afAllMembers" onClick={() => setF({ members: null })}>全員</button>
          </div>
          <span className={plabel}>期間</span>
          <div className={pctl}>
            <input type="date" id="afFrom" aria-label="絞り込みの始まり" value={f.from} onChange={(ev) => setF({ from: ev.target.value })} /><span>〜</span>
            <input type="date" id="afTo" aria-label="絞り込みの終わり" value={f.to} onChange={(ev) => setF({ to: ev.target.value })} />
          </div>
          <span className={plabel}>曜日</span>
          <div className={pctl}>{wdsBox(f.wds, (wds) => setF({ wds }), 'afwd')}</div>
          <label className={plabel} htmlFor="afCond">条件</label>
          <div className={pctl}>
            <select id="afCond" value={f.cond} onChange={(ev) => setF({ cond: ev.target.value })}>
              {Object.keys(COND_TEXT).map((k) => <option value={k} key={k}>{COND_TEXT[k]}</option>)}
            </select>
          </div>
        </div>
        <div className={panelBtns}>
          <button type="button" className="btn small" id="afReset" onClick={() => setF({ from: '', to: '', cond: '', target: '（なし）', only: false, hol: false, free: false, mineOnly: false, members: null, wds: ALL_WDS })}>解除</button>
          <span id="afMsg" className="hint">{filtering ? rows.length + '日を表示' : ''}</span>
        </div>
      </div>
      <div className="card" id="availBulk" hidden={!fold.availBulk}>
        <h3>自分の列にまとめて入れる</h3>
        <div className={pgrid}>
          <label className={plabel} htmlFor="abMark">印</label>
          <div className={pctl}>
            <select id="abMark" value={bulk.mark} onChange={(ev) => bulkStore.set((x) => ({ ...x, mark: ev.target.value }))}>
              <option value="△">△ 調整すれば可</option><option value="×">× 不可</option><option value="">空欄に戻す（参加できる）</option><option value="none">印は変えない</option>
            </select>
          </div>
          {d.settings.dayParts && (
            <>
              <label className={plabel} htmlFor="abPart">時間帯</label>
              <div className={pctl}>
                <select id="abPart" value={bulk.part} onChange={(ev) => bulkStore.set((x) => ({ ...x, part: ev.target.value }))}>
                  <option value="">昼と夜の両方（1日）</option><option value="昼">昼だけ</option><option value="夜">夜だけ</option>
                </select>
              </div>
            </>
          )}
          <label className={plabel} htmlFor="abNoteMode">メモ</label>
          <div className={pctl}>
            <select id="abNoteMode" value={bulk.noteMode} onChange={(ev) => bulkStore.set((x) => ({ ...x, noteMode: ev.target.value }))}>
              <option value="">変えない</option><option value="set">入れる</option><option value="clear">消す</option>
            </select>
            {bulk.noteMode === 'set' && (
              <input type="text" className="w-auto min-w-0 flex-1" id="abNote" maxLength={200} placeholder="例: 旅行・出張" aria-label="まとめて入れるメモ" value={bulk.note}
                onChange={(ev) => bulkStore.set((x) => ({ ...x, note: ev.target.value }))} />
            )}
          </div>
          <span className={plabel}>期間</span>
          <div className={pctl}>
            <input type="date" id="abFrom" aria-label="入れる期間の始まり" value={bulkFrom} onChange={(ev) => bulkStore.set((x) => ({ ...x, from: ev.target.value }))} /><span>〜</span>
            <input type="date" id="abTo" aria-label="入れる期間の終わり" value={bulkTo} onChange={(ev) => bulkStore.set((x) => ({ ...x, to: ev.target.value }))} />
          </div>
          <span className={plabel}>曜日</span>
          <div className={pctl}>
            {wdsBox(bulk.wds, (wds) => bulkStore.set((x) => ({ ...x, wds })), 'wd')}
            <button type="button" className="btn small" id="abWeekday" onClick={() => bulkStore.set((x) => ({ ...x, wds: [1, 2, 3, 4, 5] }))}>平日</button>
            <button type="button" className="btn small" id="abWeekend" onClick={() => bulkStore.set((x) => ({ ...x, wds: [0, 6] }))}>土日</button>
            <button type="button" className="btn small" id="abAll" onClick={() => bulkStore.set((x) => ({ ...x, wds: ALL_WDS }))}>全曜日</button>
          </div>
        </div>
        <div className={panelBtns}>
          <label className="chk"><input type="checkbox" id="abKeep" checked={bulk.keep} onChange={(ev) => bulkStore.set((x) => ({ ...x, keep: ev.target.checked }))} /> 入力済みは残す</label>
          <button type="button" className="btn primary" id="abRun" disabled={bulkMsg.running} onClick={runBulk}>自分の列に入れる</button>
          <span id="abMsg" className="hint">{bulkMsg.text}</span>
        </div>
      </div>
      <WeeklyCard hidden={!fold.availBulk} />
      {/* よく使う絞り込みは、表の上に常に出す（詳しい条件は上の「絞り込み」） */}
      <div className="mb-10 flex flex-wrap items-center gap-8 max-tab:flex-nowrap max-tab:overflow-x-auto max-tab:[scrollbar-width:none] max-tab:[&::-webkit-scrollbar]:hidden" id="availChips" role="group" aria-label="予定表をしぼる">
        <button type="button" className={avChip} data-chip="hol" aria-pressed={f.hol ? 'true' : 'false'} onClick={() => setF({ hol: !f.hol })}>土日祝だけ</button>
        <button type="button" className={avChip} data-chip="free" aria-pressed={f.free ? 'true' : 'false'} onClick={() => setF({ free: !f.free })}>全員空きだけ</button>
        <button type="button" className={avChip} data-chip="mine" aria-pressed={f.mineOnly ? 'true' : 'false'} onClick={() => setF({ mineOnly: !f.mineOnly })}>自分の列だけ</button>
        <label className="sr-only" htmlFor="afTarget">卓で絞る</label>
        <select className="h-32 min-h-0 w-auto max-w-[16em] rounded-full text-13 max-tab:flex-none" id="afTarget" value={target} onChange={(ev) => setF({ target: ev.target.value })}>
          <option value="（なし）">卓で絞らない</option>
          {targetOpts.map((n) => <option value={n} key={n}>{n}</option>)}
        </select>
        <span className="hint ml-auto max-tab:hidden">自分のマスを押すと 空 → △ → × と変わります</span>
      </div>
      {/* 表をつかんで動かせる（draggingは動かしているあいだ）。狭い画面では隠して、下の日ごとのリストを出す。wrap・avail・draggingは確かめと自動の読み直しが探す印 */}
      {/* 枠は表の幅に合わせる（メンバーが少ないときに、列が横いっぱいに伸びないように） */}
      <div className={'wrap avail w-fit max-w-full max-h-[max(360px,calc((100dvh-40px)/var(--zoom,1)-var(--appbar-h)-var(--nav-h)))] cursor-grab overflow-auto [&.dragging]:cursor-grabbing [&.dragging]:select-none max-tab:hidden'} ref={wrapRef}><AvailTable d={d} names={names} mine={mine} rows={rows} onMark={setMark} onPen={openMemo} /></div>
      {/* 狭い画面（760px以下）では、表の代わりに日ごとのリストを出す。横にスクロールせずに自分の印を打てる */}
      <AvailList d={d} names={names} mine={mine} rows={rows} onMark={setMark} onPen={openMemo} />

      <Modal id="memoModal" open={!!memo} onClose={() => setMemo(null)}>
        <form className="box" id="memoForm" role="dialog" aria-modal="true" aria-labelledby="memoTitle" tabIndex={-1} onSubmit={(ev) => { ev.preventDefault(); saveMemo(memo ? memo.text : ''); }}>
          <h3 id="memoTitle">{memo ? fmtJa(memo.day) + '　' + mine + 'のメモ' : '予定のメモ'}</h3>
          <p className="hint">△ や × とは別に、その日の事情を短く書けます。ほかの人にも見えます。</p>
          <textarea id="memoText" ref={memoRef} maxLength={200} placeholder="例: 21時からなら参加できます" aria-labelledby="memoTitle" value={memo ? memo.text : ''} onChange={(ev) => setMemo((m) => (m ? { ...m, text: ev.target.value } : m))} />
          <div className="btns">
            <button type="button" className="btn danger" id="memoClear" hidden={!memo || !memo.had} onClick={() => saveMemo('')}><Icon name="delete" size="sm" />消す</button>
            <button type="button" className="btn" id="memoCancel" onClick={() => setMemo(null)}>閉じる</button>
            <button type="submit" className="btn primary" id="memoSave">保存</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
