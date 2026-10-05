import { FILLED, ICONS, type IconName } from './icons';

/**
 * アイコン 1 つ（SVG。icons.ts）。飾りなので読み上げない。名前は icons.ts の ICONS にあるものだけ。
 * 大きさは size（sm・xs）か、className の文字の大きさ（text-22 など。アイコンは 1em）。色は文字の色。filled は塗りつぶした形
 */
export function Icon({ name, size, filled, className }: { name: IconName; size?: 'sm' | 'xs'; filled?: boolean; className?: string }) {
  const Svg = (filled && FILLED[name]) || ICONS[name];
  return <Svg className={['ic', size, className].filter(Boolean).join(' ')} aria-hidden="true" focusable="false" />;
}
