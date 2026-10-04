// 管理画面の「知らせ」の折りたためる枠（チャンネル・シリーズごとの上書き）の見た目（Tailwind のクラス）

/** 折りたためる枠（チャンネル・シリーズ）。開くと右の印が上を向く */
export const foldCard = 'group mb-16 overflow-hidden rounded-lg border border-line bg-card shadow-card';
export const foldSummary = 'flex cursor-pointer list-none items-center gap-8 px-16 py-13 text-14 font-bold hover:bg-hover [&::-webkit-details-marker]:hidden '
  + 'after:ml-auto after:text-12 after:text-muted after:transition-[transform] after:duration-(--dur-fast) after:ease-out after:content-["▾"] group-open:after:[transform:rotate(180deg)]';
export const foldBody = 'border-t border-line px-16 pt-0 pb-6';
/** 折りたたみの中のカード（枠を消して、間に線を引く） */
export const foldInner = (first: boolean) => 'card m-0 rounded-none border-0 px-0 py-14 shadow-none' + (first ? '' : ' border-t border-line');
