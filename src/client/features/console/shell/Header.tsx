// 上の帯とタブ。左はグループの名前（押すと、入れるグループに切り替えられる）、真ん中はふだんの 3 画面のタブ。
// 右は、更新・ヘルプ（はじめの 3 ステップ・使い方）・管理（管理者だけ）・あなた（設定・見た目・ログアウト）
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ConsoleData } from '../../../../shared/api';
import { HELP_URL } from '../../../app/links';
import { fetchMe, ME_KEY } from '../../../app/me';
import { currentTheme, setTheme, themeStore } from '../../../app/theme';
import { actions, appbar, areaBadge, brand, btxt, hbtn, hbtnIcon, logo, menuHead, menuItem, menuItemTall, menuSep } from '../../../ui/chrome';
import { GroupTile } from '../../../ui/GroupTile';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import type { IconName } from '../../../ui/icons';
import { Menu } from '../../../ui/Menu';
import { useStore } from '../../../ui/store';
import type { SyncView } from '../api/sync';
import { type Tab, useConsole, useMaybeData } from '../context';
import { hhmm } from '../model/dates';
import { isActive, isAdjusting, isRecruit } from '../model/model';
import { guideShown, type MainTab, useGoTab } from './nav';

const TABS: [MainTab, IconName, string][] = [
  ['cal', 'calendar_month', 'カレンダー'],
  ['recruit', 'campaign', '募集・調整'],
  ['avail', 'event_available', 'メンバーの予定'],
];

/** 読み込んだ時刻の見た目。前の丸は、自動更新しているあいだは緑、読めなかったら赤。狭い画面では丸だけ */
const loadedAt = 'inline-flex items-center gap-6 whitespace-nowrap pl-4 text-12 text-chrome-muted tabular-nums before:h-7 before:w-7 before:rounded-[50%] before:content-[""] max-xs:gap-0 max-xs:text-[0px] ';

/** 読み込んだ時刻。自動更新が止まっていれば赤い印 */
function LoadedAt({ d, v }: { d: ConsoleData | undefined; v: SyncView }) {
  if (!d) return <span className={loadedAt + 'before:bg-live-off'} id="loadedAt" />;
  const title = (v.failed ? '自動更新で読み込めませんでした。通信を確かめてください。' : '') + d.loadedAt + ' に読み込みました。自動更新: ' + (v.autoMin ? v.autoMin + ' 分ごと' : 'しない');
  const dot = v.failed ? 'before:bg-live-err' : v.autoMin ? 'before:bg-live before:shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_22%,transparent)]' : 'before:bg-live-off';
  return (
    <span className={loadedAt + dot} id="loadedAt" title={title}>
      <span>{hhmm(d.loadedAt)}</span><span className={btxtRow}> 時点</span>
    </span>
  );
}

/** タブ。スマホでは下に並べ、アイコンの上に丸い印を出す */
const tabBtn = 'relative inline-flex flex-[0_0_auto] cursor-pointer items-center gap-6 whitespace-nowrap rounded-full border-0 h-36 px-14 py-0 font-inherit font-semibold '
  + 'transition-[background-color,color] duration-(--dur-fast) ease-out '
  + 'max-sm:h-auto max-sm:min-w-0 max-sm:flex-col max-sm:gap-2 max-sm:rounded-none max-sm:px-2 max-sm:pt-4 max-sm:pb-0 max-sm:text-[clamp(10px,2.5vw,12px)] max-sm:bg-transparent! '
  + 'max-sm:before:absolute max-sm:before:top-0 max-sm:before:left-1/2 max-sm:before:-ml-28 max-sm:before:h-30 max-sm:before:w-56 max-sm:before:rounded-[15px] max-sm:before:content-[""] '
  + 'max-sm:before:transition-[background-color] max-sm:before:duration-(--dur-fast) max-sm:before:ease-out ';
/** 押してある（出している）ときのアイコン（塗りつぶす） */
const filled = '[font-variation-settings:"FILL"_1]';
/** 帯が 1 段になるうち、狭い幅（901〜1200px）では、右の操作の字を隠してアイコンだけにする（タブとグループの名前の場所を残す） */
const btxtRow = btxt + ' lg:max-2xl:hidden!';
/** その幅で、字を隠したボタンを丸くする */
const iconRow = ' lg:max-2xl:w-(--h-control) lg:max-2xl:p-0';

