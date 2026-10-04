import { Icon } from '../../ui/Icon';

/**
 * 開発用ログイン（開発サーバーだけ）。選んだメンバーとして、サンプルのグループに入る（素の POST。サーバーが cookie を付けて移す）。
 * Home が import.meta.env.DEV のときだけ描くので、本番の組み立てには入らない
 */
export function DevLogin({ users }: { users: string[] }) {
  return (
    <form className="dev" id="devForm" method="post" action="/dev/login">
      <h2>開発用ログイン</h2>
      <p className="hint">開発サーバーだけで出ます。サンプルのグループに、選んだメンバーとして入ります（ひよりは管理者）。</p>
      <div className="row">
        <select name="as" id="devAs" aria-label="入るメンバー">
          {users.map((n) => <option key={n}>{n}</option>)}
        </select>
        <button className="btn" type="submit">
          <Icon name="arrow_forward" />
          入る
        </button>
      </div>
    </form>
  );
}
