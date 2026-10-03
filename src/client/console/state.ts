// 画面の中で共有する状態。書き換えは、ここの set〜 を通す（ほかのファイルからは読むだけ）
import type { ConsoleData } from '../../shared/api';

/** 画面のデータ。読み込む前は null（描く関数は、読み込んだあとにだけ呼ぶ） */
export let D = null as unknown as ConsoleData;
export function setD(d: ConsoleData): void { D = d; }

/** カレンダーで見ている月（m は 0 から） */
export const view = { y: 0, m: 0 };

/** カレンダーで選んでいる日（YYYY-MM-DD）。選んでいなければ空 */
export let selDay = '';
export function setSelDay(k: string): void { selDay = k; }

/** 読み込みの最中の印 */
export type Inflight = { mode: 'boot' | 'manual' | 'auto'; manual: boolean; epoch: number; t0: number };
/** 読み込みと書き込みの状態 */
export const sync = {
  inflight: null as Inflight | null,
  /** 返事待ちの書き込みの数 */
  pending: 0,
  /** 書き込みを始めるたびに進める。読んでいるあいだに書き込みが始まったかを見る */
  epoch: 0,
  /** 最後に描いたデータの印（変わったかを比べる） */
  sig: '',
  last: 0,
  failed: false,
  /** 描くのを見送ったデータがある（書き込みの返事のあとで読み直す） */
  stale: false,
};

/** 保存前の書きかけ。読み込み直しても上書きしない */
export const drafts = { member: false, settings: false };
