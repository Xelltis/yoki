// グループの画面のいくつかのタブで使う形（Tailwind のクラス）

/**
 * 知らせの行（右の「卓予定」と、メンバーの予定の上の注意）。kind は today・tomorrow・week・adjust・hot・overdue・info。
 * 先頭のアイコンは丸の中に出す。押せる行は button にする
 */
export function notice(kinds: string, button: boolean): string {
  const k = (n: string) => kinds.split(' ').indexOf(n) >= 0;
  const hot = k('hot'), info = k('info');
  let c = 'relative m-0 block w-full rounded-md text-left font-inherit leading-[1.55] text-pretty '
    + '[&>.material-icons:first-child]:absolute [&>.material-icons:first-child]:top-9 [&>.material-icons:first-child]:left-10 [&>.material-icons:first-child]:h-28 [&>.material-icons:first-child]:w-28 '
    + '[&>.material-icons:first-child]:rounded-[50%] [&>.material-icons:first-child]:text-center [&>.material-icons:first-child]:text-17 [&>.material-icons:first-child]:leading-[28px] [&>.material-icons:first-child]:align-[0] ';
  c += info ? 'border-0 bg-transparent px-0 pt-2 pb-0 text-12 ' : 'border py-10 pr-12 pl-48 ';
  // 色。hot（募集中・調整中）がいちばん強い
  if (hot) c += 'border-[color-mix(in_srgb,var(--violet)_45%,var(--line))] bg-soon ';
  else if (k('today')) c += 'border-[color-mix(in_srgb,var(--err-text)_30%,var(--line))] bg-card ';
  else if (!info) c += 'border-line bg-card ';
  c += k('overdue') || info ? 'text-muted ' : 'text-fg ';
  if (k('today') || k('tomorrow')) c += 'font-semibold ';
  if (button) c += 'cursor-pointer transition-[background-color,border-color] duration-(--dur-fast) ease-out hover:border-line-strong hover:bg-hover ';
  // 先頭のアイコンの丸の色（クラスの名前は、Tailwind が見つけられるように書き切る）
  return c + (hot ? '[&>.material-icons:first-child]:bg-violet [&>.material-icons:first-child]:text-card'
    : k('today') ? '[&>.material-icons:first-child]:bg-warn [&>.material-icons:first-child]:text-err-text'
      : k('tomorrow') ? '[&>.material-icons:first-child]:bg-accent-soft [&>.material-icons:first-child]:text-accent-text'
        : k('week') ? '[&>.material-icons:first-child]:bg-head [&>.material-icons:first-child]:text-fg'
          : k('adjust') ? '[&>.material-icons:first-child]:bg-soon [&>.material-icons:first-child]:text-violet'
            : '[&>.material-icons:first-child]:bg-head [&>.material-icons:first-child]:text-muted');
}
/** 知らせの行の 2 行目（小さな説明） */
export const noticeSub = 'block text-12 font-normal text-pretty text-muted';

/** 参加者の札の並び（卓の内訳・募集のカード） */
export const people = 'mt-6 flex flex-wrap gap-4';
/** 参加者の札。gm は黒、unknown（メンバーに無い）は点線で薄い字 */
export function personChip(gm: boolean, unknown: boolean): string {
  return 'rounded-full border px-10 py-1 text-12 '
    + (gm ? 'border-primary bg-primary font-bold ' : 'border-line bg-card ')
    + (unknown ? 'border-dashed text-muted' : gm ? 'text-primary-ink' : '');
}
/** 卓のカードの 2 行目から（場所・メモ） */
export const row2 = 'mt-4';
/** 押したあとの結果の小さな字 */
export const res = 'text-12 text-muted tabular-nums';
/** チェックの札（曜日・メンバー。選ぶと水色）。並べる枠は checkPills */
export const checkPill = 'm-0 inline-flex cursor-pointer items-center gap-6 rounded-full border border-line-strong bg-card py-3 pr-10 pl-8 text-13 font-normal '
  + 'has-checked:border-accent-line has-checked:bg-accent-soft has-checked:text-accent-text ';
export const checkPills = 'mb-10 flex flex-wrap gap-6';
/** 予定のメモがあることを示す点 */
export const mdot = 'pointer-events-none absolute top-3 left-3 h-7 w-7 rounded-[50%] bg-accent';
