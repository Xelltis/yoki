// 画面の約束: 使うアイコンを読み込んでいるか。GAS の名残（テンプレート・合言葉の窓・シートの入口）が無いか。
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

test('アイコン: 一覧（ui/icons.ts）は並んでいて重ならず、どれも使っている。index.html はその一覧を読み込む', () => {
  const list = /ICON_NAMES = \[([^\]]*)\]/.exec(read('src/client/ui/icons.ts'))[1].match(/[a-z0-9_]+/g);
  expect(list).toEqual([...new Set(list)].sort());
  // 使う名前は型で確かめる（<Icon name="…"> や、名前の一覧）。ここでは、どこにも書いていない名前が一覧に残っていないかを見る
  const src = clientFiles.filter((f) => !f.endsWith(path.join('ui', 'icons.ts'))).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  expect(list.filter((n) => !new RegExp(`['"]${n}['"]`).test(src))).toEqual([]);
  expect(read('src/client/index.html')).toContain('icon_names=%ICON_NAMES%&');
});
