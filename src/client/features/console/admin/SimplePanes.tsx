// 管理画面の小さな区分: 管理者・この卓予定（名前・後始末・表示）・送信の記録・グループを消す
import { useState } from 'react';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { useCall } from './useCall';

/** 管理者の区分。名簿と、管理者を足す・外す */
export function AdminsPane() {
  const d = useData();
  const { busy, msg, call } = useCall();
  const list = d.admins || [];
  const others = d.members.filter((m) => list.indexOf(m.name) < 0).map((m) => m.name);
  const [pick, setPick] = useState('');
  const chosen = others.indexOf(pick) >= 0 ? pick : others[0] || '';
  return (
    <div className="set-pane" data-pane="admin">
      <div className="card">
        <h3>管理者 <small className="hint">卓を消す・メンバーと設定を変える・日程調整の開催日を決める</small></h3>
        <div id="admState" className={'adm-state' + (d.isAdmin ? ' on' : '')}>{d.isAdmin ? 'あなたは管理者です' : 'あなたは管理者ではありません'}</div>
        <p className="hint" id="admLead">{d.isAdmin ? '管理者は、卓を消す・メンバーと設定を変える・日程調整の開催日を決める、ができます。' : '管理者の操作が要るときは、管理者に頼んでください。'}</p>
        <div className="adm-list" id="admList">
          {!list.length && <span className="adm-none">名簿はまだ空です。</span>}
          {list.map((n) => (
            <span className="adm-chip" key={n}>
              {n}
              {d.isAdmin && list.length > 1 && (
                <button type="button" title="管理者から外す" aria-label={n + ' を管理者から外す'}
                  onClick={() => askConfirm({ title: '管理者から外しますか？', message: '「' + n + '」を管理者の名簿から外します。', ok: '外す', danger: true }, () => { void call('admAdd', 'admMsg', 'setAdmin', { name: n, admin: false }); })}>
                  <Icon name="close" size="xs" />
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="hint">グループの Discord サーバーで、オーナーか「サーバー管理」の権限がある人は、名簿に無くても管理者です。</p>
      </div>
      <div className="card" id="admAddCard" hidden={!d.isAdmin}>
        <h3>管理者を足す</h3>
        <div className="row">
          <div><label className="f" htmlFor="admPick">メンバー</label><select id="admPick" value={chosen} onChange={(ev) => setPick(ev.target.value)}>{others.map((n) => <option value={n} key={n}>{n}</option>)}</select></div>
        </div>
        <div className="btns">
          <button type="button" className="btn primary" id="admAdd" disabled={!others.length || !!busy.admAdd} onClick={() => { if (chosen) void call('admAdd', 'admMsg', 'setAdmin', { name: chosen, admin: true }); }}>管理者にする</button>
          <span className="hint" id="admMsg">{msg.admMsg || ''}</span>
        </div>
      </div>
    </div>
  );
}

/** この卓予定の区分。グループの名前・卓の後始末・予定の日数 */
export function TablePane() {
  const d = useData();
  const { busy, msg, setMsg, call } = useCall();
  /** 書きかけ（保存するまで、読み直しても上書きしない） */
  const [name, setName] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const nameV = name ?? d.title ?? '', daysV = days ?? String(d.settings.availDays || 60);
  const rename = () => {
    const n = nameV.trim();
    if (!n) { setMsg('stNameMsg', '名前を入れてください。'); return; }
    if (n === d.title) { setMsg('stNameMsg', 'いまの名前と同じです。'); return; }
    askConfirm({ title: '名前を変えますか？', message: '画面の左上と、Discord の知らせに出る名前が「' + n + '」になります。', ok: '変える' }, () => { void call('stNameSave', 'stNameMsg', 'renameGroup', { name: n }).then((r) => { if (r) setName(null); }); });
  };
  return (
    <div className="set-pane" data-pane="table">
      <div className="card">
        <h3>名前</h3>
        <p className="hint">画面の左上と、Discord の知らせに出る名前です。みんなに見えます。</p>
        <label className="f" htmlFor="stName">グループの名前 <small>80 文字まで</small></label>
        <input type="text" id="stName" maxLength={80} value={nameV} onChange={(ev) => setName(ev.target.value)} />
        <div className="btns"><button type="button" className="btn primary" id="stNameSave" disabled={!!busy.stNameSave} onClick={rename}>名前を変える</button><span className="hint" id="stNameMsg">{msg.stNameMsg || ''}</span></div>
      </div>
      <div className="card">
        <h3>卓の後始末</h3>
        <label className="c"><input type="checkbox" id="stAutoFinish" checked={!!d.settings.autoFinish} onChange={(ev) => { void call('stSave', 'stMsg', 'saveConsoleSettings', { autoFinish: ev.target.checked }); }} /> 開催日を過ぎた卓を「終了」にする</label>
        <p className="hint">終了になってもカレンダーからは消えず、灰色で残ります。「卓をまとめて変える」で見るには「終了・中止も表示」を付けてください。</p>
      </div>
      <div className="card">
        <h3>表示</h3>
        <div className="row">
          <div><label className="f" htmlFor="stAvailDays">メンバーの予定の日数 <small>7〜366</small></label><input type="text" id="stAvailDays" inputMode="numeric" value={daysV} onChange={(ev) => setDays(ev.target.value)} /></div>
        </div>
        <div className="btns"><button type="button" className="btn primary" id="stSave" disabled={!!busy.stSave} onClick={() => { void call('stSave', 'stMsg', 'saveConsoleSettings', { availDays: daysV.trim() }).then((r) => { if (r) setDays(null); }); }}>保存</button><span className="hint" id="stMsg">{msg.stMsg || ''}</span></div>
      </div>
    </div>
  );
}

/** 送信の記録。新しい順 10 件 */
export function LogPane() {
  const d = useData();
  const lg = d.log || [];
  return (
    <div className="set-pane" data-pane="log">
      <div className="card">
        <h3>送信の記録 <small className="hint">届かないときはここを見る。新しい順 10 件</small></h3>
        <div className="wrap">
          <table id="stLog">
            <tbody>
              <tr><th>日時</th><th>種別</th><th>対象</th><th>結果</th></tr>
              {lg.map((row, i) => (
                <tr className={/^(HTTP|ERROR|送らず|送信失敗)/.test(row.result) ? 'r-past' : undefined} key={i}>
                  <td className="nw">{row.at}</td><td className="nw">{row.kind}</td><td className="txt">{row.target}</td><td className="txt">{row.result}</td>
                </tr>
              ))}
              {!lg.length && <tr><td colSpan={4} className="hint">まだ送っていません。「接続テスト」を押すとここに記録が出ます。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** グループを消す。名前を打ってから、確かめる窓を通す。消したら控えを消して入口へ */
export function DangerPane() {
  const d = useData();
  const { sync } = useConsole();
  const [confirm, setConfirm] = useState('');
  const [st, setSt] = useState({ busy: false, msg: '' });
  const ok = confirm.trim() === d.title;
  const del = () => {
    if (!ok) return;
    askConfirm({ title: '「' + d.title + '」を消しますか？', message: '卓・メンバーの予定・メモ・日程調整の回答・送信の記録が、すべて消えます。元に戻せません。', ok: '消す', danger: true }, () => {
      setSt({ busy: true, msg: '消しています…' });
      // 消したあとは読めないので、読み直さない（quiet）
      sync.write('deleteGroup', { confirm: confirm.trim() }, { quiet: true }).then(() => { sync.forget(); location.href = '/?deleted=1'; },
        (e: Error) => { setSt({ busy: false, msg: e.message }); toast(e.message); });
    });
  };
  return (
    <div className="set-pane" data-pane="danger">
      <div className="card danger-card">
        <h3><Icon name="delete" size="sm" />グループを消す</h3>
        <p>このグループの卓・メンバーの予定・メモ・日程調整の回答・送信の記録が、すべて消えます。<b>元に戻せません。</b></p>
        <label className="f" htmlFor="delConfirm">確かめのために、グループの名前「<span id="delTitle">{d.title}</span>」を入れてください</label>
        <input type="text" id="delConfirm" autoComplete="off" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
        <div className="btns"><button type="button" className="btn danger-fill" id="delGroup" disabled={!ok || st.busy} onClick={del}>グループを消す</button><span className="hint" id="delMsg">{st.msg}</span></div>
      </div>
    </div>
  );
}
