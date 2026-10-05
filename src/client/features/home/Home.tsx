// 入口（/）: ログインしているかを /api/me で聞き、グループの一覧・グループを作る・ログインを出す
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { MeResponse } from '../../../shared/api';
import { isReturnPath } from '../../../shared/routes';
import { HELP_URL } from '../../app/links';
import { fetchMe, ME_KEY } from '../../app/me';
import { GroupTile } from '../../ui/GroupTile';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { CreateGroup } from './CreateGroup';
import { DevLogin } from './DevLogin';
import { card, h2, heroBtn, hint } from './styles';

type LoggedIn = Extract<MeResponse, { loggedIn: true }>;

/** ?login=… と ?deleted=1 で出すお知らせ（ログインの戻り・グループを消したあと）。[文, 色とアイコン] */
const NOTICE: Record<string, [string, 'info' | 'ok' | 'warn' | 'bad']> = {
  cancelled: ['ログインをやめました。', 'info'],
  banned: ['このアカウントでは入れません（運営者が締め出しています）。', 'bad'],
  deleted: ['グループを消しました。', 'ok'],
  closed: ['今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。', 'warn'],
  'google-new': ['初めての Google アカウントです。続けて「Discord でログイン」を押してください。Discord のアカウントに結びつき、次からは Google でもログインできます。', 'info'],
  'google-linked': ['Google でもログインできるようになりました。', 'ok'],
};
/** お知らせの色（地と字の組）とアイコン */
const TONE: Record<'info' | 'ok' | 'warn' | 'bad', [string, IconName]> = {
  info: ['border-accent-line bg-accent-soft [&>.ic]:text-accent-text', 'notifications'],
  ok: ['border-[color-mix(in_srgb,var(--ok-text)_35%,var(--line))] bg-ok [&>.ic]:text-ok-text', 'check'],
  warn: ['border-[color-mix(in_srgb,var(--soon-text)_35%,var(--line))] bg-soon [&>.ic]:text-soon-text', 'warning'],
  bad: ['border-[color-mix(in_srgb,var(--err-text)_35%,var(--line))] bg-warn [&>.ic]:text-err-text', 'block'],
};

/** できることの紹介（ログインの前）。[アイコン, 題, 一言, アイコンの色] */
const FEATURES: [IconName, string, string, string][] = [
  ['calendar_month', 'みんなの予定が一目で', '空いている日に色が付きます', 'bg-accent-soft text-accent-text'],
  ['campaign', '募集と日程調整', '候補日に ◯ × で答えるだけ', 'bg-soon text-soon-text'],
  ['notifications', 'Discord に知らせる', '開催前に自動でお知らせ', 'bg-warn text-err-text'],
];

export function Home() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  useEffect(() => { document.title = '卓予定'; }, []);
  const q = new URLSearchParams(location.search);
  const say = NOTICE[q.get('login') || ''] || (q.get('deleted') === '1' ? NOTICE.deleted : null);
  return (
    <>
      <header className="flex items-center justify-between gap-12 bg-chrome px-24 py-12 text-chrome-text max-sm:px-14 max-sm:py-10">
        <div className="flex items-center gap-10 text-18 font-bold tracking-[.02em]">
          <img className="block h-36 w-36 rounded-[10px] ring-2 ring-white/90" src="/icon-192.png" alt="" width={36} height={36} />
          卓予定
        </div>
        {me.data?.loggedIn && <Who me={me.data} />}
      </header>
      <main className="mx-auto max-w-720 px-20 pt-32 pb-48 max-sm:px-14 max-sm:pt-18">
        {say && <p className={'mt-0 mb-18 flex items-start gap-8 rounded-lg border px-16 py-12 text-fg ' + TONE[say[1]][0]} id="notice"><Icon name={TONE[say[1]][1]} className="mt-1" />{say[0]}</p>}
        {me.isPending ? (
          <section className={card + ' text-muted'} id="loading">読み込んでいます…</section>
        ) : me.isError ? (
          <section className={card} id="loading">読み込めませんでした。少し待ってから開き直してください。</section>
        ) : me.data.loggedIn ? (
          <Groups me={me.data} />
        ) : (
          <Guest me={me.data} back={q.get('return_to')} />
        )}
        {/* foot は e2e が探す印 */}
        <p className="foot mt-26 mb-0 flex flex-wrap justify-center gap-x-22 gap-y-6 text-14">
          <a className={footLink} href={HELP_URL} target="_blank" rel="noopener">
            <Icon name="menu_book" size="sm" />
            使い方
          </a>
          <a className={footLink} href="/terms">利用規約</a>
          <a className={footLink} href="/privacy">プライバシーポリシー</a>
        </p>
      </main>
    </>
  );
}