/** ログアウト。この端末の控えを消し、サーバーのログインを消して、入口へ戻る（素の POST） */
export function useLogout(): () => void {
  const { sync } = useConsole();
  return () => askConfirm({ title: 'ログアウトしますか？', message: 'このブラウザのログインを消します。次に開くときは、また Discord でログインします。', ok: 'ログアウト', danger: true }, () => {
    sync.forget();
    const f = document.createElement('form');
    f.method = 'post'; f.action = '/auth/logout';
    document.body.appendChild(f); f.submit();
  });
}

/** グループの名前のボタン（押すとグループの切り替え）。名前が長ければ切る */
const brandBtn = 'min-w-0 max-w-full cursor-pointer rounded-full border-0 bg-transparent py-2 pr-8 pl-2 text-left font-inherit '
  + 'transition-[background-color] duration-(--dur-fast) ease-out hover:bg-chrome-hover aria-expanded:bg-chrome-hover';

export function Header({ tab }: { tab: Tab }) {
  const { sync, ui, groupId, area } = useConsole();
  const admin = area === 'admin';
  const d = useMaybeData();
  const v = useStore(sync.view);
  const { guide } = useStore(ui);
  useStore(themeStore);
  const goTab = useGoTab();
  const logout = useLogout();
  const dark = currentTheme() === 'dark';
  const shown = d ? guideShown(d, guide) : false;
  /** グループが消された・ログインし直せなかった。タブ・はじめの 3 ステップ・設定は出さない（移る先が無い） */
  const dead = v.phase === 'gone' || v.phase === 'relogin';
  /** はじめの 3 ステップを出せるのは、ふだんの区域でグループが読めているときだけ */
  const guideOk = !!d && !admin && !dead;
  /** 3 つとも済むまでは、？に印を付けて、はじめの 3 ステップがあることを知らせる */
  const allDone = !!d && d.members.length > 0 && d.sessions.some(isActive) && !!d.channelSet;
  const nudge = guideOk && !allDone;
  const recruitCount = d ? d.sessions.filter((s) => isRecruit(s) || isAdjusting(s)).length : 0;
  /** 入れるグループ（入口と同じ控え）。メニューを開くたびに読み直す（ほかのタブで作ったグループも出す）。消えたグループは、切り替え先に出さない */
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000 });
  const groups = me.data && me.data.loggedIn ? me.data.groups : [];
  /* はじめの 3 ステップ。カレンダーで出ていれば閉じ、それ以外は出す（押すたびに切り替わる）。出したら、ページの頭まで戻す */
  const toggleGuide = () => {
    if (tab === 'cal' && shown) { ui.set((s) => ({ ...s, guide: 'closed' })); return; }
    ui.set((s) => ({ ...s, guide: 'open', guideFocus: s.guideFocus + 1 }));
    goTab('cal');
    window.scrollTo(0, 0);
  };
  return (
    <header className={appbar}>
      {/* グループの名前。押すと、入れるグループが Discord のサーバーの一覧のように頭文字の札つきで並び、切り替えられる */}
      <Menu id="groupMenu" buttonId="groupMenuBtn" className="relative flex min-w-0 [grid-area:brand]" buttonClass={brand + ' ' + brandBtn} align="start"
        label={(d ? d.title : 'グループ') + '（グループを切り替える）'} title="グループを切り替える" onOpen={() => { void me.refetch(); }}
        button={<>
          <img className={logo} src="/icon-192.png" alt="" width={32} height={32} />
          <span className="min-w-0 truncate max-sm:text-14" id="title">{d ? d.title : ''}</span>
          <span className={areaBadge + (admin ? ' inline-block' : ' hidden')}>管理</span>
          <Icon name="expand_more" size="sm" className="shrink-0 text-chrome-muted" />
        </>}>
        <p className={menuHead}>グループ</p>
        {groups.map((g, i) => (dead && g.id === groupId) ? null : (
          <Link key={g.id} role="menuitem" className={menuItemTall} data-group={g.id} to="/g/$groupId/" params={{ groupId: g.id }} aria-current={g.id === groupId ? 'page' : undefined}>
            <GroupTile title={g.title} index={i} size="sm" />
            <span className="min-w-0 flex-1">
              <b className="block truncate">{g.title}</b>
              <small className="block truncate text-12 font-normal text-muted">{g.guildName}</small>
            </span>
            {g.id === groupId && <Icon name="check" size="sm" className="text-accent-text" />}
          </Link>
        ))}
        {me.isPending && <p className={menuHead}>読み込んでいます…</p>}
        {me.isError && <p className={menuHead}>グループの一覧を読み込めませんでした。</p>}
        <div className={menuSep} aria-hidden="true" />
        <Link role="menuitem" id="toGroups" className={menuItem} to="/"><Icon name="group" size="sm" />グループの一覧・新しく作る</Link>
      </Menu>
      <div className={actions}>
        <Link id="toMain" className={hbtn(admin ? 'inline-flex' : 'hidden')} to="/g/$groupId/" params={{ groupId }} title="カレンダーなどの、ふだんの画面へ戻る">
          <Icon name="arrow_back" size="sm" className={hbtnIcon} /><span className={btxt}>予定の画面へ</span>
        </Link>
        {/* スマホの管理画面は、グループ名と「管理」の札の場所を残すため、読み込んだ時刻の印とヘルプを出さない */}
        <span className="mr-4 inline-flex items-center gap-2 max-sm:mr-0">
          <span className={admin ? 'contents max-sm:hidden' : 'contents'}><LoadedAt d={d} v={v} /></span>
          <button type="button" id="reload" className={hbtn() + ' max-sm:w-(--h-control) max-sm:p-0' + iconRow} disabled={v.busy} aria-busy={v.busy ? 'true' : 'false'} aria-label="更新" title="最新の状態を読み込む" onClick={() => { void sync.refresh('manual'); }}>
            <Icon name="refresh" size="sm" className={hbtnIcon + (v.busy ? ' animate-spin' : '')} /><span className={btxtRow}>更新</span>
          </button>
        </span>
        {/* 手引き: はじめの 3 ステップ・使い方。済んでいない準備があるあいだは、印を付ける */}
        <Menu id="helpMenu" buttonId="helpBtn" className={'relative inline-flex' + (admin ? ' max-sm:hidden' : '')} buttonClass={hbtn() + ' relative max-sm:w-(--h-control) max-sm:p-0' + iconRow}
          label={nudge ? 'ヘルプ（はじめの 3 ステップが残っています）' : 'ヘルプ'} title={nudge ? 'はじめの 3 ステップ・使い方（済んでいない準備があります）' : 'はじめの 3 ステップ・使い方'}
          button={<>
            <Icon name="help" size="sm" className={hbtnIcon} /><span className={btxtRow}>ヘルプ</span>
            <span className={'absolute top-4 right-4 h-8 w-8 rounded-full bg-chrome-accent ' + (nudge ? 'block' : 'hidden')} id="helpNudge" />
          </>}>
          <button type="button" role="menuitem" id="guideBtn" className={menuItem} hidden={!guideOk} aria-controls="setupGuide" onClick={toggleGuide}>
            <Icon name="flag" size="sm" className="text-accent-text" />{tab === 'cal' && shown ? 'はじめの 3 ステップを閉じる' : 'はじめの 3 ステップ'}
          </button>
          <a role="menuitem" id="helpLink" className={menuItem} href={HELP_URL} target="_blank" rel="noopener">
            <Icon name="menu_book" size="sm" />使い方<Icon name="open_in_new" size="xs" className="ml-auto text-muted" />
          </a>
        </Menu>
        {/* グループの管理画面への入口（管理者だけ）。管理画面の中では出さず、「予定の画面へ」で戻る */}
        <Link id="adminLink" className={hbtn(d && d.isAdmin && !admin && !dead ? 'inline-flex' : 'hidden') + ' max-sm:w-(--h-control) max-sm:p-0' + iconRow}
          to="/g/$groupId/admin/" params={{ groupId }} title="グループの管理画面を開く（管理者だけ）" aria-label="管理">
          <Icon name="shield" size="sm" className={hbtnIcon} /><span className={btxtRow}>管理</span>
        </Link>
        {/* あなたのこと: 設定（名前・この端末）・見た目・ログアウト。設定を開いているあいだは、押してある見た目 */}
        <Menu id="meMenu" buttonId="meBtn" active={tab === 'settings'}
          buttonClass={hbtn() + ' gap-6 max-sm:px-8 data-active:bg-chrome-active data-active:text-chrome-active-ink'}
          label={d ? 'あなた（' + d.me.name + '）のメニュー' : 'あなたのメニュー'} title="設定・見た目・ログアウト"
          button={<>
            <Icon name="person" size="sm" className={hbtnIcon + ' sm:hidden'} />
            <span className="text-12 font-normal opacity-80 max-sm:hidden lg:max-2xl:hidden">あなた</span>
            <b className="max-w-[12em] truncate text-14 font-semibold max-sm:max-w-[6em]" id="me" hidden={!d}>{d ? d.me.name : ''}</b>
            <Icon name="expand_more" size="sm" className={hbtnIcon + ' opacity-80 max-sm:hidden'} />
          </>}>
          <button type="button" role="menuitem" id="toSettings" className={menuItem} hidden={dead} onClick={() => goTab('settings')}>
            <Icon name="settings" size="sm" />設定（名前・この端末）
          </button>
          <button type="button" role="menuitem" id="theme" className={menuItem} title="このブラウザだけ" onClick={() => setTheme(dark ? 'light' : 'dark')}>
            <Icon name={dark ? 'light_mode' : 'dark_mode'} size="sm" />{dark ? 'ライトにする' : 'ダークにする'}
          </button>
          <div className={menuSep} hidden={!d} aria-hidden="true" />
          <button type="button" role="menuitem" id="logoutBtn" className={menuItem} hidden={!d} onClick={logout}>
            <Icon name="logout" size="sm" />ログアウト
          </button>
        </Menu>
      </div>
      {/* tabs は e2e が探す印。管理画面と、グループが消された・ログインし直せなかったときは出さない */}
      <nav className={'tabs -mx-6 min-w-0 items-center gap-2 overflow-x-auto px-6 [grid-area:tabs] max-lg:mt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden '
        + (admin || dead ? 'hidden! ' : 'flex ')
        + 'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-(--z-appbar) max-sm:m-0 max-sm:grid max-sm:grid-cols-3 max-sm:gap-0 max-sm:overflow-visible max-sm:border-t max-sm:border-chrome-line max-sm:bg-chrome '
        + 'max-sm:pt-6 max-sm:pr-[max(4px,env(safe-area-inset-right))] max-sm:pb-[max(8px,env(safe-area-inset-bottom))] max-sm:pl-[max(4px,env(safe-area-inset-left))]'} aria-label="画面">
        {TABS.map(([key, icon, label]) => (
          <button type="button" key={key} data-tab={key} className={tabBtn + (tab === key ? 'bg-chrome-active text-chrome-active-ink max-sm:text-chrome-text max-sm:before:bg-chrome-active' : 'bg-transparent text-chrome-muted hover:bg-chrome-hover hover:text-chrome-text max-sm:before:bg-transparent')} aria-current={tab === key ? 'page' : undefined} onClick={() => goTab(key)}>
            <Icon name={icon} className={'max-sm:relative max-sm:text-22 max-sm:align-[0]' + (tab === key ? ' text-chrome-active-ink ' + filled : '')} /><span className="max-sm:max-w-full max-sm:overflow-hidden max-sm:text-ellipsis">{label}</span>
            {key === 'recruit' && (
              <span className="h-18 min-w-18 rounded-[9px] bg-chrome-accent px-5 text-center text-11 leading-[18px] font-bold text-chrome-accent-ink empty:hidden max-sm:absolute max-sm:-top-2 max-sm:left-[calc(50%+8px)] max-sm:h-16 max-sm:min-w-16 max-sm:px-4 max-sm:text-10 max-sm:leading-[16px]" id="recruitCount">
                {recruitCount ? String(recruitCount) : ''}
              </span>
            )}
          </button>
        ))}
      </nav>
    </header>
  );
}
