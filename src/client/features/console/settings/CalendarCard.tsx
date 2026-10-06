// 設定のタブの「カレンダー連携」。購読URL（人とグループごと）と、Googleカレンダーとの連携（人ごと）。どちらも本人だけの設定
import { useState } from 'react';
import type { FeedScope, RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { checkRow, field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';

/** 時間帯の選び方（30分おき）。終わりは24:00まで */
const TIMES = Array.from({ length: 49 }, (_, i) => String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'));

/** Googleカレンダーの「URLで追加」を開く（webcalの形で渡す） */
const googleSubscribeUrl = (feedUrl: string) => 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(feedUrl.replace(/^https?:/, 'webcal:'));

const sub = 'mt-18 mb-4 flex items-center gap-6 text-14 font-bold';

export function CalendarCard() {
  const d = useData();
  const { sync, groupId } = useConsole();
  const cal = d.calendar;
  const g = cal.google;
  const [busy, setBusy] = useState(false);
  /** 購読URLを作る前に選んだ、載せる卓（作ったあとは、サーバーの値） */
  const [pickScope, setPickScope] = useState<FeedScope>('mine');
  /** Google連携の書きかけ（保存するまで、読み直しても上書きしない） */
  const [draft, setDraft] = useState<{ write: boolean; read: boolean; from: string; to: string } | null>(null);
  const opts = draft ?? (g ? { write: g.write, read: g.read, from: g.from, to: g.to } : { write: true, read: true, from: '19:00', to: '23:00' });

  const run = (fn: Parameters<typeof sync.write>[0], form: Record<string, unknown> = {}, after?: () => void) => {
    setBusy(true);
    sync.write<RpcResult>(fn, form).then(
      (res) => { setBusy(false); toast(res.message); after?.(); },
      (e: Error) => { setBusy(false); toast(e.message); },
    );
  };
  const copy = () => {
    if (!cal.feed) return;
    navigator.clipboard.writeText(cal.feed.url).then(() => toast('購読URLをコピーしました。'), () => toast('コピーできませんでした。URLを選んでコピーしてください。'));
  };
  const scope: FeedScope = cal.feed ? cal.feed.scope : pickScope;

  return (
    <div className="card" id="calendarCard">
      <h3><Icon name="event" size="sm" />カレンダー連携</h3>
      <p className="hint">卓予定の卓を、ふだん使っているカレンダーに出します。ここの設定は、あなただけのものです。</p>

      <h4 className={sub}>購読URL（iCal）</h4>
      <p className="hint">
        {'URLをカレンダーのアプリに登録すると、開催が決まった卓が並びます。Googleカレンダーは、取り込み直すまで数時間から1日かかります。'
          + 'URLを知っている人は、だれでも卓を読めます。人に渡さないでください。'}
      </p>
      <label className={fieldLabel} htmlFor="feedScope">載せる卓</label>
      <select className={field} id="feedScope" value={scope} disabled={busy} onChange={(ev) => { const v = ev.target.value as FeedScope; if (cal.feed) run('saveCalendarFeed', { scope: v }); else setPickScope(v); }}>
        <option value="mine">自分が入る卓だけ（GMか参加者）</option>
        <option value="all">グループの卓すべて</option>
      </select>
      {cal.feed ? (
        <>
          <label className={fieldLabel} htmlFor="feedUrl">購読URL</label>
          <input type="text" className={field} id="feedUrl" readOnly value={cal.feed.url} onFocus={(ev) => ev.target.select()} />
          <div className="btns">
            <button type="button" className="btn" id="feedCopy" onClick={copy}><Icon name="content_copy" size="sm" />コピー</button>
            <a className="btn" id="feedGoogle" href={googleSubscribeUrl(cal.feed.url)} target="_blank" rel="noopener"><Icon name="open_in_new" size="sm" />Googleカレンダーに追加</a>
            <button type="button" className="btn" id="feedRenew" disabled={busy} onClick={() => askConfirm(
              { title: '購読URLを作り直しますか？', message: '新しいURLに変わり、今のURLは読めなくなります。登録したカレンダーでも、新しいURLを登録し直してください。', ok: '作り直す' },
              () => run('saveCalendarFeed', { scope, renew: true }),
            )}><Icon name="refresh" size="sm" />作り直す</button>
            <button type="button" className="btn danger" id="feedStop" disabled={busy} onClick={() => askConfirm(
              { title: '購読URLを止めますか？', message: '今のURLは読めなくなります。', ok: '止める', danger: true },
              () => run('deleteCalendarFeed'),
            )}><Icon name="close" size="sm" />止める</button>
          </div>
        </>
      ) : (
        <div className="btns">
          <button type="button" className="btn primary" id="feedCreate" disabled={busy} onClick={() => run('saveCalendarFeed', { scope })}><Icon name="add" size="sm" />購読URLを作る</button>
        </div>
      )}

      <h4 className={sub}>Googleカレンダーと連携</h4>
      {!cal.googleReady ? (
        <p className="hint" id="googleOff">運営者がGoogleカレンダーとの連携を設定していないので、使えません。</p>
      ) : !g ? (
        <>
          <p className="hint">
            {'Googleのアカウントで連携すると、参加する卓をあなたのGoogleカレンダーに書き込み、Googleカレンダーの予定から予定表に × と △ を入れます。'
              + '卓の変更は、すぐに書き直します。'}
          </p>
          <div className="btns">
            <a className="btn primary" id="googleLink" href={'/auth/google/start?return_to=' + encodeURIComponent('/g/' + groupId + '/settings/')}><Icon name="login" size="sm" />Googleと連携する</a>
          </div>
        </>
      ) : (
        <form id="googleForm" onSubmit={(ev) => { ev.preventDefault(); run('saveGoogleSettings', opts, () => setDraft(null)); }}>
          <p className="hint" id="googleEmail"><b>{g.email}</b> と連携しています。{g.syncedAt ? '最後に書き込んだ: ' + g.syncedAt + '。' : ''}{g.busyAt ? '最後に予定を読んだ: ' + g.busyAt + '。' : ''}</p>
          {g.error && <p className="hint text-err-text" id="googleError" role="alert"><Icon name="warning" size="sm" />{g.error}</p>}
          <label className={checkRow}><input type="checkbox" id="googleWrite" checked={opts.write} onChange={(ev) => setDraft({ ...opts, write: ev.target.checked })} /> 参加する卓をGoogleカレンダーに書き込む</label>
          <label className={checkRow}><input type="checkbox" id="googleRead" checked={opts.read} onChange={(ev) => setDraft({ ...opts, read: ev.target.checked })} /> Googleカレンダーの予定から、予定表に × と △ を入れる</label>
          <div className="row">
            <div>
              <label className={fieldLabel} htmlFor="googleFrom">時間帯 <small className={fieldNote}>この時間が埋まっていれば ×、一部なら △</small></label>
              <span className="flex items-center gap-6">
                <select className="w-auto" id="googleFrom" value={opts.from} disabled={!opts.read} onChange={(ev) => setDraft({ ...opts, from: ev.target.value })}>
                  {TIMES.slice(0, -1).map((t) => <option key={t}>{t}</option>)}
                </select>
                〜
                <select className="w-auto" id="googleTo" value={opts.to} disabled={!opts.read} onChange={(ev) => setDraft({ ...opts, to: ev.target.value })}>
                  {TIMES.slice(1).map((t) => <option key={t}>{t}</option>)}
                </select>
              </span>
            </div>
          </div>
          <p className="hint">自分で入れた印と、Googleから入った印を自分で消した日には入れません。卓に入っている日にも入れません。</p>
          <div className="btns">
            <button type="submit" className="btn primary" id="googleSave" disabled={busy || !draft}>保存</button>
            <button type="button" className="btn" id="googleSync" disabled={busy} onClick={() => run('syncGoogleNow')}><Icon name="sync" size="sm" />今すぐ同期</button>
            <button type="button" className="btn danger" id="googleUnlink" disabled={busy} onClick={() => askConfirm(
              { title: 'Googleとの連携を外しますか？', message: '書き込んだ卓の予定と、Googleの予定から入れた予定表の印を消します。', ok: '外す', danger: true },
              () => run('unlinkGoogle', {}, () => setDraft(null)),
            )}><Icon name="link_off" size="sm" />連携を外す</button>
          </div>
        </form>
      )}
    </div>
  );
}
