// グループの画面（/g/:id/ とタブ、管理の区域 /g/:id/admin/）の外枠。上の帯・タブ・本文（道の中身）・窓・吹き出しを置く。
// データの読み書きは ConsoleSync（api/sync.ts）。データが届くまでは読み込み中の骨組みを出す
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { load, store } from '../../../app/storage';
import { watchSystemTheme } from '../../../app/theme';
import { mainArea } from '../../../ui/chrome';
import { ConfirmDialog } from '../../../ui/confirm';
import { ModalManager } from '../../../ui/Modal';
import { createStore, useStore } from '../../../ui/store';
import { TipLayer } from '../../../ui/TipLayer';
import { Toast, toast } from '../../../ui/toast';
import { rpc } from '../api/rpc';
import { ConsoleSync, domBlocked } from '../api/sync';
import { type ConsoleCtx, ConsoleContext, type ConsoleUi } from '../context';
import { parseYmd } from '../model/dates';
import { seriesNames } from '../model/model';
import { FormModal } from '../form/FormModal';
import { PollModal } from '../recruit/PollModal';
import { Header } from './Header';
import { Loading } from './Loading';
import { type MainTab, TAB_TO, tabOf } from './nav';

/** 確かめとスクリーンショットのスクリプトが使う（React の中の値は、外から見えないため） */
type YokiHook = { readonly D: ConsoleData | undefined; selectDay: (k: string) => void; showTab: (t: string) => void };

export function ConsoleLayout() {
  const { groupId } = useParams({ from: '/g/$groupId' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sync] = useState(() => new ConsoleSync(qc, groupId, {
    rpc, toast, blocked: domBlocked,
    goLogin: () => { location.href = '/auth/login?return_to=' + encodeURIComponent(location.pathname); },
  }));
  const [ui] = useState(() => createStore<ConsoleUi>({ selDay: '', view: { y: 0, m: 0 }, guide: '', guideFocus: 0, target: load('target') || '全員', form: null, poll: null }));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = tabOf(pathname), area = tab === 'admin' ? 'admin' : 'main';
  const ctx = useMemo<ConsoleCtx>(() => ({ groupId, area, sync, ui }), [groupId, area, sync, ui]);
  const view = useStore(sync.view);
  const d = useQuery({ queryKey: sync.key, queryFn: () => sync.data() as ConsoleData, enabled: false }).data;

  useEffect(() => sync.start(), [sync]);
  useEffect(() => watchSystemTheme(), []);
  // 区域とタブを body に置く（見た目の出し分けに使う）。ふだんの画面のタブは、次に開いたときのために控える
  useEffect(() => {
    document.body.setAttribute('data-area', area);
    document.body.setAttribute('data-tab', tab);
    if (area === 'main') store('tab', tab);
  }, [area, tab]);
  useEffect(() => () => { document.body.removeAttribute('data-area'); document.body.removeAttribute('data-tab'); }, []);
  useEffect(() => { if (d) document.title = d.title + ' - 卓予定'; }, [d]);
  useEffect(() => {
    const hook: YokiHook = {
      get D() { return sync.data(); },
      selectDay(k) { const p = parseYmd(k); ui.set((s) => ({ ...s, selDay: k, view: { y: p.getFullYear(), m: p.getMonth() } })); },
      showTab(t) { if (t in TAB_TO) void navigate({ to: TAB_TO[t as MainTab], params: { groupId } }); },
    };
    (window as unknown as { yoki: YokiHook }).yoki = hook;
  }, [sync, ui, navigate, groupId]);

  return (
    <ConsoleContext.Provider value={ctx}>
      <Header tab={tab} />
      <main className={mainArea(tab === 'cal' ? 'cal' : 'tabs')}>{view.phase === 'ready' && d ? <Outlet /> : <Loading view={view} sync={sync} />}</main>
      {d && (
        <>
          {/* 入力の候補（GM の名前・シリーズの名前）。候補は値だけで、名前は持たない */}
          {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
          <datalist id="memberList">{d.members.map((m) => <option key={m.name} value={m.name} />)}</datalist>
          {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
          <datalist id="seriesList">{seriesNames(d).map((n) => <option key={n} value={n} />)}</datalist>
          <FormModal />
          <PollModal />
        </>
      )}
      <ConfirmDialog />
      <TipLayer />
      <ModalManager />
      <Toast />
    </ConsoleContext.Provider>
  );
}
