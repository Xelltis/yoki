// src/ にある Apps Script のソースを、Apps Script と同じ形で読む小道具。テスト（test/）と開発サーバー（dev/pages.js）が使う。
//
// Apps Script 側のファイル名は、clasp と同じく src/ からの相対パスで拡張子を除いたもの
// （src/client/Console.html → client/Console、src/server/Config.js → server/Config）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');

// テンプレートで使うのは、HTML ファイルを差し込む include_ だけ
const INCLUDE = /<\?!=\s*include_\('([^']+)'\);?\s*\?>/g;

const read = (file) => fs.readFileSync(file, 'utf8');
const sortedNames = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();

/** サーバー側のスクリプトのパス。clasp push と同じく名前順 */
export function serverFiles() {
  const dir = path.join(SRC, 'server');
  return sortedNames(dir, '.js').map((f) => path.join(dir, f));
}

/** サーバー側のスクリプトを名前順に 1 本へつなぐ（開発サーバーでブラウザに埋め込む形） */
export function serverCode() {
  return serverFiles().map(read).join('\n');
}

/** 画面の HTML を { 'client/Console': 中身 } の形で返す */
export function htmlFiles() {
  const dir = path.join(SRC, 'client');
  return Object.fromEntries(sortedNames(dir, '.html').map((f) => ['client/' + path.basename(f, '.html'), read(path.join(dir, f))]));
}

/**
 * doGet と同じ組み立て。<?!= include_('…'); ?> をそのファイルの中身に置き換える。
 * ほかのスクリプトレット（<? … ?>）が残っていたら止める
 */
export function render(name, files = htmlFiles()) {
  const html = files[name].replace(INCLUDE, (m, file) => {
    if (!(file in files)) throw new Error(name + ' が差し込む ' + file + ' がありません');
    return files[file];
  });
  if (html.includes('<?')) throw new Error(name + ' に、解いていないスクリプトレットがあります');
  return html;
}
