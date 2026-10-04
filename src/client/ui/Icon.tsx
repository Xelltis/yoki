import type { IconName } from './icons';

/** アイコン 1 つ（Material Symbols）。飾りなので読み上げない。名前は icons.ts の ICON_NAMES にあるものだけ */
export function Icon({ name, size }: { name: IconName; size?: 'sm' | 'xs' }) {
  return (
    <span className={size ? 'material-icons ' + size : 'material-icons'} aria-hidden="true">
      {name}
    </span>
  );
}
