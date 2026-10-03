// 画面とサーバーの約束: 画面が呼ぶ関数がサーバーに全部あるか。GAS の名残（google.script・合言葉）が無いか
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const js = read('src/client/console/app.js');
const html = read('src/client/console/index.html');

test('画面の API_FUNCS は、サーバーの呼び出しの一覧（routes/rpc.ts）に全部ある', () => {
  const m = /var API_FUNCS = \[([\s\S]*?)\];/.exec(js);
  const funcs = JSON.parse('[' + m[1].replace(/'/g, '"') + ']');
  const rpc = read('src/worker/routes/rpc.ts');
  const server = ['getConsoleData', ...[...rpc.matchAll(/^\s{2}(\w+): \{ run:/gm)].map((x) => x[1])];
  expect(funcs.filter((f) => !server.includes(f))).toEqual([]);
});

test('GAS の名残（google.script・テンプレート・合言葉の窓・シートの入口）が無い', () => {
  expect(js).not.toMatch(/google\.script\.run\b(?!\s+と同じ)/);
  expect(html).not.toContain('<?');
  expect(html).not.toContain('loginModal');
  expect(html).not.toContain('sheetLink');
  expect(html).not.toContain('base target');
});

test('画面の JS で使うアイコンが、読み込むアイコンの一覧にある', () => {
  const names = new Set(/icon_names=([^&"]+)/.exec(html)[1].split(','));
  const used = new Set([...js.matchAll(/\bmi\('([a-z_]+)'/g)].map((x) => x[1]));
  expect([...used].filter((n) => !names.has(n))).toEqual([]);
});
