// 上の帯（グループの名前・管理の札・予定の画面へ・読み込んだ時刻と更新・あなた・はじめの 3 ステップ・使い方・見た目・ログアウト）とタブ
import { Link } from '@tanstack/react-router';
import type { ConsoleData } from '../../../../shared/api';
import { HELP_URL } from '../../../app/links';
import { currentTheme, setTheme, themeStore } from '../../../app/theme';
import { actions, appbar, areaBadge, brand, btxt, hbtn, hbtnIcon, logo } from '../../../ui/chrome';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import type { IconName } from '../../../ui/icons';
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
  ['settings', 'settings', '設定'],
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
      <span>{hhmm(d.loadedAt)}</span><span className={btxt}> 時点</span>
    </span>
  );
}

/** タブ。スマホでは下に並べ、アイコンの上に丸い印を出す */
const tabBtn = 'relative inline-flex flex-[0_0_auto] cursor-pointer items-center gap-6 whitespace-nowrap rounded-full border-0 h-36 px-14 py-0 font-inherit font-semibold '
  + 'transition-[background-color,color] duration-(--dur-fast) ease-out '
  + 'max-sm:h-auto max-sm:min-w-0 max-sm:flex-col max-sm:gap-2 max-sm:rounded-none max-sm:px-2 max-sm:pt-4 max-sm:pb-0 max-sm:text-[clamp(10px,2.5vw,12px)] max-sm:bg-transparent! '
  + 'max-sm:before:absolute max-sm:before:top-0 max-sm:before:left-1/2 max-sm:before:-ml-28 max-sm:before:h-30 max-sm:before:w-56 max-sm:before:rounded-[15px] max-sm:before:content-[""] '
  + 'max-sm:before:transition-[background-color] max-sm:before:duration-(--dur-fast) max-sm:before:ease-out ';
/** タブの並びの続き（はじめの 3 ステップ・管理・使い方）。スマホでは隠す（上の帯のボタンに替える） */
const tabHelp = 'ml-6 inline-flex h-36 items-center gap-6 whitespace-nowrap rounded-full border border-chrome-field-line px-14 py-0 font-semibold text-chrome-text no-underline '
  + 'transition-[background-color] duration-(--dur-fast) ease-out hover:bg-chrome-hover max-sm:hidden! ';
