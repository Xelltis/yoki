// 設定のタブ（ふだんの画面）: あなたの名前と備考・この端末（自動更新・見た目・文字サイズ・ログアウト）。管理者には管理画面への入口
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { RpcResult } from '../../../../shared/api';
import { HELP_URL } from '../../../app/links';
import { load } from '../../../app/storage';
import { chosenTheme, setFont, setTheme, themeStore } from '../../../app/theme';
import { field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { PageHead } from '../../../ui/PageHead';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { useLogout } from '../shell/Header';

export function SettingsTab() {
  const d = useData();
  const { sync, groupId } = useConsole();
  const view = useStore(sync.view);
  useStore(themeStore);
  const logout = useLogout();
  const m = d.members.filter((x) => x.name === d.me.name)[0];
  /** 書きかけ（保存するまで、読み直しても上書きしない） */
  const [draft, setDraft] = useState<{ name: string; note: string } | null>(null);
  const [me, setMe] = useState({ saving: false, msg: '' });
  const name = draft ? draft.name : m ? m.name : d.me.name, note = draft ? draft.note : m ? m.note : '';
  const font = load('font') === 'm' || load('font') === 'l' ? load('font') : '';
  const saveMe = () => {
    const form = { oldName: d.me.name, name: name.trim(), note: note.trim(), discordId: m ? m.discordId : '' };
    if (!form.name) { setMe({ saving: false, msg: '名前を入れてください。' }); return; }
    setMe({ saving: true, msg: '保存しています…' });
    sync.write<RpcResult>('saveMember', form).then((res) => { setDraft(null); setMe({ saving: false, msg: res.message }); toast(res.message); },
      (e: Error) => setMe({ saving: false, msg: e.message }));
  };
  return (
    <section id="tab-settings" className="max-w-1120">
      <PageHead title="設定" lead="この端末の見た目と、あなたの名前です。グループの設定（知らせ・メンバー・管理者）は、管理者が管理画面で変えます。" />
      <div className="card border-accent-line" id="adminEntry" hidden={!d.isAdmin}>
        <h3><Icon name="shield" size="sm" />グループの管理画面</h3>
        <p className="hint">メンバーの登録・卓をまとめて変える・知らせ（Discord）・管理者・送信の記録・グループを消す、は管理画面にあります。あなたは管理者なので開けます。</p>
        <div className="btns"><Link className="btn primary" to="/g/$groupId/admin/" params={{ groupId }}><Icon name="shield" size="sm" />管理画面を開く</Link></div>
      </div>
      <form className="card" id="meCard" onSubmit={(ev) => { ev.preventDefault(); saveMe(); }}>
        <h3><Icon name="person" size="sm" />あなたの名前と備考</h3>
        <p className="hint">予定表の列と、卓の参加者に出る名前です。グループの中で同じ名前は使えません。</p>
        <div className="row">
          <div><label className={fieldLabel} htmlFor="meName">名前</label><input type="text" className={field} id="meName" required value={name} onChange={(ev) => setDraft({ name: ev.target.value, note })} /></div>
          <div><label className={fieldLabel} htmlFor="meNote">備考</label><input type="text" className={field} id="meNote" value={note} onChange={(ev) => setDraft({ name, note: ev.target.value })} /></div>
        </div>
        <p className="hint" id="meDiscord">{m && m.linked ? 'Discord でログインしています。Discord の ID は自動で入るので、知らせでメンションが付きます。' : ''}</p>
        <div className="btns"><button type="submit" className="btn primary" id="meSave" disabled={me.saving}>保存</button><span className="hint" id="meMsg">{me.msg}</span></div>
      </form>
      <div className="card">
        <h3><Icon name="devices" size="sm" />この端末</h3>
        <p className="hint">このブラウザだけの設定です。グループのほかの人には関係しません。</p>
        <div className="row">
          <div>
            <label className={fieldLabel} htmlFor="stAutoRefresh">自動更新 <small className={fieldNote}>読み込む間隔</small></label>
            <select className={field} id="stAutoRefresh" value={String(view.autoMin)} onChange={(ev) => {
              const v = ev.target.value;
              sync.setAutoMinutes(+v);
              toast(+v ? '自動更新を ' + v + ' 分ごとにしました（この端末だけ）' : '自動更新を止めました（この端末だけ）');
            }}>
              <option value="0">しない</option><option value="1">1 分ごと</option><option value="3">3 分ごと</option><option value="5">5 分ごと</option><option value="10">10 分ごと</option>
            </select>
          </div>
          <div>
            <label className={fieldLabel} htmlFor="stTheme">見た目</label>
            <select className={field} id="stTheme" value={chosenTheme()} onChange={(ev) => setTheme(ev.target.value)}>
              <option value="">端末の設定に合わせる</option><option value="light">ライト</option><option value="dark">ダーク</option>
            </select>
          </div>
          <div>
            <label className={fieldLabel} htmlFor="stFont">文字サイズ</label>
            <select className={field} id="stFont" value={font} onChange={(ev) => {
              const v = ev.target.value;
              setFont(v);
              toast('文字サイズを' + (v === 'l' ? '大' : v === 'm' ? '中' : '小') + 'にしました（この端末だけ）');
            }}>
              <option value="">小</option><option value="m">中</option><option value="l">大</option>
            </select>
          </div>
        </div>
        <p className="hint">入力中や窓を開いているあいだは、読み込みを待ちます。ほかのタブから戻ったときも、しばらく経っていれば読み込みます。</p>
        <div className="btns">
          <a className="btn" id="stHelpLink" href={HELP_URL} target="_blank" rel="noopener"><Icon name="menu_book" size="sm" />使い方を見る</a>
          <button type="button" className="btn danger" id="stLogout" onClick={logout}><Icon name="logout" size="sm" />ログアウト</button>
        </div>
        <p className="hint"><a href="/terms" target="_blank" rel="noopener">利用規約</a>・<a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a></p>
      </div>
    </section>
  );
}
