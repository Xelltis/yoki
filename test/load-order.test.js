// 読み込む順に頼っていないか。Apps Script はファイルを並びの順に 1 つずつ読み込み、並びは push の順やエディタの操作で変わる。
// 名前順でも逆順でも読み込めれば、どのファイルもトップレベル（関数の外）でほかのファイルの定数を使っていない
// （A が B に頼っていれば、名前順か逆順のどちらかで A が先に来て落ちる）
import vm from 'node:vm';
import { expect, test } from 'vitest';
import { serverFiles } from '../tools/gas-project.js';
import { loadGas } from './helpers/load-gas.js';

test.each([
  ['名前順（clasp push と同じ）', serverFiles()],
  ['逆順', serverFiles().reverse()],
])('server/ のスクリプトを%sで読み込める', (label, files) => {
  const context = vm.createContext({});
  expect(() => loadGas({ context, files })).not.toThrow();
  expect(vm.runInContext('typeof doGet', context)).toBe('function');
});
