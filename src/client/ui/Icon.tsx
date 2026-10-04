import type { IconName } from './icons';

/**
 * アイコン 1 つ（Material Symbols）。飾りなので読み上げない。名前は icons.ts の ICON_NAMES にあるものだけ。
 * 大きさは size（sm・xs）、場面ごとの調整は className（Tailwind のクラス）で足す
 */
export function Icon({ name, size, className }: { name: IconName; size?: 'sm' | 'xs'; className?: string }) {
  return (
    <span className={['material-icons', size, className].filter(Boolean).join(' ')} aria-hidden="true">
      {name}
    </span>
  );
}
