import { Icon } from './Icon';

/**
 * 項目ごとの説明の「？」。マウスを載せるか押すと、吹き出し（TipLayer）に text が出る（tip と data-tip は TipLayer が探す印）。
 * className は置く場所の余白（既定は左に 4px）
 */
export function Tip({ text, label, className = 'ml-4' }: { text: string; label: string; className?: string }) {
  return (
    <button type="button" data-tip={text} aria-label={label}
      className={'tip inline-grid size-22 shrink-0 cursor-help place-items-center rounded-full border-0 bg-transparent p-0 align-[1px] text-muted '
        + 'hover:bg-hover hover:text-accent-text aria-expanded:bg-hover aria-expanded:text-accent-text focus-visible:outline-offset-1 ' + className}>
      <Icon name="help" size="xs" />
    </button>
  );
}
