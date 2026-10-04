import type { ReactNode } from 'react';

/**
 * 管理画面の左の区分と中身（グループの管理画面・運営の管理画面）。狭い画面では区分を上に横に並べる。
 * 区分のボタンは e2e が data-set で押す
 */
export function SetLayout({ nav, label, id, children }: { nav: ReactNode; label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[184px_minmax(0,1fr)] items-start gap-20 *:min-w-0 max-tab:grid-cols-[minmax(0,1fr)] max-tab:gap-12">
      <nav className="sticky top-[calc(var(--appbar-h)+14px)] grid gap-2 max-tab:static max-tab:grid-flow-col max-tab:overflow-x-auto max-tab:pb-4 max-tab:[scrollbar-width:none] max-tab:[&::-webkit-scrollbar]:hidden"
        id={id} aria-label={label}>
        {nav}
      </nav>
      <div>{children}</div>
    </div>
  );
}

/** 区分のボタン。いま開いている区分は水色 */
export const setNavBtn = 'cursor-pointer rounded-md border-0 bg-transparent px-12 py-9 text-left font-inherit text-[13.5px] font-semibold text-muted '
  + 'transition-[background-color,color] duration-(--dur-fast) ease-out hover:bg-hover hover:text-fg aria-[current=true]:bg-accent-soft aria-[current=true]:text-accent-text max-tab:whitespace-nowrap';
