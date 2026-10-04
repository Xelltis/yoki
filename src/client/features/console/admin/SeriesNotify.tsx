// 管理画面の「知らせ」の「シリーズごとの上書き」。シリーズ専用のチャンネルと、開催前の知らせの日時
import { useState } from 'react';
import type { ConsoleData, RpcResult, SeriesNotifyView } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { toast } from '../../../ui/toast';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { me, seriesNames } from '../model/model';
import { baseDays, baseHour, hasVal, readWhen, snEntry, whenText } from '../model/notify';
import { ChannelSelect, channelLabel, useChannels } from './channels';
import { useCall } from './useCall';

type Fields = { channel: string; alsoBase: boolean; same: boolean; days: string; hour: string };
const fieldsOf = (d: ConsoleData, e: SeriesNotifyView | null): Fields => ({
  channel: e ? e.channelId : '', alsoBase: e ? !!e.alsoBase : true, same: !(e && (hasVal(e.days) || hasVal(e.hour))),
  days: String(e && hasVal(e.days) ? e.days : baseDays(d)), hour: String(e && hasVal(e.hour) ? e.hour : baseHour(d)),
});

export function SeriesNotify() {
  const d = useData();
  const { sync } = useConsole();
  const { busy, msg, setMsg, call } = useCall();
  const { list: chans } = useChannels();
  const list = d.seriesNotify || [], names = seriesNames(d).slice();
  list.forEach((x) => { if (names.indexOf(x.series) < 0) names.push(x.series); });
  const [sel, setSel] = useState('');
  const name = names.indexOf(sel) >= 0 ? sel : '';
  const e = name ? snEntry(d, name) : null;
  /** 書きかけ（保存するまで、読み直しても上書きしない） */
  const [draft, setDraft] = useState<Fields | null>(null);
  /** 保存しようとして正しくなかった欄と、知らせが失敗か */
  const [bad, setBad] = useState({ d: false, h: false, msg: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const f = draft || fieldsOf(d, e);
  const edit = (patch: Partial<Fields>) => setDraft({ ...f, ...patch });
  const pick = (n: string) => { setSel(n); setDraft(null); setMsg('snMsg', ''); setBad({ d: false, h: false, msg: false }); };
  const where = (x: SeriesNotifyView | null, withName?: boolean): string => {
    if (!x || !x.channelId) return d.channelSet ? '基本のチャンネル' : '送り先なし（基本のチャンネルが未設定）';
    return '専用のチャンネル' + (withName ? '（' + channelLabel(chans, x.channelId) + '）' : '') + (x.alsoBase && d.channelSet ? ' ＋ 基本のチャンネル' : '');
  };
  const whenOf = (x: SeriesNotifyView | null): string => {
    if (!x || (!hasVal(x.days) && !hasVal(x.hour))) return '基本と同じ（' + whenText(baseDays(d), baseHour(d)) + '）';
    return whenText(hasVal(x.days) ? x.days : baseDays(d), hasVal(x.hour) ? x.hour : baseHour(d));
  };
  const save = () => {
    if (!name) return;
    const form: Record<string, unknown> = { series: name, alsoBase: f.alsoBase, days: '', hour: '', me: me(d) };
    if (!f.same) {
      const wn = readWhen(f.days, f.hour);
      if (wn.err) { setMsg('snMsg', wn.err); setBad({ d: !wn.dOk, h: !wn.hOk, msg: true }); return; }
      form.days = String(wn.days); form.hour = String(wn.hour);
    }
    setBad({ d: false, h: false, msg: false });
    // チャンネルは変えたときだけ送る（変えなければサーバーは今のまま。'' なら外す）
    if (f.channel !== (e ? e.channelId : '')) form.channelId = f.channel;
    setSaving(true); setMsg('snMsg', '保存しています…');
    sync.write<RpcResult>('saveSeriesNotify', form).then((res) => { setSaving(false); setDraft(null); toast(res.message); setMsg('snMsg', res.message); },
      (err: Error) => { setSaving(false); setMsg('snMsg', err.message); setBad((b) => ({ ...b, msg: true })); toast(err.message); });
  };
  const test = () => {
    if (!name) return;
    setTesting(true);
    void discordSend(sync, { kind: 'test', series: name }, (t) => setMsg('snMsg', t)).then(({ ok, r }) => {
      setTesting(false); toast(ok ? '「' + name + '」のチャンネルに届きました' : failToast(r)); void sync.refresh('quiet');
    });
  };
  const remove = () => {
    if (!name || !e) return;
    askConfirm({ title: '「' + name + '」の通知の設定を消しますか？', message: 'このシリーズの卓は、基本のチャンネルへ基本の時刻に送るようになります。', ok: '消す', danger: true },
      () => { setDraft(null); void call('snRemove', 'snMsg', 'saveSeriesNotify', { series: name, remove: true }); });
  };
  return (
    <div className="card" id="snCard">
      <p className="hint">シリーズごとに、送るチャンネルと開催前の知らせの日時を変えられます。決めなければ上の表のとおりです。</p>
      <div className="wrap" id="snListWrap" hidden={!list.length}>
        <table id="snList">
          {list.length > 0 && (
            <tbody>
              <tr><th>シリーズ</th><th>送り先</th><th>開催前の知らせ</th></tr>
              {list.map((x) => (
                <tr data-sn={x.series} tabIndex={0} key={x.series} onClick={() => pick(x.series)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(x.series); } }}>
                  <td>{x.series}</td><td>{where(x)}</td><td className="nw">{whenOf(x)}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <label className="f" htmlFor="snSeries">シリーズ</label>
      <select id="snSeries" value={name} disabled={!names.length} onChange={(ev) => pick(ev.target.value)}>
        <option value="">{names.length ? '（シリーズを選ぶ）' : '（シリーズの卓がまだありません）'}</option>
        {names.map((n) => <option value={n} key={n}>{n + (snEntry(d, n) ? '（設定あり）' : '')}</option>)}
      </select>
      <div id="snFields" hidden={!name}>
        {name && (
          <>
            <p className="hint" id="snNow">{'いま: ' + where(e, true) + '、開催前の知らせは' + whenOf(e)}</p>
            <label className="f" htmlFor="snChannel">このシリーズのチャンネル <small>選ぶと専用のチャンネルに送る</small></label>
            <ChannelSelect id="snChannel" value={f.channel} empty="専用にしない（基本のチャンネルへ）" onChange={(v) => edit({ channel: v })} />
            {/* 専用のチャンネルが無ければ、もともと基本のチャンネルへ送る */}
            <label className="c"><input type="checkbox" id="snAlsoBase" disabled={!f.channel} checked={f.alsoBase} onChange={(ev) => edit({ alsoBase: ev.target.checked })} /> 基本のチャンネルにも送る</label>
            <label className="c"><input type="checkbox" id="snSame" checked={f.same} onChange={(ev) => edit({ same: ev.target.checked })} /> <span id="snSameLbl">{'開催前の知らせは基本と同じ日時（' + whenText(baseDays(d), baseHour(d)) + '）'}</span></label>
            {/* 基本と同じなら、日時の欄は出さない */}
            <div className="when-row" id="snWhen" hidden={f.same}>開催日の <input type="text" className={'num' + (bad.d ? ' bad' : '')} id="snDays" inputMode="numeric" maxLength={2} aria-label="何日前（0〜30）" value={f.days} onChange={(ev) => edit({ days: ev.target.value })} /> 日前、<input type="text" className={'num' + (bad.h ? ' bad' : '')} id="snHour" inputMode="numeric" maxLength={2} aria-label="何時台（0〜23）" value={f.hour} onChange={(ev) => edit({ hour: ev.target.value })} /> 時台に送る</div>
            <div className="btns">
              <button type="button" className="btn primary" id="snSave" disabled={saving} onClick={save}>保存</button>
              <button type="button" className="btn" id="snTest" disabled={!(e && e.channelId) || testing} onClick={test}>接続テスト</button>
              <button type="button" className="btn danger" id="snRemove" disabled={!e || !!busy.snRemove} onClick={remove}>設定を消す</button>
              <span className={'hint' + (bad.msg ? ' bad' : '')} id="snMsg">{msg.snMsg || ''}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
