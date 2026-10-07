// 第三者のライセンスの断り書き（THIRD_PARTY_NOTICES.md。tools/third-party.mjsが書き出す）が、今の依存と合っているか
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { appPackages, OUT, render } from '../../tools/third-party.mjs';

const root = path.join(import.meta.dirname, '../..');

test('THIRD_PARTY_NOTICES.mdは、今の依存から書き出したものと同じ（依存を変えたら npm run notices）', () => {
  expect(fs.readFileSync(path.join(root, OUT), 'utf8')).toBe(render());
});

test('アプリの実行時の依存は、どれも断り書きに載る。自前の差し替え（tools/shims）は載せない', () => {
  const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies);
  const names = appPackages().map((p) => p.name);
  for (const d of deps) expect(names).toContain(d);
  expect(names).not.toContain('micromatch');
  expect(names).not.toContain('@semantic-release/npm');
  // READMEから開ける
  expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('(THIRD_PARTY_NOTICES.md)');
});
