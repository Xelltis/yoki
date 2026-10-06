// グループの画面の中の移り（タブ・管理の区分）と、はじめの 3 ステップを出すか
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

/** 管理の区分へ移る関数 */
export function useGoPane(): (pane: AdminPane) => void {
  const navigate = useNavigate();
  const { groupId } = useConsole();
  return (pane) => { void navigate({ to: '/g/$groupId/admin/$pane/', params: { groupId, pane } }); };
}

/** 道からタブを決める */
export function tabOf(pathname: string): Tab {
  if (/^\/g\/[^/]+\/admin\//.test(pathname)) return 'admin';
  const m = /^\/g\/[^/]+\/(recruit|avail|settings)\//.exec(pathname);
  return m ? (m[1] as Tab) : 'cal';
}

/** はじめの 3 ステップのうち、要るもの（仲間が入る・卓がある）が済んだか。Discord の知らせは無くても使えるので入れない */
export function setupDone(d: ConsoleData): boolean {
  return d.members.length > 1 && d.sessions.some(isActive);
}

/** はじめの 3 ステップを出すか。出し直したら閉じるまで出す。閉じたら出さない。それ以外は、要るものが済むまで出す */
export function guideShown(d: ConsoleData, guide: ConsoleUi['guide']): boolean {
  return guide === 'open' || (guide !== 'closed' && !setupDone(d));
}

/** はじめの 3 ステップを閉じたかを、この端末にグループごとに控えるキー */
export const guideClosedKey = (groupId: string) => 'guideClosed:' + groupId;

/** はじめの 3 ステップを閉じる。次に開いたときも出さない（ヘルプのメニューから、いつでも出し直せる） */
export function closeGuide(ui: Store<ConsoleUi>, groupId: string): void {
  store(guideClosedKey(groupId), '1');
  ui.set((s) => ({ ...s, guide: 'closed' }));
}
