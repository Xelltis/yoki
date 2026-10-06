// 運営者の管理画面の形（Tailwindのクラス）

/** 項目と値を2列に並べる（狭い画面では縦に） */
export const dl = 'mt-8 mb-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-16 gap-y-4 text-13 max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-0';
export const dt = 'text-muted';
export const dd = 'm-0 max-sm:mb-8';
/** IDや小さな補足（名前の下に出す） */
export const id = 'block text-11 text-muted tabular-nums';
/** 札（管理者・運営者・締め出し中）。badは赤 */
export const chip = (bad?: boolean) => 'inline-block rounded-full px-7 align-[1px] text-11 leading-[18px] font-bold ' + (bad ? 'bg-warn text-err-text' : 'bg-accent-soft text-accent-text');
/** 様子の札（ok・warn・bad） */
export const state = (s: string) => 'mt-6 mb-10 rounded-md px-12 py-8 font-semibold ' + (s === 'ok' ? 'bg-ok text-ok-text' : s === 'warn' ? 'bg-soon text-soon-text' : 'bg-warn text-err-text');
