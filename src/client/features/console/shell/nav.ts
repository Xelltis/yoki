// グループの画面の中の移り（タブ・管理の区分）と、はじめの3ステップを出すか
import { useNavigate } from '@tanstack/react-router';
import type { ConsoleData } from '../../../../shared/api';
import type { AdminPane } from '../../../../shared/routes';
import { store } from '../../../app/storage';
import type { Store } from '../../../ui/store';
import { type ConsoleUi, type Tab, useConsole } from '../context';
import { isActive } from '../model/model';

/** タブの道（カレンダーはグループの画面そのもの） */
export const TAB_TO = {
  cal: '/g/$groupId/',
  recruit: '/g/$groupId/recruit/',
  scenario: '/g/$groupId/scenario/',
  avail: '/g/$groupId/avail/',
  settings: '/g/$groupId/settings/',
} as const;
export type MainTab = keyof typeof TAB_TO;

/** タブへ移る関数 */
export function useGoTab(): (t: MainTab) => void {
  const navigate = useNavigate();
  const { groupId } = useConsole();
  return (t) => { void navigate({ to: TAB_TO[t], params: { groupId } }); };
}

/** 「募集・調整」のタブへ移る関数。卓のIDを渡すと、その卓のカードまで動かして目立たせる */
export function useGoRecruit(): (id?: string) => void {
  const navigate = useNavigate();
  const { groupId, ui } = useConsole();
  return (id) => {
    if (id) ui.set((s) => ({ ...s, focus: id }));
    // 卓のカードへ動かすときは、移ったときにページの頭へ戻さない（戻すと、動かしたあとに頭へ戻ってしまう）
    void navigate({ to: TAB_TO.recruit, params: { groupId }, resetScroll: !id });
  };
}

/** 管理の区分へ移る関数 */
export function useGoPane(): (pane: AdminPane) => void {
  const navigate = useNavigate();
  const { groupId } = useConsole();
  return (pane) => { void navigate({ to: '/g/$groupId/admin/$pane/', params: { groupId, pane } }); };
}

/** 道からタブを決める */
export function tabOf(pathname: string): Tab {
  if (/^\/g\/[^/]+\/admin\//.test(pathname)) return 'admin';
  const m = /^\/g\/[^/]+\/(recruit|scenario|avail|settings)\//.exec(pathname);
  return m ? (m[1] as Tab) : 'cal';
}

/** はじめの3ステップのうち、要るもの（仲間が入る・卓がある）が済んだか。Discordの知らせは無くても使えるので入れない */
export function setupDone(d: ConsoleData): boolean {
  return d.members.length > 1 && d.sessions.some(isActive);
}

/** はじめの3ステップを出すか。出し直したら閉じるまで出す。閉じたら出さない。それ以外は、要るものが済むまで出す */
export function guideShown(d: ConsoleData, guide: ConsoleUi['guide']): boolean {
  return guide === 'open' || (guide !== 'closed' && !setupDone(d));
}

/** はじめの3ステップを閉じたかを、この端末にグループごとに控えるキー */
export const guideClosedKey = (groupId: string) => 'guideClosed:' + groupId;

/** はじめの3ステップを閉じる。次に開いたときも出さない（ヘルプのメニューから、いつでも出し直せる） */
export function closeGuide(ui: Store<ConsoleUi>, groupId: string): void {
  store(guideClosedKey(groupId), '1');
  ui.set((s) => ({ ...s, guide: 'closed' }));
}
