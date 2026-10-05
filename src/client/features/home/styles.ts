// 入口の部品の見た目（Tailwind のクラス）

/** カード */
export const card = 'mb-18 rounded-lg border border-line bg-card px-26 py-24 shadow-card max-sm:px-20 max-sm:py-20';
/** 見出し（アイコンと並べる） */
export const h2 = 'm-0 mb-14 flex items-center gap-8 text-18 font-bold [&>.ic]:text-accent-text';
/** 小さな説明 */
export const hint = 'my-8 text-13 text-muted';
/** 大きなボタン（入口の大事な操作） */
export const bigBtn = 'inline-flex h-44 cursor-pointer items-center justify-center gap-8 rounded-full border px-20 py-0 font-inherit text-15 font-bold no-underline transition-[background-color,transform] duration-(--dur-fast) ease-out active:scale-[.97] disabled:cursor-default disabled:opacity-60 ';
export const btnPrimary = bigBtn + 'border-primary bg-primary text-primary-ink hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--text))]';
export const btn = bigBtn + 'border-line bg-card text-fg hover:bg-hover';
/** 欄の名前（上に名前、下に欄） */
export const label = 'm-0 grid flex-[1_1_220px] gap-6 text-13 font-bold';
/** 入力欄と選ぶ欄 */
export const field = 'h-44 w-full rounded-md font-normal';
/** 横に並べる行 */
export const row = 'mt-12 mb-16 flex flex-wrap items-end gap-12';
/** 青い枠の中のログインのボタン（白い地に青い字。押すと少し浮く）。ghost は枠線だけ（主役のボタンが別にあるとき） */
export function heroBtn(ghost = false): string {
  return 'relative inline-flex h-46 cursor-pointer items-center gap-8 rounded-full px-22 font-inherit text-15 font-bold no-underline transition-transform duration-(--dur-fast) hover:-translate-y-1 '
    + (ghost ? 'border border-white/60 bg-transparent text-white' : 'border-0 bg-white text-brand shadow-[0_6px_18px_rgba(0,0,0,.18)]');
}
/** 青い枠の中の選ぶ欄（ボタンと同じ白い丸い形） */
export const heroField = 'h-46 min-h-46 w-auto rounded-full border-0 bg-white pr-36 pl-18 font-inherit text-15 font-semibold text-brand';
