// 入口（/）: ログインしているかを /api/me で聞き、グループの一覧・グループを作る・ログインを出す
import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '../../../shared/api';
import { isReturnPath } from '../../../shared/routes';
import { HELP_URL } from '../../app/links';
import { Icon } from '../../ui/Icon';
import { CreateGroup } from './CreateGroup';
import { DevLogin } from './DevLogin';
import './home.css';

type LoggedIn = Extract<MeResponse, { loggedIn: true }>;

/** ?login=… と ?deleted=1 で出すお知らせ（ログインの戻り・グループを消したあと） */
const NOTICE: Record<string, string> = {
  cancelled: 'ログインをやめました。',
  banned: 'このアカウントでは入れません（運営者が締め出しています）。',
  deleted: 'グループを消しました。',
  closed: '今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。',
};

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('読み込めませんでした。');
  return (await res.json()) as MeResponse;
}

export function Home() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const q = new URLSearchParams(location.search);
  const say = NOTICE[q.get('login') || ''] || (q.get('deleted') === '1' ? NOTICE.deleted : '');
  return (
    <>
      <header className="bar">
        <div className="brand">
          <img className="logo" src="/icon-192.png" alt="" width={34} height={34} />
          卓予定
        </div>
        {me.data?.loggedIn && <Who me={me.data} />}
      </header>
      <main>
        {say && <p className="notice" id="notice">{say}</p>}
        {me.isPending ? (
          <section className="card" id="loading">読み込んでいます…</section>
        ) : me.isError ? (
          <section className="card" id="loading">読み込めませんでした。少し待ってから開き直してください。</section>
        ) : me.data.loggedIn ? (
          <Groups me={me.data} />
        ) : (
          <Guest me={me.data} back={q.get('return_to')} />
        )}
        <p className="foot">
          <a href={HELP_URL} target="_blank" rel="noopener">
            <Icon name="menu_book" size="sm" />
            使い方
          </a>
          <a href="/terms">利用規約</a>
          <a href="/privacy">プライバシーポリシー</a>
        </p>
      </main>
    </>
  );
}

/** 右上: ログインしている人とログアウト（素の POST。サーバーがログインを消して入口へ戻す） */
function Who({ me }: { me: LoggedIn }) {
  const avatar = me.user.avatar ? 'https://cdn.discordapp.com/avatars/' + me.user.id + '/' + me.user.avatar + '.png?size=64' : '';
  return (
    <div className="who" id="who">
      {avatar && <img src={avatar} alt="" />}
      <span>{me.user.name}</span>
      <form method="post" action="/auth/logout">
        <button className="btn ghost" type="submit">
          <Icon name="logout" />
          ログアウト
        </button>
      </form>
    </div>
  );
}

/** ログインしていない: Discord でログイン（と、開発サーバーだけの開発用ログイン） */
function Guest({ me, back }: { me: MeResponse; back: string | null }) {
  // ログインのあとに戻れる道（src/shared/routes.ts の一覧にある画面だけ）。入口（/）へは、付けなくても戻る
  const login = back && back !== '/' && isReturnPath(back) ? '/auth/login?return_to=' + encodeURIComponent(back) : '/auth/login';
  return (
    <section className="card" id="guest">
      <h1>卓予定</h1>
      <p className="lead">TRPG の卓の予定を、Discord サーバーの仲間と管理します。卓の登録・メンバーの予定・募集・日程調整をこの画面で行い、知らせを Discord に送ります。</p>
      {me.discord && (
        <a className="btn primary" id="loginBtn" href={login}>
          <Icon name="login" />
          Discord でログイン
        </a>
      )}
      <p className="hint">
        ログインすると、<a href="/terms">利用規約</a>と<a href="/privacy">プライバシーポリシー</a>に同意したものとします。
      </p>
      {!me.discord && !me.dev && <p className="hint" id="noDiscord">Discord ログインの設定がありません（DISCORD_CLIENT_ID）。</p>}
      {!me.registration && <p className="hint" id="closedGuest">今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。</p>}
      {/* 本番の組み立てでは import.meta.env.DEV が偽になり、開発用ログインごと消える（vite.config.ts の noDevLogin が確かめる） */}
      {import.meta.env.DEV && me.dev && <DevLogin users={me.dev.users} />}
    </section>
  );
}

/** ログインしている: 入れるグループの一覧と、グループを作る */
function Groups({ me }: { me: LoggedIn }) {
  return (
    <>
      <section className="card" id="home">
        {me.operator && (
          <a className="op-link" id="opLink" href="/admin/">
            <Icon name="shield" size="sm" />
            運営の管理画面
          </a>
        )}
        <h2>
          <Icon name="group" />
          グループ
        </h2>
        <ul className="groups" id="groups">
          {me.groups.map((g) => (
            <li key={g.id}>
              <a href={'/g/' + encodeURIComponent(g.id) + '/'}>
                <b>{g.title}</b>
                <small>{g.guildName}</small>
                <Icon name="arrow_forward" />
              </a>
            </li>
          ))}
        </ul>
        {me.groups.length === 0 && <p className="hint" id="noGroups">まだ入れるグループがありません。Discord サーバーの管理者がグループを作ると、ここに出ます。</p>}
        {me.stale && (
          <p className="hint" id="stale">
            <a href="/auth/login?return_to=/">
              <Icon name="refresh" size="sm" />
              Discord サーバーの一覧を読み直す
            </a>
            （最後に読んでから 1 日以上たっています）
          </p>
        )}
      </section>
      {/* 受付を止めていても、運営者は作れる */}
      {me.creatable.length > 0 && <CreateGroup creatable={me.creatable} closed={!me.registration && !me.operator} />}
    </>
  );
}
