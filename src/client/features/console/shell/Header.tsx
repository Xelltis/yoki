// 上の帯（グループの名前・管理の札・予定の画面へ・読み込んだ時刻と更新・あなた・はじめの 3 ステップ・使い方・見た目・ログアウト）とタブ
import { Link } from '@tanstack/react-router';
import type { ConsoleData } from '../../../../shared/api';
import { HELP_URL } from '../../../app/links';
import { currentTheme, setTheme, themeStore } from '../../../app/theme';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import type { IconName } from '../../../ui/icons';
import { useStore } from '../../../ui/store';
import type { SyncView } from '../api/sync';
import { type Tab, useConsole, useMaybeData } from '../context';
import { hhmm } from '../model/dates';
import { isAdjusting, isRecruit } from '../model/model';
import { guideShown, type MainTab, useGoTab } from './nav';

const TABS: [MainTab, IconName, string][] = [
  ['cal', 'calendar_month', 'カレンダー'],
  ['recruit', 'campaign', '募集・調整'],
  ['avail', 'event_available', 'メンバーの予定'],
  ['settings', 'settings', '設定'],
];

/** 読み込んだ時刻。自動更新が止まっていれば赤い印 */
function LoadedAt({ d, v }: { d: ConsoleData | undefined; v: SyncView }) {
  if (!d) return <span className="sync-at" id="loadedAt" />;
  const title = (v.failed ? '自動更新で読み込めませんでした。通信を確かめてください。' : '') + d.loadedAt + ' に読み込みました。自動更新: ' + (v.autoMin ? v.autoMin + ' 分ごと' : 'しない');
  return (
    <span className={'sync-at' + (v.failed ? ' err' : v.autoMin ? ' live' : '')} id="loadedAt" title={title}>
      <span>{hhmm(d.loadedAt)}</span><span className="btxt"> 時点</span>
    </span>
  );
}

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
  const { sync, ui, groupId } = useConsole();
  const d = useMaybeData();
  const v = useStore(sync.view);
  const { guide } = useStore(ui);
  useStore(themeStore);
  const goTab = useGoTab();
  const logout = useLogout();
  const dark = currentTheme() === 'dark';
  const shown = d ? guideShown(d, guide) : false;
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
    <header className="appbar">
      <a className="brand" href="/" title="グループの一覧へ">
        <img className="logo" src="/icon-192.png" alt="" width={32} height={32} />
        <span id="title">{d ? d.title : '卓予定'}</span>
        <span className="area-badge">管理</span>
      </a>
      <div className="hdr-actions">
        <Link id="toMain" className="hbtn to-main" to="/g/$groupId/" params={{ groupId }} title="カレンダーなどの、ふだんの画面へ戻る">
          <Icon name="arrow_back" size="sm" /><span className="btxt">予定の画面へ</span>
        </Link>
        <span className="sync">
          <LoadedAt d={d} v={v} />
          <button type="button" id="reload" className={'hbtn' + (v.busy ? ' busy' : '')} disabled={v.busy} aria-busy={v.busy ? 'true' : 'false'} aria-label="更新" title="最新の状態を読み込む" onClick={() => { void sync.refresh('manual'); }}>
            <Icon name="refresh" size="sm" /><span className="btxt">更新</span>
          </button>
        </span>
        <span className="me"><span className="me-l">あなた</span><b className="me-name" id="me">{d ? d.me.name : ''}</b></span>
        <button type="button" id="guideBtnM" className="hbtn icon guide-m" aria-label="はじめの 3 ステップ" {...guideProps}><Icon name="flag" size="sm" /></button>
        <a id="helpLinkM" className="hbtn help-m" href={HELP_URL} target="_blank" rel="noopener" title="使い方のページを新しいタブで開く"><Icon name="help" size="sm" />使い方</a>
        <button type="button" id="theme" className="hbtn icon" title="ライト／ダークを切り替える（このブラウザだけ）" aria-label={dark ? 'ライトに切り替える' : 'ダークに切り替える'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size="sm" />
        </button>
        <button type="button" id="logoutBtn" className="hbtn icon" hidden={!d} title="ログアウト" aria-label="ログアウト" onClick={logout}><Icon name="logout" size="sm" /></button>
      </div>
      <nav className="tabs" aria-label="画面">
        {TABS.map(([key, icon, label]) => (
          <button type="button" key={key} data-tab={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => goTab(key)}>
            <Icon name={icon} /><span className="lbl">{label}</span>
            {key === 'recruit' && <span className="tcnt" id="recruitCount">{recruitCount ? String(recruitCount) : ''}</span>}
          </button>
        ))}
        <button type="button" id="guideBtn" className="tab-help" aria-label="はじめの 3 ステップ" {...guideProps}><Icon name="flag" /><span className="gl">はじめの 3 ステップ</span></button>
        <Link id="adminLink" className="tab-help admin-link" to="/g/$groupId/admin/" params={{ groupId }} hidden={!d || !d.isAdmin} title="グループの管理画面を開く（管理者だけ）">
          <Icon name="shield" /><span className="lbl">管理</span>
        </Link>
        <a id="helpLink" className="tab-help" href={HELP_URL} target="_blank" rel="noopener" title="使い方のページを新しいタブで開く">
          <Icon name="help" /><span className="lbl">使い方</span><Icon name="open_in_new" size="xs" />
        </a>
      </nav>
    </header>
  );
}
