// 運営者の管理画面の「グループ」。一覧と、開いたグループの詳しい中身（管理者の付け外し・Discord サーバーの付け替え・消す）。
// 開いているグループは URL の ?open=<id> に出す
import { getRouteApi } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import type { AdminGroupDetail, AdminGroupRow } from '../../../shared/admin';
import { askConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { ADMIN_READS, useAct, useAdmin } from './api';
import { ago, fmt } from './format';

const paneRoute = getRouteApi('/admin/$pane');

export function GroupsPane() {
  const groups = useAdmin<AdminGroupRow[]>(ADMIN_READS.groups.queryKey, ADMIN_READS.groups.path).data;
  const { open } = paneRoute.useSearch();
  const navigate = paneRoute.useNavigate();
  // 消えたグループは開かない
  const openId = open && groups && groups.some((g) => g.id === open) ? open : '';
  const detail = useAdmin<AdminGroupDetail>(['admin', 'group', openId], '/api/admin/groups/' + encodeURIComponent(openId), { enabled: !!openId, keepPrevious: true }).data;
  const show = (id: string) => navigate({ search: id ? { open: id } : {}, replace: true });
  return (
    <div className="set-pane" data-pane="groups">
      <div className="card">
        <h3><Icon name="group" size="sm" />グループ <small className="hint">最後に使われたのが新しい順。行を押すと詳しく出ます</small></h3>
        <div className="wrap">
          <table id="opGroups" className="op-table">
            {groups && (
              <tbody>
                <tr><th>グループ</th><th>Discord サーバー</th><th className="c">メンバー</th><th className="c">管理者の印</th><th className="c">卓</th><th>最後に使われた</th><th className="c">7 日の失敗</th></tr>
                {groups.map((g) => (
                  <tr className={'click' + (g.id === openId ? ' on' : '')} data-gid={g.id} key={g.id} onClick={() => { void show(g.id); }}>
                    <td><b>{g.title}</b><small className="op-id">{g.id}</small></td>
                    <td>{g.guildName}<small className="op-id">{g.guildId}</small></td>
                    <td className="c">{g.memberCount}<small className="op-id">{'ログイン ' + g.linkedCount}</small></td>
                    <td className="c">{g.adminCount}</td>
                    <td className="c">{g.activeCount + ' / ' + g.sessionCount}</td>
                    <td className="nw">{fmt(g.lastUsedAt)}<small className="op-id">{ago(g.lastUsedAt)}</small></td>
                    <td className={'c' + (g.failuresWeek ? ' op-bad' : '')}>{g.failuresWeek}</td>
                  </tr>
                ))}
                {!groups.length && <tr><td colSpan={7} className="hint">まだグループがありません。</td></tr>}
              </tbody>
            )}
          </table>
        </div>
      </div>
      <div className="card op-detail" id="opGroup" hidden={!openId || !detail}>
        {openId && detail && <GroupDetail d={detail} key={detail.id} onClose={() => show('')} />}
      </div>
    </div>
  );
}

function GroupDetail({ d, onClose }: { d: AdminGroupDetail; onClose: () => Promise<void> }) {
  const act = useAct();
  const [confirm, setConfirm] = useState('');
  const path = '/api/admin/groups/' + encodeURIComponent(d.id);
  const who = d.createdByName || d.createdBy;
  const submit = (ev: FormEvent<HTMLFormElement>, run: (data: FormData, f: HTMLFormElement) => void) => {
    ev.preventDefault();
    run(new FormData(ev.currentTarget), ev.currentTarget);
  };
  const val = (data: FormData, k: string) => String(data.get(k) || '');
  return (
    <>
      <div className="op-detail-h"><h3>{d.title}</h3><button type="button" className="btn small" data-close onClick={() => { void onClose(); }}><Icon name="close" size="sm" />閉じる</button></div>
      <dl className="op-dl">
        <dt>Discord サーバー</dt><dd>{d.guildName + ' '}<small className="op-id">{d.guildId}</small></dd>
        <dt>作った人</dt><dd>{who ? who + ' ／ ' + fmt(d.createdAt) : <><span className="hint">消した利用者</span>{' ／ ' + fmt(d.createdAt)}</>}</dd>
        <dt>最後に使われた</dt><dd>{fmt(d.lastUsedAt)}</dd>
        <dt>卓</dt><dd>{d.activeCount + ' 件が動いている（全部で ' + d.sessionCount + ' 件）'}</dd>
        <dt>知らせの基本のチャンネル</dt><dd>{d.channelSet ? 'あり' : 'なし'}</dd>
        <dt>サーバーの管理者</dt>
        <dd>{d.guildManagers.length ? <>{d.guildManagers.map((x) => x.name).join('、') + ' '}<span className="hint">（印が無くても管理者）</span></> : <span className="hint">ログインした人の中にはいません</span>}</dd>
      </dl>
      <h4><Icon name="shield" size="sm" />メンバーと管理者</h4>
      <div className="wrap">
        <table className="op-table">
          <tbody>
            <tr><th>名前</th><th>Discord</th><th>最後のログイン</th><th aria-label="管理者の付け外し"></th></tr>
            {d.members.map((m) => (
              <tr key={m.id}>
                <td><b>{m.name}</b>{m.isAdmin && <>{' '}<span className="op-chip">管理者</span></>}</td>
                <td>{m.userId ? <>{m.userName}<small className="op-id">{m.userId}</small></> : <><span className="hint">まだ開いていない</span>{m.discordId && <small className="op-id">{m.discordId}</small>}</>}</td>
                <td className="nw">{fmt(m.lastLoginAt)}</td>
                <td className="nw">
                  {m.isAdmin
                    ? <button type="button" className="btn small" data-admin="0" data-mid={m.id} onClick={() => { void act(path + '/admins', { memberId: m.id, admin: false }); }}>管理者から外す</button>
                    : <button type="button" className="btn small" data-admin="1" data-mid={m.id} onClick={() => { void act(path + '/admins', { memberId: m.id, admin: true }); }}><Icon name="shield" size="sm" />管理者にする</button>}
                </td>
              </tr>
            ))}
            {!d.members.length && <tr><td colSpan={4} className="hint">メンバーがいません。</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="op-form" id="opAddAdmin" onSubmit={(ev) => submit(ev, (data, f) => {
        void act(path + '/admins', { discordId: val(data, 'discordId'), name: val(data, 'name'), admin: true }).then((ok) => { if (ok) f.reset(); });
      })}>
        <b><Icon name="person_add" size="sm" />まだ開いていない人を管理者として足す</b>
        <div className="row">
          <label>Discord ユーザー ID<input type="text" name="discordId" inputMode="numeric" placeholder="123456789012345678" required /></label>
          <label>名前 <small>メンバーにいなければ使う</small><input type="text" name="name" /></label>
        </div>
        <button type="submit" className="btn">管理者として足す</button>
        <p className="hint">初めてグループを開いたときに、その人に結びつきます。管理者の印は 0 人にできないので、付け替えるときは足してから外します。</p>
      </form>
      <form className="op-form" id="opGuild" onSubmit={(ev) => submit(ev, (data, f) => {
        const body = { guildId: val(data, 'guildId').trim(), guildName: val(data, 'guildName').trim() };
        askConfirm({ title: 'Discord サーバーを付け替えますか？', message: '「' + d.title + '」を、サーバー ' + body.guildId + ' に結び直します。いまのサーバーの人は入れなくなります。知らせのチャンネルも外れます。', ok: '付け替える', danger: true },
          () => { void act(path + '/guild', body).then((ok) => { if (ok) f.reset(); }); });
      })}>
        <b><Icon name="swap_horiz" size="sm" />Discord サーバーを付け替える</b>
        <div className="row">
          <label>新しいサーバーの ID<input type="text" name="guildId" inputMode="numeric" placeholder="123456789012345678" required /></label>
          <label>サーバーの名前 <small>分からないときだけ要る</small><input type="text" name="guildName" /></label>
        </div>
        <button type="submit" className="btn">付け替える</button>
        <p className="hint">新しいサーバーの人が入れるようになり、いまのサーバーの人は入れなくなります。メンバーの行と管理者の印は残ります。知らせのチャンネルは外れるので、新しいサーバーに Bot を招いて選び直してもらいます。</p>
      </form>
      <form className="op-form danger-card" id="opDelete" onSubmit={(ev) => submit(ev, () => {
        askConfirm({ title: '「' + d.title + '」を消しますか？', message: '中身もすべて消え、元に戻せません。', ok: '消す', danger: true },
          () => { void act(path + '/delete', { confirm }, { before: onClose, skip: ['admin', 'group', d.id] }); });
      })}>
        <b><Icon name="delete" size="sm" />グループを消す</b>
        <p>卓・メンバーの予定・メモ・日程調整の回答・送信の記録が、すべて消えます。元に戻せません。</p>
        <label>{'確かめのために、グループの名前「' + d.title + '」を入れてください'}<input type="text" name="confirm" autoComplete="off" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} /></label>
        <button type="submit" className="btn danger-fill" disabled={confirm.trim() !== d.title}>グループを消す</button>
      </form>
    </>
  );
}
