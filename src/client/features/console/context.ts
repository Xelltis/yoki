// グループの画面の中で共有するもの（グループの ID・区域・データの読み書き・画面の状態）
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ConsoleData } from '../../../shared/api';
import type { Store } from '../../ui/store';
import type { ConsoleSync } from './api/sync';

/** 区域。/g/:id/ はふだんの画面、/g/:id/admin/ はグループの管理画面 */
export type Area = 'main' | 'admin';
/** タブ。ふだんの画面はカレンダー・募集・調整・メンバーの予定・設定、管理画面は管理の 1 枚 */
export type Tab = 'cal' | 'recruit' | 'avail' | 'settings' | 'admin';

/**
 * 卓の登録の窓を開く頼み。id は変える卓、cont はその卓の設定を引き継いで翌日の卓を登録する、
 * date・status・series は新しく登録するときの初めの値（series を選ぶと直前の回から引き継ぐ。status は変える卓にも当てる）。
 * focus は、開いたときに入る欄（無ければ卓の名前）
 */
export type FormReq = { id?: string; cont?: string; date?: string; status?: string; series?: string; focus?: 'date' };

/** 画面の状態（サーバーには送らない） */
export type ConsoleUi = {
  /** カレンダーで選んでいる日（YYYY-MM-DD）。選んでいなければ空 */
  selDay: string;
  /** カレンダーで見ている月（m は 0 から）。y が 0 なら今日の月 */
  view: { y: number; m: number };
  /** はじめの 3 ステップ。'' はメンバーと卓がそろうまで出す、'open' は出し直した、'closed' は閉じた（この画面を開いているあいだは出さない） */
  guide: '' | 'open' | 'closed';
  /** はじめの 3 ステップを出し直した回数（出し直したら、そこへフォーカスを移す） */
  guideFocus: number;
  /** 都合を見る卓（カレンダーの色と日の内訳）。「全員」「（なし）」か卓の名前。この端末に控える */
  target: string;
  /** 卓の登録の窓（開く頼みと、頼んだ回数。同じ頼みでも開き直す） */
  form: { seq: number; req: FormReq } | null;
  /** 候補日を選ぶ窓（日程調整を始める・選び直す卓） */
  poll: { seq: number; id: string } | null;
};

export type ConsoleCtx = { groupId: string; area: Area; sync: ConsoleSync; ui: Store<ConsoleUi> };

export const ConsoleContext = createContext<ConsoleCtx | null>(null);

export function useConsole(): ConsoleCtx {
  const c = useContext(ConsoleContext);
  if (!c) throw new Error('グループの画面の外では使えません');
  return c;
}

/** 画面のデータ。読み込む前は undefined */
export function useMaybeData(): ConsoleData | undefined {
  const { sync } = useConsole();
  // 読み込みは sync が決めるので、ここでは入れ物を見るだけ（自分では読まない）
  return useQuery({ queryKey: sync.key, queryFn: () => sync.data() as ConsoleData, enabled: false }).data;
}

/** 画面のデータ。外枠（ConsoleLayout）は、データがあるときだけ中を描くので、中の部品ではいつもある */
export function useData(): ConsoleData {
  return useMaybeData()!;
}