const footLink = 'inline-flex items-center gap-4 font-medium text-accent-text no-underline hover:underline';

/** 右上: ログインしている人とログアウト（素の POST。サーバーがログインを消して入口へ戻す） */
function Who({ me }: { me: LoggedIn }) {
  const avatar = me.user.avatar ? 'https://cdn.discordapp.com/avatars/' + me.user.id + '/' + me.user.avatar + '.png?size=64' : '';
  return (
    <div className="flex items-center gap-10 text-14" id="who">
      {avatar
        ? <img className="h-30 w-30 rounded-full" src={avatar} alt="" />
        : <span className="grid h-30 w-30 place-items-center rounded-full bg-linear-135 from-orange to-pink text-13 font-bold text-white" aria-hidden="true">{me.user.name.slice(0, 1)}</span>}
      <span className="max-sm:hidden">{me.user.name}</span>
      <form className="m-0" method="post" action="/auth/logout">
        <button className="inline-flex h-34 cursor-pointer items-center gap-6 rounded-full border border-white/30 bg-transparent px-14 py-0 font-inherit text-13 font-medium text-inherit hover:bg-chrome-hover" type="submit">
          <Icon name="logout" size="sm" className="align-[0]" />
          ログアウト
        </button>
      </form>
    </div>
  );
}

