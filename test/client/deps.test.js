// 依存の約束: Workers のテスト用の道具（vitest-pool-workers）が、アプリと同じ wrangler・miniflare で動くか。
// vitest-pool-workers は古い版を固定して抱える（npm audit に出る）ので、package.json の overrides でそろえている
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('overrides の miniflare は、wrangler が使う版と同じ（wrangler を上げたら合わせる）', () => {
  const override = json('package.json').overrides['@cloudflare/vitest-pool-workers'];
  expect(override.wrangler).toBe('$wrangler');
  expect(override.miniflare).toBe(json('node_modules/wrangler/package.json').dependencies.miniflare);
});
