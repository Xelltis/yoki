// 入口（/）: ログインしているかを /api/me で聞き、グループの一覧・グループを作る・ログインを出す
import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '../../../shared/api';
import { isReturnPath } from '../../../shared/routes';
import { HELP_URL } from '../../app/links';
import { Icon } from '../../ui/Icon';
import { CreateGroup } from './CreateGroup';
import { DevLogin } from './DevLogin';
import { btnPrimary, card, h2, hint, hintLink, icon, iconSm } from './styles';

type LoggedIn = Extract<MeResponse, { loggedIn: true }>;

/** ?login=… と ?deleted=1 で出すお知らせ（ログインの戻り・グループを消したあと） */
const NOTICE: Record<string, string> = {
  cancelled: 'ログインをやめました。',
  banned: 'このアカウントでは入れません（運営者が締め出しています）。',
  deleted: 'グループを消しました。',
  closed: '今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。',
};

const footLink = 'inline-flex items-center gap-4 font-semibold text-accent-strong no-underline';

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
    // 入口だけの文字と色の決まり（scheme は、ボタンや欄の色を端末の明るい・ダークに合わせる）
    <div className="font-home text-15 leading-[1.7] scheme-light-dark">
      <header className="flex items-center justify-between gap-12 bg-home-bar px-20 py-12 text-white">
        <div className="flex items-center gap-10 text-17 font-bold">
          <img className="block h-34 w-34" src="/icon-192.png" alt="" width={34} height={34} />
          卓予定
        </div>
        {me.data?.loggedIn && <Who me={me.data} />}
      </header>
      <main className="mx-auto max-w-640 px-16 pt-24 pb-48">
        {say && <p className="rounded-md bg-accent-soft px-14 py-10" id="notice">{say}</p>}
        {me.isPending ? (
          <section className={card} id="loading">読み込んでいます…</section>
        ) : me.isError ? (
          <section className={card} id="loading">読み込めませんでした。少し待ってから開き直してください。</section>
        ) : me.data.loggedIn ? (
          <Groups me={me.data} />
        ) : (
          <Guest me={me.data} back={q.get('return_to')} />
        )}
        {/* foot は e2e が探す印 */}
        <p className="foot flex flex-wrap justify-center gap-x-20 gap-y-6">
          <a className={footLink} href={HELP_URL} target="_blank" rel="noopener">
            <Icon name="menu_book" size="sm" className={iconSm} />
            使い方
          </a>
          <a className={footLink} href="/terms">利用規約</a>
          <a className={footLink} href="/privacy">プライバシーポリシー</a>
        </p>
      </main>
    </div>
  );
}

/** 右上: ログインしている人とログアウト（素の POST。サーバーがログインを消して入口へ戻す） */
function Who({ me }: { me: LoggedIn }) {
  const avatar = me.user.avatar ? 'https://cdn.discordapp.com/avatars/' + me.user.id + '/' + me.user.avatar + '.png?size=64' : '';
  return (
    <div className="flex items-center gap-10 text-14" id="who">
      {avatar && <img className="h-28 w-28 rounded-full" src={avatar} alt="" />}
      <span>{me.user.name}</span>
      <form className="m-0" method="post" action="/auth/logout">
        <button className="inline-flex h-32 cursor-pointer items-center gap-6 rounded-full border border-[rgba(255,255,255,.25)] bg-transparent px-12 font-home text-13 leading-[1.7] font-semibold text-inherit no-underline" type="submit">
          <Icon name="logout" className={icon} />
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
    <section className={card} id="guest">
      <h1 className="m-0 mb-8 text-22">卓予定</h1>
      <p className="m-0 mb-16 text-muted">TRPG の卓の予定を、Discord サーバーの仲間と管理します。卓の登録・メンバーの予定・募集・日程調整をこの画面で行い、知らせを Discord に送ります。</p>
      {me.discord && (
        <a className={btnPrimary} id="loginBtn" href={login}>
          <Icon name="login" className={icon} />
          Discord でログイン
        </a>
      )}
      <p className={hint}>
        ログインすると、<a className={hintLink} href="/terms">利用規約</a>と<a className={hintLink} href="/privacy">プライバシーポリシー</a>に同意したものとします。
      </p>
      {!me.discord && !me.dev && <p className={hint} id="noDiscord">Discord ログインの設定がありません（DISCORD_CLIENT_ID）。</p>}
      {!me.registration && <p className={hint} id="closedGuest">今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。</p>}
      {/* 本番の組み立てでは import.meta.env.DEV が偽になり、開発用ログインごと消える（vite.config.ts の noDevLogin が確かめる） */}
      {import.meta.env.DEV && me.dev && <DevLogin users={me.dev.users} />}
    </section>
  );
}

/** ログインしている: 入れるグループの一覧と、グループを作る */
function Groups({ me }: { me: LoggedIn }) {
  return (
    <>
      <section className={card} id="home">
        {me.operator && (
          // 色はブラウザのリンクの色のまま（入口を作り直すときに決める）
          <a className="float-right inline-flex items-center gap-4 text-13 font-semibold text-[color:LinkText] no-underline visited:text-[color:VisitedText]" id="opLink" href="/admin/">
            <Icon name="shield" size="sm" className={iconSm} />
            運営の管理画面
          </a>
        )}
        <h2 className={h2}>
          <Icon name="group" className={icon} />
          グループ
        </h2>
        {/* groups は確かめの道具が探す印 */}
        <ul className="groups m-0 grid list-none gap-8 p-0" id="groups">
          {me.groups.map((g) => (
            <li key={g.id}>
              <a className="grid grid-cols-[1fr_auto] grid-rows-[auto_auto] items-center gap-x-12 rounded-[12px] border border-line px-14 py-12 text-inherit no-underline hover:bg-hover" href={'/g/' + encodeURIComponent(g.id) + '/'}>
                <b className="col-[1]">{g.title}</b>
                <small className="col-[1] text-12 text-muted">{g.guildName}</small>
                <Icon name="arrow_forward" className={icon + ' col-[2] row-[1/span_2] text-accent-strong'} />
              </a>
            </li>
          ))}
        </ul>
        {me.groups.length === 0 && <p className={hint} id="noGroups">まだ入れるグループがありません。Discord サーバーの管理者がグループを作ると、ここに出ます。</p>}
        {me.stale && (
          <p className={hint} id="stale">
            <a className={hintLink} href="/auth/login?return_to=/">
              <Icon name="refresh" size="sm" className={iconSm} />
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
