// 管理画面の小さな区分: 管理者・このグループ（名前・後始末・書き出し・予定の時間帯・表示）・送信の記録・グループを消す
import { useState } from 'react';
import type { GroupExport } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { checkRow, field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { saveFile, sessionsCsv } from './exportFile';
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
    <div data-pane="admin">
      <div className="card">
        {/* この区分を開けるのは管理者だけなので、「あなたは管理者です」は出さない */}
        <h3>管理者</h3>
        <p className="hint" id="admLead">管理者は、卓を消す・メンバーと設定を変える・日程調整の開催日を決める、ができます。</p>
        <div className="mt-10 mb-4 flex flex-wrap gap-8" id="admList">
          {!list.length && <span className="text-13 text-muted">名簿はまだ空です。</span>}
          {list.map((n) => (
            <span className="inline-flex h-30 items-center gap-6 rounded-full border border-accent-line bg-accent-soft py-0 pr-6 pl-12 text-13 font-semibold text-accent-text" key={n}>
              {n}
              {d.isAdmin && list.length > 1 && (
                <button type="button" className="grid cursor-pointer place-items-center rounded-[50%] border-0 bg-transparent p-2 text-inherit opacity-70 hover:bg-accent-line hover:opacity-100" title="管理者から外す" aria-label={n + 'を管理者から外す'}
                  onClick={() => askConfirm({ title: '管理者から外しますか？', message: '「' + n + '」を管理者の名簿から外します。', ok: '外す', danger: true }, () => { void call('admAdd', 'admMsg', 'setAdmin', { name: n, admin: false }); })}>
                  <Icon name="close" size="xs" />
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="hint">{'グループのDiscordサーバーで、オーナーか「サーバー管理」の権限がある人は、名簿に無くても管理者です。' + (d.settings.adminRole.id ? 'ロール「' + d.settings.adminRole.name + '」の人も管理者です。' : '')}</p>
      </div>
      <RoleCard />
      <div className="card" id="admAddCard" hidden={!d.isAdmin}>
        <h3>管理者を足す</h3>
        <div className="row">
          <div><label className={fieldLabel} htmlFor="admPick">メンバー</label><select className={field} id="admPick" value={chosen} onChange={(ev) => setPick(ev.target.value)}>{others.map((n) => <option value={n} key={n}>{n}</option>)}</select></div>
        </div>
        <div className="btns">
          <button type="button" className="btn primary" id="admAdd" disabled={!others.length || !!busy.admAdd} onClick={() => { if (chosen) void call('admAdd', 'admMsg', 'setAdmin', { name: chosen, admin: true }); }}>管理者にする</button>
          <span className="hint" id="admMsg">{msg.admMsg || ''}</span>
        </div>
      </div>
    </div>
  );
}

/** このグループの区分。グループの名前・卓の後始末・予定の日数。名前と日数は、変えるまで保存を押せない */
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
    askConfirm({ title: '名前を変えますか？', message: '画面の左上と、Discordの知らせに出る名前が「' + n + '」になります。', ok: '変える' }, () => { void call('stNameSave', 'stNameMsg', 'renameGroup', { name: n }).then((r) => { if (r) setName(null); }); });
  };
  return (
    <div data-pane="table">
      <div className="card">
        <h3>名前</h3>
        <p className="hint">画面の左上と、Discordの知らせに出る名前です。みんなに見えます。</p>
        <label className={fieldLabel} htmlFor="stName">グループの名前 <small className={fieldNote}>80文字まで</small></label>
        <input type="text" className={field} id="stName" maxLength={80} value={nameV} onChange={(ev) => setName(ev.target.value)} />
        <div className="btns"><button type="button" className="btn primary" id="stNameSave" disabled={!!busy.stNameSave || nameV.trim() === d.title} onClick={rename}>名前を変える</button><span className="hint" id="stNameMsg">{msg.stNameMsg || ''}</span></div>
      </div>
      <div className="card">
        <h3>卓の後始末</h3>
        <label className={checkRow}><input type="checkbox" id="stAutoFinish" checked={!!d.settings.autoFinish} onChange={(ev) => { void call('stSave', 'stMsg', 'saveConsoleSettings', { autoFinish: ev.target.checked }); }} /> 開催日を過ぎた卓を「終了」にする</label>
        <p className="hint">終了になってもカレンダーからは消えず、灰色で残ります。「卓をまとめて変える」で見るには「終了・中止も表示」を付けてください。</p>
      </div>
      <ExportCard />
      <div className="card">
        <h3>予定の時間帯</h3>
        <label className={checkRow}><input type="checkbox" id="stDayParts" checked={!!d.settings.dayParts} onChange={(ev) => { void call('stSave', 'stMsg', 'saveConsoleSettings', { dayParts: ev.target.checked }); }} /> メンバーの予定を、昼と夜に分けて入れる</label>
        <p className="hint">昼の卓と夜の卓があるグループ向けです。予定表の印が昼と夜に分かれ、全員空きも時間帯ごとに出ます。卓は開始時刻で、17時より前なら昼、17時からは夜に入ります（時刻の無い卓は両方）。日程調整の「予定表から入れる」は、卓の開始時刻の時間帯の印を使います。</p>
      </div>
      <div className="card">
        <h3>表示</h3>
        <div className="row">
          <div><label className={fieldLabel} htmlFor="stAvailDays">メンバーの予定の日数 <small className={fieldNote}>7〜366</small></label><input type="text" className="w-[8em] max-w-640" id="stAvailDays" inputMode="numeric" value={daysV} onChange={(ev) => setDays(ev.target.value)} /></div>
        </div>
        <div className="btns"><button type="button" className="btn primary" id="stSave" disabled={!!busy.stSave || daysV.trim() === String(d.settings.availDays || 60)} onClick={() => { void call('stSave', 'stMsg', 'saveConsoleSettings', { availDays: daysV.trim() }).then((r) => { if (r) setDays(null); }); }}>保存</button><span className="hint" id="stMsg">{msg.stMsg || ''}</span></div>
      </div>
    </div>
  );
}

/** Discordのロールで管理者を決める。ロールの一覧はBotで読み、選んだロールの名前もサーバーがBotで読み直して控える */
function RoleCard() {
  const d = useData();
  const { sync } = useConsole();
  const { busy, msg, call } = useCall();
  const [roles, setRoles] = useState<{ id: string; name: string }[] | null>(null);
  const [state, setState] = useState('');
  const [pick, setPick] = useState('');
  const cur = d.settings.adminRole, chosen = pick || (roles && roles[0] ? roles[0].id : '');
  const load = () => {
    setState('読んでいます…');
    sync.call<{ botReady: boolean; inGuild: boolean; roles: { id: string; name: string }[] }>('getDiscordRoles').then((r) => {
      if (!r.botReady) setState('YokiのBotのトークンが無いので、ロールを読めません（運営者に伝えてください）。');
      else if (!r.inGuild) setState('Botがサーバーにいないので、ロールを読めません。「知らせ」の区分からBotを招いてください。');
      else { setRoles(r.roles); setState(r.roles.length ? '' : 'サーバーに、選べるロールがありません。'); }
    }, (e: Error) => setState(e.message));
  };
  return (
    <div className="card" id="admRoleCard" hidden={!d.isAdmin}>
      <h3>Discordのロールで決める</h3>
      <p className="hint">選んだロールのある人は、名簿に無くても管理者になります。大きなサーバーで、運営のロールの人をそのまま管理者にするときに使ってください。ロールはYokiのBotで読むので、Discordでロールを付け外ししてから管理者に反映されるまで、長いと1日かかります。</p>
      <p className="mt-0 text-13" id="admRoleNow">{cur.id ? '今のロール: ' + cur.name : 'ロールでは決めていません。'}</p>
      {roles && roles.length > 0 && (
        <div className="row">
          <div><label className={fieldLabel} htmlFor="admRole">ロール</label><select className={field} id="admRole" value={chosen} onChange={(ev) => setPick(ev.target.value)}>{roles.map((r) => <option value={r.id} key={r.id}>{r.name}</option>)}</select></div>
        </div>
      )}
      <div className="btns">
        {!roles && <button type="button" className="btn" id="admRoleLoad" onClick={load}>ロールを読む</button>}
        {roles && roles.length > 0 && <button type="button" className="btn primary" id="admRoleSave" disabled={!!busy.admRole} onClick={() => { void call('admRole', 'admRoleMsg', 'saveConsoleSettings', { adminRole: chosen }); }}>このロールにする</button>}
        {cur.id && <button type="button" className="btn" id="admRoleClear" disabled={!!busy.admRole} onClick={() => { void call('admRole', 'admRoleMsg', 'saveConsoleSettings', { adminRole: '' }); }}>ロールで決めない</button>}
        <span className="hint" id="admRoleMsg">{state || msg.admRoleMsg || ''}</span>
      </div>
    </div>
  );
}

/**
 * グループの書き出し。卓・メンバー・予定・メモ・日程調整・シナリオ・記録・履歴を、手元に控える（JSON。卓の一覧はCSVも）。
 * 秘匿HOは入らない（管理者も読めないもの）
 */
function ExportCard() {
  const d = useData();
  const { sync, groupId } = useConsole();
  const [st, setSt] = useState({ busy: false, msg: '' });
  const run = (kind: 'json' | 'csv') => {
    setSt({ busy: true, msg: '書き出しています…' });
    sync.call<{ message: string; export: GroupExport }>('exportGroup').then((r) => {
      const base = 'yoki-' + groupId + '-' + d.today;
      if (kind === 'json') saveFile(base + '.json', JSON.stringify(r.export, null, 2), 'application/json');
      else saveFile(base + '-sessions.csv', sessionsCsv(r.export), 'text/csv');
      setSt({ busy: false, msg: r.message });
    }, (e: Error) => setSt({ busy: false, msg: e.message }));
  };
  return (
    <div className="card" id="exportCard">
      <h3><Icon name="download" size="sm" />書き出し</h3>
      <p className="hint">グループの中身（卓・メンバー・予定とメモ・日程調整・シナリオ・記録・変更の履歴）を、ファイルにして手元に控えます。運営者はグループの中身を見ないので、控えを取れるのは管理者だけです。秘匿HOは入りません。</p>
      <div className="btns">
        <button type="button" className="btn" id="exportJson" disabled={st.busy} onClick={() => run('json')}>すべてをJSONで</button>
        <button type="button" className="btn" id="exportCsv" disabled={st.busy} onClick={() => run('csv')}>卓の一覧をCSVで</button>
        <span className="hint" id="exportMsg">{st.msg}</span>
      </div>
    </div>
  );
}

/** 送信の記録。新しい順10件 */
export function LogPane() {
  const d = useData();
  const lg = d.log || [];
  return (
    <div data-pane="log">
      <div className="card">
        <h3>送信の記録 <small className="hint">届かないときはここを見る。新しい順10件</small></h3>
        <div className="wrap">
          <table id="stLog">
            <tbody>
              <tr><th>日時</th><th>種別</th><th>対象</th><th>結果</th></tr>
              {lg.map((row, i) => (
                <tr className={/^(HTTP|ERROR|送らず|送信失敗)/.test(row.result) ? 'r-past' : undefined} key={i}>
                  <td className="nw">{row.at}</td><td className="nw">{row.kind}</td><td className="min-w-[11em]">{row.target}</td><td className="min-w-[11em]">{row.result}</td>
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
    <div data-pane="danger">
      <div className="card border-[color-mix(in_srgb,var(--err-text)_40%,var(--line))]">
        <h3><Icon name="delete" size="sm" className="text-err-text" />グループを消す</h3>
        <p>このグループの卓・メンバーの予定・メモ・日程調整の回答・送信の記録が、すべて消えます。<b>元に戻せません。</b></p>
        <label className={fieldLabel} htmlFor="delConfirm">確かめのために、グループの名前「<span id="delTitle">{d.title}</span>」を入れてください</label>
        <input type="text" className={field} id="delConfirm" autoComplete="off" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
        <div className="btns"><button type="button" className="btn danger-fill" id="delGroup" disabled={!ok || st.busy} onClick={del}>グループを消す</button><span className="hint" id="delMsg">{st.msg}</span></div>
      </div>
    </div>
  );
}
