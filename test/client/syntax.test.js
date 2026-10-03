// 画面の JS が読めるか（ES モジュールとして読むので、厳格モードで構文を確かめる）。DOM は無いので実行はしない
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test } from 'vitest';

const dir = path.join(import.meta.dirname, '../../src/client');

test.each(['console/app.js'])('%s の構文', (file) => {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  expect(() => new vm.Script('"use strict";\n' + code, { filename: file })).not.toThrow();
});
