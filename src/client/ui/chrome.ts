// 上の帯（グループの画面と運営の管理画面）の見た目（Tailwind のクラス）。PC は 2 段（名前と操作／タブ）、スマホは 1 段でタブは下に固定

/** 帯そのもの。中の :focus-visible の枠は水色 */
export const appbar = 'sticky top-0 z-(--z-appbar) grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-16 gap-y-6 border-b border-chrome-line bg-chrome pt-10 pb-8 '
  + 'pr-[max(20px,env(safe-area-inset-right))] pl-[max(20px,env(safe-area-inset-left))] text-chrome-text [grid-template-areas:"brand_actions"_"tabs_tabs"] [&_:focus-visible]:outline-chrome-accent '
  + 'max-sm:min-h-56 max-sm:gap-8 max-sm:py-8 max-sm:pr-[max(12px,env(safe-area-inset-right))] max-sm:pl-[max(12px,env(safe-area-inset-left))] max-sm:[grid-template-areas:"brand_actions"]';
/** 左の名前（ロゴと題） */
export const brand = 'flex min-w-0 items-center gap-10 text-15 font-bold text-inherit no-underline [grid-area:brand]';
/** ロゴ（青い帯の上でも形がわかるように、白い縁を付ける） */
export const logo = 'block h-32 w-32 shrink-0 rounded-[9px] ring-2 ring-white/90 max-sm:h-30 max-sm:w-30';
/** 区域の札（管理・運営） */
export const areaBadge = 'ml-8 flex-none whitespace-nowrap rounded-full bg-chrome-accent px-8 py-1 text-12 leading-[18px] font-bold text-chrome-accent-ink';
/** 右の操作の並び */
export const actions = 'flex items-center gap-4 [grid-area:actions] max-sm:gap-2';
/** 帯のボタン。display は渡す（場面で出し分けるため）。icon はアイコンだけの四角いボタン */
export function hbtn(display = 'inline-flex', icon = false): string {
  return display + ' h-(--h-control) min-w-(--h-control) cursor-pointer items-center justify-center gap-6 whitespace-nowrap rounded-full border border-transparent bg-transparent '
    + 'font-inherit text-13 font-semibold text-chrome-text no-underline transition-[background-color] duration-(--dur-fast) ease-out hover:bg-chrome-hover disabled:cursor-progress '
    + (icon ? 'w-(--h-control) p-0' : 'px-12 py-0');
}
/** 帯のボタンの中のアイコン（帯のボタンは、アイコンを下げない） */
export const hbtnIcon = 'align-[0]';
/** ボタンの字（スマホでは隠して、アイコンだけにする） */
export const btxt = 'max-sm:hidden!';
/** 本文。開いたときに、中の区分をそっと出す。スマホでは下のタブの分を空ける（カレンダーは「卓を登録」の丸いボタンの分も） */
export function mainArea(bottom: 'tabs' | 'cal' = 'tabs'): string {
  return 'mx-auto max-w-1440 pt-20 pb-48 pr-[max(20px,env(safe-area-inset-right))] pl-[max(20px,env(safe-area-inset-left))] [&>section:not([hidden])]:animate-fade-in '
    + 'max-sm:pt-12 max-sm:pr-[max(12px,env(safe-area-inset-right))] max-sm:pl-[max(12px,env(safe-area-inset-left))] '
    + (bottom === 'cal' ? 'max-sm:pb-[calc(var(--nav-h)+96px+env(safe-area-inset-bottom))]' : 'max-sm:pb-[calc(var(--nav-h)+32px+env(safe-area-inset-bottom))]');
}
