// 卓の登録の窓と変更の窓で共通の欄。どれも入力（f）と、入力を変える関数（set）を受ける
import { type ReactNode, useRef } from 'react';
import { Icon } from '../../../ui/Icon';
import { useData } from '../context';
import { checkPill, checkPills } from '../styles';
import { canNotify, type Fields, type Msg, notifyHint } from './model';

type Props = { f: Fields; set: (patch: Partial<Fields>) => void };

/** シリーズと、シリーズの最終日。onPickは、欄を離れたときに名前が変わっていたら呼ぶ */
export function SeriesRow({ f, set, hint, onPick }: Props & { hint: string; onPick?: (name: string) => void }) {
  const atFocus = useRef('');
  return (
    <div className="row" id="seriesRow">
      <div>
        <label htmlFor="series">シリーズ <small>{hint}</small></label>
        <input type="text" id="series" list="seriesList" placeholder="例: 鉄鳴界の夜明け（1日で終わる卓なら空のまま）" value={f.series}
          onChange={(ev) => set({ series: ev.target.value })}
          onFocus={(ev) => { atFocus.current = ev.target.value; }}
          onBlur={(ev) => { const name = ev.target.value.trim(); if (onPick && name && ev.target.value !== atFocus.current) onPick(name); }} />
      </div>
      <div className="narrow" id="seriesEndWrap" hidden={!f.series.trim()}>
        <label htmlFor="seriesEnd">シリーズの最終日 <small>この日を過ぎると候補から消える</small></label>
        <input type="date" id="seriesEnd" value={f.seriesEnd} onChange={(ev) => set({ seriesEnd: ev.target.value })} />
      </div>
    </div>
  );
}

/** 卓の名前（右に置く欄があればchildren） */
export function NameRow({ f, set, children }: Props & { children?: ReactNode }) {
  return (
    <div className="row">
      <div><label htmlFor="name">卓の名前 <small>必須</small></label><input type="text" id="name" required value={f.name} onChange={(ev) => set({ name: ev.target.value })} /></div>
      {children}
    </div>
  );
}

/** 開催日と時間（開催・終了・中止の卓） */
export function DateRow({ f, set }: Props) {
  return (
    <div className="row" id="dateRow">
      <div className="max-sm:basis-full"><label htmlFor="date">開催日 <small>まだ決まっていなければ状態を「募集」に</small></label><input type="date" id="date" value={f.date} onChange={(ev) => set({ date: ev.target.value })} /></div>
      <div className="narrow"><label htmlFor="start">開始</label><input type="time" id="start" step="300" value={f.start} onChange={(ev) => set({ start: ev.target.value })} /></div>
      <div className="narrow"><label htmlFor="end">終了</label><input type="time" id="end" step="300" value={f.end} onChange={(ev) => set({ end: ev.target.value })} /></div>
    </div>
  );
}

/** 同じ日の重なりや × の注意。止めはせず、気づけるようにするだけ */
export function ConflictWarn({ text }: { text: string }) {
  return (
    <div id="conflictWarn" className="mt-12 flex items-start gap-8 rounded-md bg-soon px-12 py-10 text-13 leading-[1.6] text-fg" hidden={!text}>
      {text && <><Icon name="warning" size="sm" className="mt-2 text-soon-text" /><span>{text}</span></>}
    </div>
  );
}

/** 期間（募集は開きたい期間、調整中は候補の期間） */
export function WindowRow({ f, set }: Props) {
  const rec = f.status === '募集';
  return (
    <div className="row" id="windowRow">
      <div>
        <label htmlFor="winFrom"><span id="winLbl">{rec ? '開きたい期間' : '候補の期間'}</span> <small id="winHint">{rec ? 'この幅のどこかで開きたい、という目安。空なら未定' : 'この期間のどこかで開く。空なら未定'}</small></label>
        <input type="date" id="winFrom" value={f.winFrom} onChange={(ev) => set({ winFrom: ev.target.value })} />
      </div>
      <div><label htmlFor="winTo">まで</label><input type="date" id="winTo" value={f.winTo} onChange={(ev) => set({ winTo: ev.target.value })} /></div>
    </div>
  );
}

/** GMと参加者（募集の卓は、参加者を決めないので出さない） */
export function PeopleFields({ f, set }: Props) {
  const d = useData();
  return (
    <>
      <div className="row">
        <div><label htmlFor="gm">GM</label><input type="text" id="gm" list="memberList" value={f.gm} onChange={(ev) => set({ gm: ev.target.value })} /></div>
      </div>
      <fieldset id="membersRow" hidden={f.status === '募集'}>
        <legend>参加者</legend>
        <div className={checkPills} id="membersBox">
          {d.members.length ? d.members.map((m) => (
            <label className={checkPill} key={m.name}>
              <input type="checkbox" value={m.name} className="m" checked={f.members.indexOf(m.name) >= 0}
                onChange={(ev) => set({ members: ev.target.checked ? f.members.concat(m.name) : f.members.filter((x) => x !== m.name) })} />
              {m.name}
            </label>
          )) : <span className="hint">管理画面の「メンバー」で名前を足すと、ここにチェック欄が出ます。</span>}
        </div>
        <input type="text" id="extra" placeholder="メンバーに無い人は、ここに「、」区切りで" aria-label="メンバーに無い参加者" value={f.extra} onChange={(ev) => set({ extra: ev.target.value })} />
      </fieldset>
    </>
  );
}

/** 場所とメモ */
export function PlaceMemo({ f, set }: Props) {
  return (
    <>
      <label htmlFor="place">場所 / URL</label><input type="text" id="place" value={f.place} onChange={(ev) => set({ place: ev.target.value })} />
      <label htmlFor="memo">メモ</label><textarea id="memo" value={f.memo} onChange={(ev) => set({ memo: ev.target.value })} />
    </>
  );
}

/** Discordに知らせる（送り先が無ければ押せない） */
export function NotifyCheck({ f, set, label }: Props & { label: string }) {
  const d = useData();
  return (
    <div className="btns justify-start">
      <label><input type="checkbox" id="notify" disabled={!canNotify(d, f)} checked={f.notify} onChange={(ev) => set({ notify: ev.target.checked })} /> {label} <span className="hint" id="notifyHint">{notifyHint(d, f)}</span></label>
    </div>
  );
}

/** 窓の下の文（案内か失敗） */
export function FormMsg({ msg }: { msg: Msg }) {
  return <div id="msg" role="status" className={'mt-6 empty:hidden' + (msg && msg.cls === 'ok' ? ' text-ok-text' : msg && msg.cls === 'err' ? ' text-err-text' : '')}>{msg ? msg.text : ''}</div>;
}
