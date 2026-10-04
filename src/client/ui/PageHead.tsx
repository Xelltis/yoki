import type { ReactNode } from 'react';

/** ページの見出しと、その下の一言（タブ・管理画面・運営の管理画面の上） */
export function PageHead({ title, lead }: { title: ReactNode; lead: ReactNode }) {
  return (
    <div className="mb-16">
      <h1 className="m-0 text-22 leading-[1.35] max-sm:text-20">{title}</h1>
      <p className="mt-4 mb-0 max-w-[62em] text-13 text-pretty text-muted">{lead}</p>
    </div>
  );
}
