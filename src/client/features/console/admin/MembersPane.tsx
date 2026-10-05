// 管理画面の「メンバー」。一覧（行を押すとフォームに入る）と、足す・名前を変える・外す
import { useEffect, useRef, useState } from 'react';
import type { ConsoleMember, RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { field } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { active, isActive, peopleOf } from '../model/model';

type Fields = { name: string; discordId: string; note: string };
const fieldsOf = (m: ConsoleMember | null): Fields => ({ name: m ? m.name : '', discordId: m ? m.discordId : '', note: m ? m.note : '' });

export function MembersPane() {
  const d = useData();
  const { sync } = useConsole();
  const [sel, setSel] = useState('');
  /** 書きかけ（保存するまで、読み直しても上書きしない） */
  const [draft, setDraft] = useState<Fields | null>(null);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const m = d.members.filter((x) => x.name === sel)[0] || null;
  const f = draft || fieldsOf(m);
  const act = active(d);
  const pick = (name: string) => { setSel(name); setDraft(null); setMsg(null); };
  // 行を押すと、上のフォームに入る（行はボタンではないので、表で受ける）
  useEffect(() => {
    const t = tableRef.current!;
    const click = (ev: MouseEvent) => {
      const tr = ev.target instanceof Element ? ev.target.closest<HTMLElement>('tr[data-name]') : null;
      if (tr) { pick(tr.dataset.name!); window.scrollTo(0, 0); }
    };
    t.addEventListener('click', click);
    return () => t.removeEventListener('click', click);
  }, []);
  const after = (res: RpcResult, keep: string) => {
    setBusy(false); setDraft(null); setSel(keep);
    const d2 = sync.data()!;
    toast(res.message + (d2.members.length && !d2.sessions.some(isActive) ? '　次は「カレンダー」タブで卓を登録します。' : ''));
    setMsg({ text: res.message, err: false });
  };
  const save = () => {
    const form = { oldName: sel, name: f.name.trim(), discordId: f.discordId.trim(), note: f.note.trim() };
    if (!form.name) { setMsg({ text: '名前を入れてください。', err: true }); return; }
    setBusy(true); setMsg({ text: '保存しています…', err: false });
    sync.write<RpcResult>('saveMember', form).then((res) => after(res, res.name || ''), (e: Error) => { setBusy(false); setMsg({ text: e.message, err: true }); });
  };
  const remove = () => {
    const name = sel; if (!name) return;
    const inUse = act.filter((s) => peopleOf(s).indexOf(name) >= 0).length;
    askConfirm({ title: 'メンバーから外しますか？', message: '「' + name + '」をメンバーから外します。' + (inUse ? '\n参加中の卓 ' + inUse + ' 件には名前が残ります（「メンバーの予定」タブに注意が出ます）。' : ''), ok: '外す', danger: true }, () => {
      setBusy(true); setMsg({ text: '保存しています…', err: false });
      sync.write<RpcResult>('deleteMember', { name }).then((res) => after(res, ''), (e: Error) => { setBusy(false); setMsg({ text: e.message, err: true }); });
    });
  };
  const edit = (patch: Partial<Fields>) => setDraft({ ...f, ...patch });
  return (
    <div data-pane="members">
      <p className="hint">ここに入れた名前が、卓の参加者の候補と「メンバーの予定」の列になります。Discord でログインして開いた人は、自動でメンバーになります。</p>
      <form id="mf" className="card" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <label htmlFor="mpick">編集するメンバー <small>新しく足すなら「（新規追加）」のまま</small></label>
        <select className={field} id="mpick" value={m ? m.name : ''} onChange={(ev) => pick(ev.target.value)}>
          <option value="">（新規追加）</option>
          {d.members.map((x) => <option value={x.name} key={x.name}>{x.name}</option>)}
        </select>
        <div className="row">
          <div><label htmlFor="mname">名前 <small>必須。卓の参加者名と同じ表記に</small></label><input type="text" className={field} id="mname" required value={f.name} onChange={(ev) => edit({ name: ev.target.value })} /></div>
          <div>
            <label htmlFor="mdiscord">Discord ユーザーID <small>任意。数字だけ</small></label>
            {/* ログインした人の Discord ID は、ログインから自動で入る */}
            <input type="text" className={field} id="mdiscord" inputMode="numeric" placeholder="123456789012345678" readOnly={!!(m && m.linked)} title={m && m.linked ? 'ログインした人の Discord ID は、自動で入ります' : ''} value={f.discordId} onChange={(ev) => edit({ discordId: ev.target.value })} />
          </div>
        </div>
        <label htmlFor="mnote">備考</label><input type="text" className={field} id="mnote" value={f.note} onChange={(ev) => edit({ note: ev.target.value })} />
        <p className="hint">Discord のユーザーID は、ユーザー設定 → 詳細設定 → 開発者モードを ON にしてから、名前を右クリック →「ユーザーIDをコピー」。入れておくと開催前の知らせなどでメンションされます。</p>
        <div className="btns">
          {/* いる人を直すときは、変えるまで押せない */}
          <button type="submit" className="btn primary" id="msave" disabled={busy || (!!m && !draft)}>{m ? '更新' : '追加'}</button>
          <button type="button" className="btn" id="mclear" onClick={() => pick('')}>新規に戻す</button>
          <button type="button" className="btn danger" id="mdel" hidden={!m} disabled={busy} onClick={remove}>このメンバーを削除</button>
        </div>
        <div id="mmsg" className={'mt-8 min-h-[1.4em] empty:hidden ' + (msg ? (msg.err ? 'text-err-text' : 'text-ok-text') : '')}>{msg ? msg.text : ''}</div>
      </form>
      <div className="wrap">
        <table id="memberTable" ref={tableRef}>
          <tbody>
            <tr><th>名前</th><th>Discord ユーザーID</th><th>備考</th><th className="c">参加</th><th className="c">GM</th></tr>
            {d.members.map((x) => {
              const part = act.filter((s) => s.members.indexOf(x.name) >= 0 && s.gm !== x.name).length, gm = act.filter((s) => s.gm === x.name).length;
              return (
                // いまフォームで直している人の行は、色を付ける
                <tr className={'click' + (x.name === sel ? ' checked' : '')} aria-selected={x.name === sel} data-name={x.name} key={x.name}>
                  <td><b>{x.name}</b>{x.linked && <>{' '}<span className="hint inline-block whitespace-nowrap" title="Discord でログインしたことがある"><Icon name="check" size="xs" />ログイン済み</span></>}</td>
                  <td>{x.discordId ? <>{x.discordId}{x.idOk === false && <>{' '}<span className="hint text-err-text" title="Discord のユーザーID は 17〜20 桁の数字です"><Icon name="warning" size="xs" /> 桁がおかしい</span></>}</> : <span className="hint">（未設定）</span>}</td>
                  <td className="min-w-[8em]">{x.note}</td><td className="c">{part}</td><td className="c">{gm}</td>
                </tr>
              );
            })}
            {!d.members.length && <tr><td colSpan={5} className="hint">まだメンバーがいません。上のフォームから足します。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">行をタップすると上のフォームに入ります。</p>
    </div>
  );
}
