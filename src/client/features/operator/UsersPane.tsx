// 運営者の管理画面の「利用者」。一度でもログインした人の一覧と、ログインを切る・締め出す（理由を書く窓）・戻す・消す
import { useLayoutEffect, useRef, useState } from 'react';
import type { AdminUserRow } from '../../../shared/admin';
import { askConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { ADMIN_READS, useAct, useAdmin } from './api';
import { fmt } from './format';

export function UsersPane() {
  const users = useAdmin<AdminUserRow[]>(ADMIN_READS.users.queryKey, ADMIN_READS.users.path).data;
  const act = useAct();
  const [filter, setFilter] = useState('');
  /** 締め出す理由を書いている人 */
  const [ban, setBan] = useState<AdminUserRow | null>(null);
  const [reason, setReason] = useState('');
  const q = filter.trim().toLowerCase();
  const list = (users || []).filter((u) => !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.id.includes(q));
  const userPath = (id: string, op: string) => '/api/admin/users/' + encodeURIComponent(id) + '/' + op;
  const logout = (u: AdminUserRow) => askConfirm({ title: u.name + ' のログインを切りますか？', message: 'その人のログインをすべて消します。Discord でログインし直せば、また入れます。', ok: 'ログインを切る' },
    () => { void act(userPath(u.id, 'logout'), {}); });
  const del = (u: AdminUserRow) => askConfirm({
    title: u.name + ' を消しますか？',
    message: 'ログイン・Discord の名前・入っているサーバーの控えと、どのグループのメンバーの行も消します。予定とメモは消え、卓と回答には名前だけが残ります。元に戻せません。Discord サーバーにいれば、次に開いたときにまた入れます。',
    ok: '消す', danger: true,
  }, () => { void act(userPath(u.id, 'delete'), {}); });
  return (
    <div className="set-pane" data-pane="users">
      <div className="card">
        <h3><Icon name="person" size="sm" />利用者 <small className="hint">一度でもログインした人。最後にログインしたのが新しい順</small></h3>
        <input type="search" id="opUserFilter" placeholder="名前か Discord ID で絞る" aria-label="利用者を絞る" value={filter} onChange={(ev) => setFilter(ev.target.value)} />
        <div className="wrap">
          <table id="opUsers" className="op-table">
            {users && (
              <tbody>
                <tr><th>名前</th><th>入っているグループ</th><th>最後のログイン</th><th className="c">ログイン</th><th aria-label="操作"></th></tr>
                {list.map((u) => (
                  <tr className={u.bannedAt ? 'op-banned' : ''} key={u.id}>
                    <td>
                      <b>{u.name}</b>
                      {u.operator && <>{' '}<span className="op-chip">運営者</span></>}
                      {u.bannedAt && <>{' '}<span className="op-chip bad">締め出し中</span></>}
                      <small className="op-id">{u.id + '（' + u.username + '）'}</small>
                      {u.bannedAt && <small className="op-id">{fmt(u.bannedAt) + (u.bannedReason ? '：' + u.bannedReason : '')}</small>}
                    </td>
                    <td>{u.groups.map((g) => g.title).join('、') || <span className="hint">なし</span>}</td>
                    <td className="nw">{fmt(u.lastLoginAt)}<small className="op-id">{'はじめて ' + fmt(u.createdAt)}</small></td>
                    <td className="c">{u.logins}</td>
                    <td className="nw op-acts">
                      {u.logins > 0 && <button type="button" className="btn small" data-logout={u.id} onClick={() => logout(u)}><Icon name="logout" size="sm" />ログインを切る</button>}
                      {!u.operator && (u.bannedAt
                        ? <button type="button" className="btn small" data-unban={u.id} onClick={() => { void act(userPath(u.id, 'ban'), { banned: false }); }}><Icon name="undo" size="sm" />戻す</button>
                        : (
                          <>
                            <button type="button" className="btn small danger" data-ban={u.id} onClick={() => { setReason(''); setBan(u); }}><Icon name="block" size="sm" />締め出す</button>
                            <button type="button" className="btn small danger" data-del={u.id} onClick={() => del(u)}><Icon name="delete" size="sm" />消す</button>
                          </>
                        ))}
                    </td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5} className="hint">{q ? '合う人がいません。' : 'まだ誰もログインしていません。'}</td></tr>}
              </tbody>
            )}
          </table>
        </div>
        <p className="hint">「ログインを切る」は、その人のログインをすべて消します（Discord でログインし直せば、また入れます）。「締め出す」と、ログインもできなくなります。別の Discord アカウントは止められません。</p>
        <p className="hint">「消す」は、本人から消してほしいと頼まれたときに使います。その人の情報（ログイン・Discord の名前・入っているサーバーの控え）と、どのグループのメンバーの行も消します。予定とメモは消え、卓と回答には名前だけが残ります。元に戻せません。Discord サーバーにいれば、次に開いたときにまた入れます。締め出している人は、締め出しの印が消えてしまうので消せません。</p>
      </div>
      <BanModal user={ban} reason={reason} setReason={setReason} onClose={() => setBan(null)}
        onBan={(u) => { setBan(null); void act(userPath(u.id, 'ban'), { banned: true, reason: reason.trim() }); }} />
    </div>
  );
}

/** 締め出す理由を書く窓 */
function BanModal({ user, reason, setReason, onClose, onBan }: {
  user: AdminUserRow | null; reason: string; setReason: (v: string) => void; onClose: () => void; onBan: (u: AdminUserRow) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // 開いたら、理由の欄に入る
  useLayoutEffect(() => { if (user) ref.current?.focus(); }, [user]);
  return (
    <Modal id="banModal" open={!!user} onClose={onClose}>
      <form className="box confirm" id="banForm" role="dialog" aria-modal="true" aria-labelledby="banTitle" tabIndex={-1}
        onSubmit={(ev) => { ev.preventDefault(); if (user) onBan(user); }}>
        <h3 id="banTitle">{user ? user.name + ' を締め出す' : '締め出す'}</h3>
        <p id="banText">ログインをすべて消し、Discord でログインし直しても入れなくします。あとで戻せます。</p>
        <label className="f" htmlFor="banReason">理由 <small>記録に残す（本人には見えない）</small></label>
        <input type="text" id="banReason" maxLength={200} ref={ref} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        <div className="btns">
          <button type="button" className="btn" id="banCancel" onClick={onClose}>やめる</button>
          <button type="submit" className="btn danger-fill">締め出す</button>
        </div>
      </form>
    </Modal>
  );
}
