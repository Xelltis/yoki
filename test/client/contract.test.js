// 画面の約束: アイコンの読み方（使ってよい集まりの SVG だけ）。GAS の名残（テンプレート・合言葉の窓・シートの入口）が無いか。
// 画面とサーバーの呼び出しの名前・返事の形は、src/shared/api.ts の型で確かめる（npm run typecheck）
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** 画面のファイル（src/client の .tsx・.ts・.html。手元の wrangler の控えは除く） */
const clientFiles = fs.readdirSync(path.join(root, 'src/client'), { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && /\.(tsx?|html)$/.test(e.name))
  .map((e) => path.join(e.parentPath, e.name))
  .filter((f) => !/^src[/\\]client[/\\]\.wrangler[/\\]/.test(path.relative(root, f)));
const clientSrc = clientFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('GAS の名残（google.script・テンプレート・合言葉の窓・シートの入口）が無い', () => {
  expect(clientSrc).not.toMatch(/google\.script\.run\b/);
  expect(clientSrc).not.toContain('<?');
  expect(clientSrc).not.toContain('loginModal');
  expect(clientSrc).not.toContain('sheetLink');
  expect(clientSrc).not.toContain('base target');
});

test('アイコン: 一覧（ui/icons.ts）は並んでいて重ならず、どれも使っている。使ってよい集まりから SVG で読み、フォントや画像では読まない', () => {
  const icons = read('src/client/ui/icons.ts');
  const list = [...(/ICONS = \{([^}]*)\}/.exec(icons)[1].matchAll(/^\s+(\w+):/gm))].map((m) => m[1]);
  expect(list).toEqual([...new Set(list)].sort());
  // 使う名前は型で確かめる（<Icon name="…"> や、名前の一覧）。ここでは、どこにも書いていない名前が一覧に残っていないかを見る
  const src = clientFiles.filter((f) => !f.endsWith(path.join('ui', 'icons.ts'))).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  expect(list.filter((n) => !new RegExp(`['"]${n}['"]`).test(src))).toEqual([]);
  // アイコンは unplugin-icons（~icons/<集まり>/<名前>）で読む。集まりは、ライセンスを確かめたもの（tools/icons.ts）だけ
  const allowed = Object.fromEntries([...read('tools/icons.ts').matchAll(/^\s+'([\w-]+)': '([\w.-]+)',/gm)].map((m) => [m[1], m[2]]));
  const sets = new Set([...clientSrc.matchAll(/from '~icons\/([\w-]+)\//g)].map((m) => m[1]));
  expect(sets.size).toBeGreaterThan(0);
  for (const set of sets) {
    expect(allowed[set], set + ' は使ってよい集まりにない').toBeDefined();
    expect(JSON.parse(read('node_modules/@iconify-json/' + set + '/info.json')).license.spdx).toBe(allowed[set]);
  }
  // Google Fonts のアイコンのフォントは読まない
  expect(clientSrc).not.toMatch(/Material\+Symbols|material-icons/);
});