/** 押してある（出している）ときのアイコン（塗りつぶす） */
const filled = '[font-variation-settings:"FILL"_1]';

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
  /** 3 つとも済んだら、上の帯の「はじめの 3 ステップ」はアイコンだけにする（目立たせる要がない） */
  const allDone = !!d && d.members.length > 0 && d.sessions.some(isActive) && !!d.channelSet;
  /** グループが消された・ログインし直せなかった。タブと、はじめの 3 ステップは出さない（移る先が無い） */
  const dead = v.phase === 'gone' || v.phase === 'relogin';
  const recruitCount = d ? d.sessions.filter((s) => isRecruit(s) || isAdjusting(s)).length : 0;
  /* 「はじめの 3 ステップ」ボタン。カレンダーで出ていれば閉じ、それ以外は出す（押すたびに切り替わる）。出したら、ページの頭まで戻す */
  const toggleGuide = () => {
    if (tab === 'cal' && shown) { ui.set((s) => ({ ...s, guide: 'closed' })); return; }
    ui.set((s) => ({ ...s, guide: 'open', guideFocus: s.guideFocus + 1 }));
    goTab('cal');
    window.scrollTo(0, 0);
  };
  const guideProps = {
    'aria-controls': 'setupGuide',
    'aria-expanded': shown,
    title: shown ? 'はじめの 3 ステップを閉じる' : 'はじめの 3 ステップをカレンダーの上に出す',
    onClick: toggleGuide,
  };
  return (
    <header className={appbar}>
      <Link className={brand} to="/" title="グループの一覧へ">
        <img className={logo} src="/icon-192.png" alt="" width={32} height={32} />
        <span className="min-w-0 truncate max-sm:text-14" id="title">{d ? d.title : '卓予定'}</span>
        <span className={areaBadge + (admin ? ' inline-block' : ' hidden')}>管理</span>
      </Link>
      <div className={actions}>
        <Link id="toMain" className={hbtn(admin ? 'inline-flex' : 'hidden')} to="/g/$groupId/" params={{ groupId }} title="カレンダーなどの、ふだんの画面へ戻る">
          <Icon name="arrow_back" size="sm" className={hbtnIcon} /><span className={btxt}>予定の画面へ</span>
        </Link>
        <span className="mr-4 inline-flex items-center gap-2 max-sm:mr-0">
          <LoadedAt d={d} v={v} />
          <button type="button" id="reload" className={hbtn() + ' max-sm:w-(--h-control) max-sm:p-0'} disabled={v.busy} aria-busy={v.busy ? 'true' : 'false'} aria-label="更新" title="最新の状態を読み込む" onClick={() => { void sync.refresh('manual'); }}>
            <Icon name="refresh" size="sm" className={hbtnIcon + (v.busy ? ' animate-spin' : '')} /><span className={btxt}>更新</span>
          </button>
        </span>
        {/* あなたの名前。読み込むまでは出さない（「あなた」だけが残らないように） */}
        <span className="mx-4 flex items-center gap-6 text-12 text-chrome-muted max-sm:mx-2" hidden={!d}>
          <span className="max-sm:absolute max-sm:h-1 max-sm:w-1 max-sm:overflow-hidden max-sm:whitespace-nowrap max-sm:[clip:rect(0_0_0_0)]">あなた</span>
          <b className="max-w-[12em] truncate text-14 font-semibold text-chrome-text max-sm:max-w-[6em]" id="me">{d ? d.me.name : ''}</b>
        </span>
        <button type="button" id="guideBtnM" className={hbtn(admin || dead ? 'hidden' : 'hidden max-sm:inline-flex', true) + ' max-sm:border-chrome-field-line max-sm:aria-expanded:border-chrome-active max-sm:aria-expanded:bg-chrome-active'} aria-label="はじめの 3 ステップ" {...guideProps}>
          <Icon name="flag" size="sm" className={hbtnIcon + (shown ? ' text-chrome-active-ink ' + filled : ' max-sm:text-chrome-accent')} />
        </button>
        {/* スマホではアイコンだけ（グループの名前の場所を残す）。隣の「はじめの 3 ステップ」と同じ丸いボタン */}
        <a id="helpLinkM" className={hbtn(admin ? 'hidden' : 'hidden max-sm:inline-flex', true) + ' max-sm:border-chrome-field-line'} href={HELP_URL} target="_blank" rel="noopener" title="使い方のページを新しいタブで開く" aria-label="使い方（新しいタブで開く）">
          <Icon name="help" size="sm" className={hbtnIcon + ' max-sm:text-chrome-accent'} />
        </a>
        <button type="button" id="theme" className={hbtn('inline-flex', true) + ' ' + btxt} title="ライト／ダークを切り替える（このブラウザだけ）" aria-label={dark ? 'ライトに切り替える' : 'ダークに切り替える'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size="sm" className={hbtnIcon} />
        </button>
        <button type="button" id="logoutBtn" className={hbtn('inline-flex', true) + ' ' + btxt} hidden={!d} title="ログアウト" aria-label="ログアウト" onClick={logout}><Icon name="logout" size="sm" className={hbtnIcon} /></button>
      </div>
      {/* tabs は e2e が探す印。管理画面と、グループが消された・ログインし直せなかったときは出さない */}
      <nav className={'tabs -mx-6 min-w-0 items-center gap-2 overflow-x-auto px-6 [grid-area:tabs] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden '
        + (admin || dead ? 'hidden! ' : 'flex ')
        + 'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-(--z-appbar) max-sm:m-0 max-sm:grid max-sm:grid-cols-5 max-sm:gap-0 max-sm:overflow-visible max-sm:border-t max-sm:border-chrome-line max-sm:bg-chrome '
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
        <button type="button" id="guideBtn" className={tabHelp + 'relative flex-[0_0_auto] cursor-pointer bg-transparent font-inherit aria-expanded:border-chrome-active aria-expanded:bg-chrome-active aria-expanded:text-chrome-active-ink max-xl:px-11'} aria-label="はじめの 3 ステップ" {...guideProps}>
          <Icon name="flag" className={shown ? 'text-chrome-active-ink ' + filled : 'text-chrome-accent'} /><span className={allDone ? 'hidden' : 'max-xl:hidden'}>はじめの 3 ステップ</span>
        </button>
        <Link id="adminLink" className={tabHelp} to="/g/$groupId/admin/" params={{ groupId }} hidden={!d || !d.isAdmin} title="グループの管理画面を開く（管理者だけ）">
          <Icon name="shield" className="text-chrome-accent" /><span>管理</span>
        </Link>
        <a id="helpLink" className={tabHelp} href={HELP_URL} target="_blank" rel="noopener" title="使い方のページを新しいタブで開く">
          <Icon name="help" className="text-chrome-accent" /><span>使い方</span><Icon name="open_in_new" size="xs" className="text-chrome-muted" />
        </a>
      </nav>
    </header>
  );
}
