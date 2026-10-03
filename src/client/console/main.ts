// グループの画面（/g/:id/）の入口。各部分の初期化（イベントの登録）を順に呼び、控えを描いてから最新を読む。
// 各ファイルは関数と定数だけを持ち、読み込んだときには何もしない（ファイルどうしが互いを呼んでも、読み込みの順で壊れないように）
import { init as initAvail } from './avail';
import { init as initAvailInput } from './avail-input';
import { init as initCalendar, renderIconLegend, selectDay } from './calendar';
import { init as initDay } from './day';
import { init as initForm } from './form';
import { init as initHeader } from './header';
import { init as initLoad, paintFromCache, reload } from './load';
import { init as initMembers } from './members';
import { init as initModal } from './modal';
import { init as initNotices } from './notices';
import { init as initOps } from './ops';
import { init as initPoll } from './poll';
import { init as initPromote } from './promote';
import { init as initRecruit } from './recruit';
import { init as initSeriesNotify } from './series-notify';
import { init as initSettings } from './settings';
import { init as initSetup } from './setup';
import { D } from './state';
import { init as initTabs, showTab } from './tabs';
import { init as initTheme } from './theme';
import { init as initTips } from './tips';

declare global {
  interface Window {
    /** スクリーンショットと確認のスクリプトが使う（ES モジュールなので、中の変数は外から見えない） */
    yoki: { readonly D: typeof D; selectDay: typeof selectDay; showTab: typeof showTab };
  }
}

initTips(); initModal(); initHeader(); initTabs(); initTheme(); initSetup(); initNotices(); initCalendar(); initDay();
initRecruit(); initPoll(); initOps(); initAvail(); initAvailInput(); initForm(); initPromote(); initMembers(); initSettings(); initSeriesNotify(); initLoad();

window.yoki = { get D() { return D; }, selectDay, showTab };
paintFromCache();
renderIconLegend();
reload(false);
