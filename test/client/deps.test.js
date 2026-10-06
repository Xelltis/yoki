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

// semantic-release の部品の差し替え（tools/shims。npm audit を 0 件に保つため。README の「版を出す」）
test('semantic-release の micromatch と npm プラグインは、tools/shims の差し替えに替えている', async () => {
  const pkg = json('package.json');
  expect(pkg.overrides['semantic-release']).toEqual({ micromatch: '$micromatch', '@semantic-release/npm': '$@semantic-release/npm' });
  expect(pkg.devDependencies.micromatch).toBe('file:tools/shims/micromatch');
  expect(pkg.devDependencies['@semantic-release/npm']).toBe('file:tools/shims/semantic-release-npm');
  // 差し替えの micromatch は、semantic-release が使う 2 つの呼び方（branches の照合・releaseRules の照合）で本物と同じに答える
  const { createRequire } = await import('node:module');
  const micromatch = createRequire(import.meta.url)('../../tools/shims/micromatch/index.cjs');
  expect(micromatch(['main', 'next', '1.x', 'feature'], 'main')).toEqual(['main']);
  expect(micromatch(['main', '1.x', '2.x', 'beta'], '+([0-9])?(.{+([0-9]),x}).x')).toEqual(['1.x', '2.x']);
  expect(micromatch.isMatch('feat', 'feat')).toBe(true);
  expect(micromatch.isMatch('fix', 'feat')).toBe(false);
  expect(micromatch.isMatch('fix', '{feat,fix}')).toBe(true);
  // npm プラグインは何もしない（npm には公開しない）
  const npmPlugin = await import('../../tools/shims/semantic-release-npm/index.js');
  expect(await npmPlugin.publish()).toBe(false);
  expect(await npmPlugin.verifyConditions()).toBeUndefined();
});
