// 広い窓（卓の登録・日程の調整）の部品の見た目（Tailwind のクラス）。窓の箱は styles/components.css の .modal .box.wide

/** 上に貼り付く見出しの帯（題と閉じるボタン） */
export const wideBar = 'sticky top-0 z-(--z-sticky) -mx-22 mt-0 mb-4 flex flex-wrap items-center gap-8 border-b border-line bg-card px-22 pt-14 pb-12 max-sm:-mx-16 max-sm:px-16';
export const wideBarTitle = 'm-0 inline-flex items-center gap-6 text-17';
/** 下に貼り付く操作の帯（保存のボタンと結果） */
export const formActions = 'sticky bottom-0 z-(--z-sticky) -mx-22 mt-16 mb-0 border-t border-line bg-card px-22 pt-12 pb-16 '
  + 'max-sm:-mx-16 max-sm:px-16 max-sm:pb-[max(16px,env(safe-area-inset-bottom))]';
