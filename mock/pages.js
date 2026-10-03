// UI 2026 案 ver2 の組み立て方。vite.config.js が、入口の HTML（mock/ui2026-v2.html）をこの結果に差し替える。
// 開発サーバーで動くアプリ（dev/pages.js）に ver2-overlay.html を最後に重ねるだけで、原盤の中身は 1 文字も書き換えない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPage, replaceOnce } from '../dev/pages.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function mockV2Page() {
  const overlay = fs.readFileSync(path.join(here, 'ver2-overlay.html'), 'utf8');
  // 題名だけは ver2 と分かるようにする
  const html = appPage().replace(/<title>卓予定[^<]*<\/title>/, () => '<title>卓予定（UI 2026 案 ver2）</title>');
  return replaceOnce(html, '</body>', overlay.trimEnd() + '\n</body>');
}
