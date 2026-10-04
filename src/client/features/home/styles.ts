// 入口の部品の見た目（Tailwind のクラス）。グループの画面とは別の見た目（入口を作り直すときに、そろえる）

/** カード */
export const card = 'mb-16 rounded-lg border border-line bg-card px-22 py-20 shadow-card';
/** 見出し（アイコンと並べる） */
export const h2 = 'm-0 mb-12 flex items-center gap-8 text-16';
/** 小さな説明 */
export const hint = 'text-13 text-muted';
/** 説明の中のリンク */
export const hintLink = 'text-accent-strong';
/** ボタン。文字は親から受けず、ここで決める（ボタンは文字の決まりを親から受けないため） */
const btnBase = 'inline-flex h-40 cursor-pointer items-center gap-6 rounded-full border px-16 font-home text-15 leading-[1.7] font-semibold no-underline disabled:cursor-default disabled:opacity-60';
export const btn = btnBase + ' border-line bg-card text-fg hover:bg-hover';
export const btnPrimary = btnBase + ' border-accent bg-accent text-accent-ink';
/** 入力欄と選ぶ欄。文字の大きさと太さは、置く場所で足す */
export const field = 'h-40 rounded-md border border-line bg-card px-10 font-home leading-[1.7] text-fg';
/** 入力欄の名前（上に名前、下に欄） */
export const label = 'flex flex-[1_1_200px] flex-col gap-4 text-13 font-semibold';
/** 横に並べる行 */
export const row = 'mb-12 flex flex-wrap items-end gap-12';
/** アイコン（入口は、グループの画面より少し下げて並べる） */
export const icon = 'align-[-4px]';
export const iconSm = 'text-17 align-[-3px]';
