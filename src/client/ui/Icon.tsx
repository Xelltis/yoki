import { FILLED, ICONS, type IconName } from './icons';

/**
 * アイコン1つ（SVG。icons.ts）。飾りなので読み上げない。名前はicons.tsのICONSにあるものだけ。
 * 大きさはsize（sm・xs）か、classNameの文字の大きさ（text-22など。アイコンは1em）。色は文字の色。filledは塗りつぶした形
 */
export function Icon({ name, size, filled, className }: { name: IconName; size?: 'sm' | 'xs'; filled?: boolean; className?: string }) {
  const Svg = (filled && FILLED[name]) || ICONS[name];
  return <Svg className={['ic', size, className].filter(Boolean).join(' ')} aria-hidden="true" focusable="false" />;
}
