// 開発サーバー（npm run dev）で、アプリを Apps Script もシートも無しに動かすための組み立て。
// vite.config.js が、入口の index.html をこの結果に差し替える。
//
// アプリは、本物の画面（src/client/Console を doGet と同じく組み立てたもの）に次の部品を差し込んだもの。
//   head の頭     … params.js（URL の ?tab= などを読む）
//   画面の JS の前 … DEV_BACKEND（モック test/mock_gas.js ＋ src/server ＋ seed.js）と google-script-run.js
//   body の終わり … badge.html（左下の札。サンプルデータで動いていることを示す）
// サーバー側はブラウザの中で動き、データは開くたびに seed.js が作る。どこにも保存しない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, render, serverCode } from '../tools/gas-project.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), 'utf8');

/** アプリの URL。本物の /exec と同じく、後ろに ?page=tutorial を付けると使い方のページになる */
export const APP_URL = '/';

// Apps Script の HtmlService が返すときに足すもの。文字コード（HtmlService は UTF-8 で返す）と、doGet の addMetaTag('viewport', …)
const CHARSET = '<meta charset="utf-8">\n';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">\n';

/** 文字列の中に 1 つだけある mark を置き換える。無いか 2 つ以上あれば止める */
export function replaceOnce(text, mark, replacement) {
  const n = text.split(mark).length - 1;
  if (n !== 1) throw new Error(JSON.stringify(mark) + ' が ' + n + ' 個あります（1 個のはず）');
  return text.replace(mark, () => replacement);
}

/** 画面が呼ぶ関数の名前（client/ConsoleJs.html の API_FUNCS） */
function apiFuncsOf(consoleHtml) {
  const i = consoleHtml.indexOf('var API_FUNCS = [');
  const j = consoleHtml.indexOf('];', i);
  if (i < 0 || j < 0) throw new Error('画面に API_FUNCS が見つかりません');
  return JSON.parse('[' + consoleHtml.slice(i + 'var API_FUNCS = ['.length, j).replaceAll("'", '"') + ']');
}

/**
 * ブラウザの中で動くサーバー側。モックと src/server と seed.js を 1 つの関数の中に閉じ込め、
 * 画面が呼ぶ関数だけを DEV_BACKEND として外に出す
 */
export function devBackend({ apiFuncs = apiFuncsOf(render('client/Console')) } = {}) {
  const mock = fs.readFileSync(path.join(ROOT, 'test', 'mock_gas.js'), 'utf8');
  const seed = read('seed.js').replaceAll('__APP_URL__', APP_URL);
  return 'var DEV_BACKEND = (function () {\n' + mock + '\n' + serverCode() + '\n' + seed +
    '\n  return {\n    __seed: seed,\n' + apiFuncs.map((n) => '    ' + n + ': ' + n).join(',\n') + '\n  };\n})();\n';
}

/** アプリ（index.html） */
export function appPage() {
  const consoleHtml = render('client/Console');
  const backend = devBackend({ apiFuncs: apiFuncsOf(consoleHtml) }).replaceAll('</script', '<\\/script');
  const anchor = '<script>\n  var D = null;';
  let out = replaceOnce(consoleHtml, anchor, '<script>\n' + backend + read('google-script-run.js') + '</script>\n  ' + anchor);
  out = replaceOnce(out, '</body>', read('badge.html') + '</body>');
  out = replaceOnce(out, '<head>', '<head>\n' + VIEWPORT + '<script>\n' + read('params.js') + '</script>\n');
  return out;
}

/** 使い方のページ（index.html?page=tutorial）。doGet と同じく、アプリへ戻るリンク用に URL を渡す */
export function tutorialPage() {
  return CHARSET + VIEWPORT + render('client/Tutorial').trimEnd() + '\n<script>window.APP_URL = ' + JSON.stringify(APP_URL) + ';</script>\n';
}

/** index.html の中身。doGet と同じく、?page=tutorial なら使い方のページ、ほかはアプリ */
export function indexPage({ url }) {
  return url.searchParams.get('page') === 'tutorial' ? tutorialPage() : appPage();
}
