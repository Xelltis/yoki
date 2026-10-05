// 管理画面の「知らせ」。何を・どこへ・いつ送るかの表（つまみと日時）、チャンネル（Bot・基本・種類ごと）、シリーズごとの上書き
import { useEffect, useRef, useState } from 'react';
import { askConfirm } from '../../../ui/confirm';
import { field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { addDaysYmd, fmtJa } from '../model/dates';
import { baseDays, baseHour, kindSet, readWhen, whenText } from '../model/notify';
import { ChannelSelect, botStateText, canPick, ensureChannels, loadChannels, useChannels } from './channels';
import { foldBody, foldCard, foldInner, foldSummary } from './fold';
import { SeriesNotify } from './SeriesNotify';
import { useCall } from './useCall';

/** 種類ごとのチャンネル（開催前の知らせ・募集） */
const KW = { remind: { id: 'kwRemind', label: '開催前の知らせのチャンネル' }, recruit: { id: 'kwRecruit', label: '募集のチャンネル' } } as const;
type Kind = keyof typeof KW;

/** 開始の何分前か。5〜720 の整数だけ通す */
function soonMin(v: string): { n: number; err: string } {
  const s = v.trim(), n = Number(s);
  return !/^\d+$/.test(s) || n < 5 || n > 720 ? { n, err: '開始の何分前は 5〜720 の数で入れてください。' } : { n, err: '' };
}

/** ON/OFF のつまみ。checkbox ではなく button[role=switch] で持つ。入れると水色になり、丸が右へ動く */
function Switch({ id, on, label, busy, onClick }: { id: string; on: boolean; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={onClick}
      className={'relative h-26 w-44 cursor-pointer rounded-full border p-0 transition-[background-color,border-color] duration-(--dur-fast) ease-out disabled:cursor-default disabled:opacity-50 '
        + 'after:absolute after:top-2 after:left-2 after:h-20 after:w-20 after:rounded-[50%] after:shadow-card after:transition-[transform] after:duration-(--dur-fast) after:ease-out after:content-[""] '
        + (on ? 'border-accent bg-accent after:bg-white after:[transform:translateX(18px)]' : 'border-line-strong bg-head after:bg-white')} />
  );
}

/** 知らせの表の見出し */
const nth = 'border-b border-line px-12 py-11 text-left align-middle text-[11.5px] font-bold text-muted ';
/** 知らせの表のマス。狭い画面では表をやめて、行ごとに縦に並べる（つまみは右上） */
const ntd = (last: boolean) => 'px-12 py-11 align-middle text-13 max-tab:block max-tab:border-0 max-tab:px-0 max-tab:py-3 ' + (last ? '' : 'border-b border-line ');
const ntdText = 'text-left max-tab:w-full ';
const ntdSw = 'w-78 text-right whitespace-nowrap max-tab:absolute max-tab:top-10 max-tab:right-0 max-tab:w-auto';
const ntr = 'max-tab:relative max-tab:block max-tab:w-full max-tab:py-10 ';
/** 知らせの名前と説明 */
const what = (last: boolean) => ntd(last) + ntdText + 'max-tab:pr-62';
const whatTitle = 'block text-[13.5px]';
const whatHint = 'hint text-[11.5px]';
/** 送り先といつ（字を折り返さない） */
const plain = (last: boolean) => ntd(last) + ntdText + 'whitespace-nowrap text-muted';
/** 何日前・何時台・何分前の欄 */
const num = (bad: boolean) => 'w-[3.4em] max-w-640 text-center tabular-nums' + (bad ? ' border-err-text' : '');
/** 送り先の札。種類ごとのチャンネルを決めていれば水色 */
const chip = (set: boolean) => 'inline-flex h-24 items-center gap-5 rounded-full border px-9 text-12 font-semibold ' + (set ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-line bg-out text-muted');

export function NotifyPane() {
  const d = useData();
  const { busy, msg, setMsg, call } = useCall();
  const st = d.settings;
  /** 書きかけの数値（保存するまで、読み直しても上書きしない） */
  const [days, setDays] = useState<string | null>(null);
  const [hour, setHour] = useState<string | null>(null);
  const [soon, setSoon] = useState<string | null>(null);
  const daysRef = useRef<HTMLInputElement>(null), soonRef = useRef<HTMLInputElement>(null);
  const daysV = days ?? String(baseDays(d)), hourV = hour ?? String(baseHour(d));
  const soonNow = st.soonMinutes === undefined ? 30 : st.soonMinutes, soonV = soon ?? String(soonNow);
  const wn = readWhen(daysV, hourV);
  const save = (btn: string, form: object, after?: () => void) => {
    void call(btn, 'ntMsg', 'saveConsoleSettings', form).then((r) => { if (r && after) after(); });
  };
  const bad = (t: string) => { setMsg('ntMsg', t); };
  /** 基本の日時の例え。「9/26（土）の卓なら、9/25（金）の 20 時台に届きます」 */
  const ex = addDaysYmd(d.today, 7);
  const line = wn.err ? wn.err : '例: ' + fmtJa(ex) + 'の卓なら、' + fmtJa(addDaysYmd(ex, -wn.days)) + 'の ' + wn.hour + ' 時台に届きます。' + (st.setter ? '' : '（いまは送っていません。右のつまみで始められます）');
  const toggleRemind = () => {
    if (wn.err) { daysRef.current!.focus(); return; }
    if (st.setter) {
      askConfirm({ title: '開催前の知らせを止めますか？', message: '自動で送るのをやめます。あとからいつでも戻せます。', ok: '止める', danger: true }, () => save('ntRemind', { remind: false }));
      return;
    }
    askConfirm({ title: '開催前の知らせを送りますか？', message: '開催日の' + whenText(wn.days, wn.hour) + 'に、卓の知らせを Discord に送ります。シリーズごとに日時を決めた卓は、その日時に送ります。', ok: '送る' },
      () => save('ntRemind', { remind: true, days: String(wn.days), hour: String(wn.hour) }, () => { setDays(null); setHour(null); }));
  };
  /* 日時は欄を離れたときに保存する。まだ送っていないなら、つまみを入れたときに一緒に送る */
  const blurWhen = () => {
    if (!st.setter || wn.err || (wn.days === baseDays(d) && wn.hour === baseHour(d))) return;
    save('ntRemind', { days: String(wn.days), hour: String(wn.hour) }, () => { setDays(null); setHour(null); });
  };
  const toggleSoon = () => {
    const m = soonMin(soonV);
    if (m.err) { bad(m.err); soonRef.current!.focus(); return; }
    save('stSoon', { soon: !st.soon, soonMinutes: String(m.n) }, () => setSoon(null));
  };
  /* 分を変えたら、ON のときだけその場で保存する（OFF なら ON にしたときに一緒に送る） */
  const blurSoon = () => {
    if (!st.soon || soon === null || soon.trim() === String(soonNow)) return;
    const m = soonMin(soonV);
    if (m.err) { bad(m.err); return; }
    save('stSoon', { soonMinutes: String(m.n) }, () => setSoon(null));
  };
  // 送り先の札。種類ごとのチャンネルを決めていれば、そちらを出す
  const destR = d.remindChannelSet ? '開催前のチャンネル' : '基本のチャンネル', destC = d.recruitChannelSet ? '募集のチャンネル' : '基本のチャンネル';
  const sl = d.seriesNotify || [];
  return (
    <div data-pane="notify">
      <div className="card">
        <h3>知らせ <small className="hint">何を・どこへ・いつ送るか</small></h3>
        <div className="wrap">
          <table className="max-tab:block max-tab:w-full">
            <thead className="max-tab:hidden">
              <tr>
                <th className={nth + 'w-[38%] rounded-tl-md'}>知らせ</th><th className={nth}>送り先</th><th className={nth}>いつ</th><th className={nth + 'rounded-tr-md'}>送る</th>
              </tr>
            </thead>
            <tbody className="max-tab:block max-tab:w-full">
              <tr className={ntr + 'max-tab:border-b max-tab:border-line'}>
                <td className={what(false)}><b className={whatTitle}>開催前の知らせ</b><span className={whatHint}>開催日が近づいた卓を、GM と参加者に</span></td>
                <td className={plain(false)}><span className={chip(!!d.remindChannelSet)} id="ntDestRemind">{destR}</span></td>
                <td className={plain(false)}>開催日の <input type="text" className={num(!wn.dOk)} id="stDays" ref={daysRef} inputMode="numeric" maxLength={2} aria-label="何日前（0〜30）" value={daysV} onChange={(ev) => setDays(ev.target.value)} onBlur={blurWhen} /> 日前 <input type="text" className={num(!wn.hOk)} id="stHour" inputMode="numeric" maxLength={2} aria-label="何時台（0〜23）" value={hourV} onChange={(ev) => setHour(ev.target.value)} onBlur={blurWhen} /> 時台</td>
                <td className={ntd(false) + ntdSw}><Switch id="ntRemind" on={!!st.setter} label="開催前の知らせを送る" busy={!!busy.ntRemind} onClick={toggleRemind} /></td>
              </tr>
              <tr className={ntr + 'max-tab:border-b max-tab:border-line'}>
                <td className={what(false)}><b className={whatTitle}>期間前の催促</b><span className={whatHint}>募集中・調整中のまま、期間の前日になったら GM に</span></td>
                <td className={plain(false)}><span className={chip(!!d.recruitChannelSet)} id="ntDestUrge">{destC}</span></td>
                <td className={plain(false)}>期間の前日（開催前の知らせと同じ時刻）</td>
                <td className={ntd(false) + ntdSw}><Switch id="stUrge" on={!!st.urge} label="期間前の催促を送る" busy={!!busy.stUrge} onClick={() => save('stUrge', { urge: !st.urge })} /></td>
              </tr>
              <tr className={ntr + 'max-tab:border-b max-tab:border-line'}>
                <td className={what(false)}><b className={whatTitle}>開始直前の知らせ</b><span className={whatHint}>当日、開始の少し前に GM と参加者に</span></td>
                <td className={plain(false)}><span className={chip(!!d.remindChannelSet)} id="ntDestSoon">{destR}</span></td>
                <td className={plain(false)}>開始の <input type="text" className={num(false)} id="stSoonMin" ref={soonRef} inputMode="numeric" maxLength={3} aria-label="開始の何分前（5〜720）" value={soonV} onChange={(ev) => setSoon(ev.target.value)} onBlur={blurSoon} /> 分前</td>
                <td className={ntd(false) + ntdSw}><Switch id="stSoon" on={!!st.soon} label="開始直前の知らせを送る" busy={!!busy.stSoon} onClick={toggleSoon} /></td>
              </tr>
              <tr className={ntr + 'max-tab:border-b max-tab:border-line'}>
                <td className={what(false)}><b className={whatTitle}>登録・変更・削除</b><span className={whatHint}>保存のときに「Discord に知らせる」を付けたぶん</span></td>
                <td className={plain(false)}><span className={chip(false)}>卓に合わせて自動</span></td>
                <td className={plain(false)}>保存したとき</td>
                <td className={ntd(false) + ntdSw}><Switch id="stNotifyOnSave" on={!!st.notifyOnSave} label="登録・変更・削除を知らせる" busy={!!busy.stNotifyOnSave} onClick={() => save('stNotifyOnSave', { notifyOnSave: !st.notifyOnSave })} /></td>
              </tr>
              <tr className={ntr}>
                <td className={what(true)}><b className={whatTitle}>募集と参加確認</b><span className={whatHint}>募集の卓の案内と、興味ありの人への確認</span></td>
                <td className={plain(true)}><span className={chip(!!d.recruitChannelSet)} id="ntDestRecruit">{destC}</span></td>
                <td className={plain(true)}>押したときだけ</td>
                <td className={ntd(true) + ntdSw}><span className="text-[11.5px] text-muted">自動では送らない</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={'hint mt-6 mb-0' + (wn.err ? ' text-err-text' : '')} id="stWhenSay">{line}</p>
        <p className="hint" id="ntMsg">{msg.ntMsg || ''}</p>
        <p className="hint">開催前の知らせは、0 日前なら当日、1 日前なら前日です。開始直前の知らせを ON にすると見回りが 5 分ごとになり、指定した時刻を過ぎた最初の見回りで届きます。送り先は下の「チャンネル」で決めます。</p>
      </div>

      <details className={foldCard} id="chFold">
        <summary className={foldSummary}><Icon name="notifications" size="sm" />チャンネル<span className="hint font-normal" id="chSum">{d.channelSet ? '基本' + (d.remindChannelSet ? '・開催前' : '') + (d.recruitChannelSet ? '・募集' : '') : 'まだ決めていません'}</span></summary>
        <div className={foldBody}>
          <BotCard />
          <BaseChannel />
          <div className={foldInner(false)} id="kwCard">
            <h3>種類ごとのチャンネル</h3>
            <p className="hint">開催前の知らせと募集の知らせを、別のチャンネルに送れます。「基本のチャンネルと同じ」なら基本へ。シリーズ専用のチャンネルがあれば、そちらが先です。</p>
            <KindChannel kind="remind" label="開催前の知らせ" note="期間前の催促と、開始直前の知らせもここへ" first />
            <KindChannel kind="recruit" label="募集" note="募集の卓の登録・変更・削除・案内と、興味ありの人への参加確認" />
          </div>
        </div>
      </details>

      <details className={foldCard} id="snFold">
        <summary className={foldSummary}><Icon name="date_range" size="sm" />シリーズごとの上書き<span className="hint font-normal" id="snSum">{sl.length ? sl.length + ' 件' : 'なし'}</span></summary>
        <div className={foldBody}>
          <SeriesNotify />
        </div>
      </details>
    </div>
  );
}

/** 卓予定の Bot。サーバーにいるかと、招く・読み直す */
function BotCard() {
  const d = useData();
  const { sync } = useConsole();
  const ch = useChannels();
  // 区分を開いたら、Bot とチャンネルの一覧を読む（まだなら）
  useEffect(() => { ensureChannels(sync); }, [sync, d.bot.ready]);
  const state = botStateText(d, ch);
  return (
    <div className={foldInner(true)} id="botCard">
      <h3>卓予定の Bot</h3>
      <p className="hint">知らせは、卓予定の Bot がチャンネルに書き込みます。はじめに、このグループの Discord サーバーに Bot を招きます（サーバーの管理の権限が要ります）。</p>
      <p className={'hint' + (state.bad ? ' text-err-text' : '')} id="botState">{state.text}</p>
      <div className="btns">
        <a className="btn primary" id="botInvite" href={d.bot.inviteUrl || '#'} target="_blank" rel="noopener" hidden={!d.bot.inviteUrl}><Icon name="add" size="sm" />Bot をサーバーに招く</a>
        <button type="button" className="btn" id="botReload" disabled={ch.loading || !d.bot.ready} onClick={() => loadChannels(sync)}><Icon name="refresh" size="sm" />読み直す</button>
      </div>
      <p className="hint">Bot には「チャンネルを見る」「メッセージを送信」「埋め込みリンク」の権限が付きます。限られた人だけが見られるチャンネルに送るときは、そのチャンネルの権限で Bot を許可してください。</p>
    </div>
  );
}

/** 接続テスト。送り先に試しに送り、結果を欄と吹き出しに出す。送信の記録が増えるので読み直す */
function useTest(msgKey: string, setMsg: (key: string, t: string) => void) {
  const { sync } = useConsole();
  const [testing, setTesting] = useState(false);
  const test = (form: Record<string, unknown>, okText: string) => {
    setTesting(true);
    void discordSend(sync, form, (t) => setMsg(msgKey, t)).then(({ ok, r }) => {
      setTesting(false); toast(ok ? okText : failToast(r)); void sync.refresh('quiet');
    });
  };
  return { testing, test };
}

/** 基本のチャンネル。外すと、決めていない知らせは送られなくなるので確かめる */
function BaseChannel() {
  const d = useData();
  const { busy, msg, setMsg, call } = useCall();
  const { testing, test } = useTest('stChannelMsg', setMsg);
  const ch = useChannels();
  /** 選びかけ（読み直しても消さない。保存のときに外す） */
  const [pick, setPick] = useState<string | null>(null);
  const cur = d.settings.channelId, v = pick ?? cur;
  const saveIt = () => {
    if (v === cur) { setMsg('stChannelMsg', 'いまと同じです。'); return; }
    const go = () => { void call('stChannelSave', 'stChannelMsg', 'saveConsoleSettings', { channelId: v }).then((r) => { if (r) setPick(null); }); };
    if (v) go();
    else askConfirm({ title: '基本のチャンネルを外しますか？', message: '種類ごとやシリーズ専用のチャンネルを決めていない知らせは、Discord に送られなくなります。', ok: '外す', danger: true }, go);
  };
  return (
    <div className={foldInner(false)}>
      <h3>基本のチャンネル</h3>
      <p className="hint">種類ごとのチャンネルやシリーズ専用のチャンネルを決めていない知らせは、ここへ送ります。</p>
      <label className={fieldLabel} htmlFor="stChannel">チャンネル</label>
      <ChannelSelect className={field} id="stChannel" value={v} empty="（選んでいません）" onChange={setPick} />
      <div className="btns">
        {/* 選び直すまでは押せない */}
        <button type="button" className="btn primary" id="stChannelSave" disabled={!canPick(ch) || !!busy.stChannelSave || v === cur} onClick={saveIt}>保存</button>
        <button type="button" className="btn" id="stTest" disabled={!d.channelSet || testing} onClick={() => test({ kind: 'test' }, 'Discord に届きました')}>接続テスト</button>
        <span className="hint" id="stChannelMsg">{msg.stChannelMsg || ''}</span>
      </div>
    </div>
  );
}

/** 種類ごとのチャンネル 1 つ（開催前の知らせ・募集） */
function KindChannel({ kind, label, note, first }: { kind: Kind; label: string; note: string; first?: boolean }) {
  const d = useData();
  const { busy, msg, setMsg, call } = useCall();
  const id = KW[kind].id;
  const { testing, test } = useTest(id + 'Msg', setMsg);
  const ch = useChannels();
  const [pick, setPick] = useState<string | null>(null);
  const cur = kind === 'remind' ? d.settings.remindChannelId : d.settings.recruitChannelId, v = pick ?? cur;
  const saveIt = () => {
    if (v === cur) { setMsg(id + 'Msg', 'いまと同じです。'); return; }
    void call(id + 'Save', id + 'Msg', 'saveConsoleSettings', { kindChannel: { kind, channelId: v } }).then((r) => { if (r) setPick(null); });
  };
  return (
    <div className={first ? '' : 'mt-18 border-t border-line pt-6'}>
      <label className={fieldLabel} htmlFor={id}>{label + ' '}<small className={fieldNote}>{note}</small></label>
      <ChannelSelect className={field} id={id} value={v} empty="基本のチャンネルと同じ" onChange={setPick} />
      <div className="btns">
        <button type="button" className="btn primary" id={id + 'Save'} disabled={!canPick(ch) || !!busy[id + 'Save'] || v === cur} onClick={saveIt}>保存</button>
        <button type="button" className="btn" id={id + 'Test'} disabled={!kindSet(d, kind) || testing} onClick={() => test({ kind: 'test', channel: kind }, KW[kind].label + 'に届きました')}>接続テスト</button>
        <span className="hint" id={id + 'Msg'}>{msg[id + 'Msg'] || ''}</span>
      </div>
    </div>
  );
}
