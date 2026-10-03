// Apps Script のモック（test/mock_gas.js）と src/server のスクリプトを、このテストのグローバルに読み込む。
// Apps Script と同じく、ファイルを 1 つずつ別のスクリプトとして同じグローバルに読む。
// 読み込んだあとは、テストから saveSession や SS などをそのまま呼べる。
// グローバルを書き換えるので、1 つのテストファイルで 1 回だけ呼ぶ（Vitest はテストファイルごとに別のプロセスで動く）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ROOT, htmlFiles, serverFiles } from '../../tools/gas-project.js';

const MOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mock_gas.js');

/** 1 つのスクリプトとして読み込む。エラーの場所にファイル名が出るように名前を付ける */
export function runScript(file, context) {
  const script = new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(ROOT, file) });
  return context ? script.runInContext(context) : script.runInThisContext();
}

/**
 * モックとサーバー側のスクリプトを読み込む。context を渡せばその中に、渡さなければこのテストのグローバルに読む。
 * files で読み込む順を変えられる（既定は clasp push と同じ名前順）
 */
export function loadGas({ context, files = serverFiles() } = {}) {
  runScript(MOCK, context);
  const setHtml = 'HTML_FILES = ' + JSON.stringify(htmlFiles()) + ';';
  if (context) vm.runInContext(setHtml, context); else vm.runInThisContext(setHtml);
  files.forEach((f) => runScript(f, context));
}
