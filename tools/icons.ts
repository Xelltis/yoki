// アイコン（unplugin-icons）の決まり。アプリ（vite.config.ts）とサイト（website/.vitepress/config.ts）で使う。
// アイコンはIconifyの集まりから選び、組み立てのときにSVGとしてJSに入れる（画像やフォントは読まない）。
// 使ってよい集まりは、ライセンスを確かめたものだけ（ALLOWED_ICON_SETS。test/client/contract.test.jsが確かめる）
import type { CustomCompiler } from 'unplugin-icons';

/** 使ってよいアイコンの集まりと、そのライセンス（SPDX）。足すときは、ライセンスを確かめてから */
export const ALLOWED_ICON_SETS: Record<string, string> = {
  // Material Symbols（Google）。Apache License 2.0
  'material-symbols': 'Apache-2.0',
};

/**
 * SVGをReactの部品にする（unplugin-iconsのReact向けの変換は @svgr とBabelが要るので、使わずに済ませる）。
 * 外側の <svg> の属性はそのまま渡し、中身は文字のまま入れる。中身はアイコンの集まりのSVGで、利用者の入力は入らない
 */
export const reactIconCompiler: CustomCompiler = {
  compiler: (svg, collection, icon) => {
    const m = /^<svg([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim());
    if (!m) throw new Error('アイコンのSVGを読めません: ' + collection + '/' + icon);
    const attrs = Object.fromEntries([...m[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)].filter(([, k]) => !k!.startsWith('xmlns')).map(([, k, v]) => [k, v]));
    return [
      "import { createElement } from 'react';",
      'const attrs = ' + JSON.stringify(attrs) + ';',
      'const html = ' + JSON.stringify(m[2]) + ';',
      'export default function Icon(props) { return createElement("svg", { ...attrs, ...props, dangerouslySetInnerHTML: { __html: html } }); }',
    ].join('\n');
  },
};