/** ログインしていない: Discord でログイン（と、開発サーバーだけの開発用ログイン） */
function Guest({ me, back }: { me: MeResponse; back: string | null }) {
  // ログインのあとに戻れる道（src/shared/routes.ts の一覧にある画面だけ）。入口（/）へは、付けなくても戻る
  const ret = back && back !== '/' && isReturnPath(back) ? '?return_to=' + encodeURIComponent(back) : '';
  const login = '/auth/login' + ret, googleLogin = '/auth/google/login' + ret;
  /** 初めての Google アカウントで戻ってきて、Discord との結びつけを待っている */
  const linking = new URLSearchParams(location.search).get('login') === 'google-new';
  return (
    <section id="guest">
      {/* 大きな青い枠。右上にアイコンを大きく薄く置く */}
      <div className="relative mb-18 overflow-hidden rounded-lg bg-chrome px-32 pt-36 pb-30 text-white shadow-card max-sm:px-22 max-sm:pt-28 max-sm:pb-24 dark:bg-linear-140 dark:from-brand dark:to-[#1d1ba8]">
        <img className="pointer-events-none absolute -top-24 -right-28 h-190 w-190 rotate-12 rounded-[48px] opacity-22" src="/icon-192.png" alt="" />
        <h1 className="relative m-0 text-30 leading-[1.3] font-bold tracking-[.02em] max-sm:text-26">TRPG の卓の予定を、<br />Discord の仲間と。</h1>
        <p className="relative mt-12 mb-22 max-w-[34em] text-15 text-white/85">卓の登録・メンバーの予定・募集・日程調整をこの画面で行い、知らせを Discord に送ります。</p>
        {/* ログインの手段。本番は Discord。開発サーバーでは、開発用ログインも同じ場所に並べる */}
        <div className="relative flex flex-wrap items-center gap-x-14 gap-y-10">
          {me.discord && (
            <a className={heroBtn()} id="loginBtn" href={login}>
              <Icon name="login" className="align-[0]" />
              Discord でログイン
            </a>
          )}
          {/* Google はもう 1 つの入り口（初めてのときは、続けて Discord と結びつける）。初めての Google アカウントで戻ってきたときは、Discord だけを出す */}
          {me.google && !linking && (
            <a className={heroBtn(true)} id="googleLoginBtn" href={googleLogin}>
              <Icon name="login" className="align-[0]" />
              Google でログイン
            </a>
          )}
          {/* 本番の組み立てでは import.meta.env.DEV が偽になり、開発用ログインごと消える（vite.config.ts の noDevLogin が確かめる） */}
          {import.meta.env.DEV && me.dev && <DevLogin users={me.dev.users} ghost={me.discord} />}
        </div>
        {me.google && !linking && <p className="relative mt-12 mb-0 text-13 text-white/80">Google でのログインは、初めてのときだけ Discord のアカウントと結びつけます（グループに入れるかは、Discord のサーバーで決まるため）。</p>}
        <p className="relative mt-14 mb-0 text-13 text-white/80">
          ログインすると、<a className="text-white underline underline-offset-2" href="/terms">利用規約</a>と<a className="text-white underline underline-offset-2" href="/privacy">プライバシーポリシー</a>に同意したものとします。
        </p>
        {!me.discord && !me.dev && <p className="relative mt-10 mb-0 text-13 text-white/80" id="noDiscord">Discord ログインの設定がありません（DISCORD_CLIENT_ID）。</p>}
        {!me.registration && <p className="relative mt-10 mb-0 text-13 font-bold text-chrome-accent" id="closedGuest">今は新しい登録を受け付けていません。すでに使っている人は、そのままログインできます。</p>}
      </div>
      <div className="grid grid-cols-3 gap-12 max-sm:grid-cols-1">
        {FEATURES.map(([icon, title, text, tone]) => (
          <div className="rounded-md border border-line bg-card p-14 max-sm:grid max-sm:grid-cols-[40px_1fr] max-sm:items-center max-sm:gap-x-12" key={icon}>
            <span className={'mb-8 grid h-40 w-40 place-items-center rounded-[12px] max-sm:row-span-2 max-sm:mb-0 ' + tone}><Icon name={icon} className="align-[0] text-24" /></span>
            <b className="block text-14">{title}</b>
            <span className="block text-[12.5px] leading-[1.6] text-muted">{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** ログインしている: 入れるグループの一覧と、グループを作る */
function Groups({ me }: { me: LoggedIn }) {
  return (
    <>
      <section className={card} id="home">
        <div className="mb-14 flex flex-wrap items-center gap-8">
          <h2 className={h2 + ' mb-0'}>
            <Icon name="group" />
            グループ
          </h2>
          {me.operator && (
            <Link className="ml-auto inline-flex h-30 items-center gap-4 rounded-full bg-accent-soft px-12 text-13 font-bold text-accent-text no-underline hover:bg-hover" id="opLink" to="/admin/">
              <Icon name="shield" size="sm" className="align-[0]" />
              運営の管理画面
            </Link>
          )}
        </div>
        {/* groups は確かめの道具が探す印 */}
        <ul className="groups m-0 grid list-none gap-10 p-0" id="groups">
          {me.groups.map((g, i) => (
            <li key={g.id}>
              <Link className="flex items-center gap-14 rounded-md border border-line bg-card px-16 py-14 text-inherit no-underline transition-[border-color,background-color] duration-(--dur-fast) hover:border-accent-line hover:bg-hover"
                to="/g/$groupId/" params={{ groupId: g.id }}>
                <GroupTile title={g.title} index={i} />
                <span className="min-w-0">
                  <b className="block truncate text-15">{g.title}</b>
                  <small className="block truncate text-[12.5px] text-muted">{g.guildName}</small>
                </span>
                <Icon name="arrow_forward" className="ml-auto text-accent-text" />
              </Link>
            </li>
          ))}
        </ul>
        {me.groups.length === 0 && <p className={hint} id="noGroups">まだ入れるグループがありません。Discord サーバーの管理者がグループを作ると、ここに出ます。</p>}
        {me.stale && (
          <p className={hint} id="stale">
            <a className="font-medium text-accent-text" href="/auth/login?return_to=/">
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
