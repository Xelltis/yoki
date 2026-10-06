import { Icon } from '../../ui/Icon';
import { heroBtn, heroField } from './styles';

/**
 * 開発用ログイン（開発サーバーだけ）。選んだメンバーとして、サンプルのグループに入る（素のPOST。サーバーがcookieを付けて移す）。
 * 入口の青い枠の中、Discordでログインと同じ場所に並べる。Discordでログインもあるときは、枠線だけのボタンにして見分ける。
 * Homeがimport.meta.env.DEVのときだけ描くので、本番の組み立てには入らない
 */
export function DevLogin({ users, ghost = false, linkGoogle = false }: { users: string[]; ghost?: boolean; linkGoogle?: boolean }) {
  return (
    <form className="flex flex-wrap items-center gap-8" id="devForm" method="post" action="/dev/login">
      {/* 初めてのGoogleのアカウントを、この人に結びつける（Discordでログインの ?link_google=1と同じ） */}
      {linkGoogle && <input type="hidden" name="link_google" value="1" />}
      <select className={heroField} name="as" id="devAs" aria-label="入るメンバー">
        {users.map((n) => <option key={n}>{n}</option>)}
      </select>
      <button className={heroBtn(ghost)} type="submit">
        <Icon name="login" className="align-[0]" />
        開発用ログイン
      </button>
      <span className="basis-full text-12 text-white/75">開発サーバーだけで出ます。サンプルのグループに、選んだメンバーとして入ります（ひよりは管理者）。</span>
    </form>
  );
}
