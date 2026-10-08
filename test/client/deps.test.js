// 依存の約束: Workersのテスト用の道具（vitest-pool-workers）が、アプリと同じwrangler・miniflareで動くか。
// vitest-pool-workersは古い版を固定して抱える（npm auditに出る）ので、package.jsonのoverridesでそろえている
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('overridesのminiflareは、wranglerが使う版と同じ（wranglerを上げたら合わせる）', () => {
  const override = json('package.json').overrides['@cloudflare/vitest-pool-workers'];
  expect(override.wrangler).toBe('$wrangler');
  expect(override.miniflare).toBe(json('node_modules/wrangler/package.json').dependencies.miniflare);
});

// semantic-releaseの部品の差し替え（tools/shims。npm auditを0件に保つため。CONTRIBUTING.mdの「版を出す」）
test('semantic-releaseのmicromatchとnpmプラグインは、tools/shimsの差し替えに替えている', async () => {
  const pkg = json('package.json');
  expect(pkg.overrides['semantic-release']).toEqual({ micromatch: '$micromatch', '@semantic-release/npm': '$@semantic-release/npm' });
  expect(pkg.devDependencies.micromatch).toBe('file:tools/shims/micromatch');
  expect(pkg.devDependencies['@semantic-release/npm']).toBe('file:tools/shims/semantic-release-npm');
  // 差し替えのmicromatchは、semantic-releaseが使う2つの呼び方（branchesの照合・releaseRulesの照合）で本物と同じに答える
  const { createRequire } = await import('node:module');
  const micromatch = createRequire(import.meta.url)('../../tools/shims/micromatch/index.cjs');
  expect(micromatch(['main', 'next', '1.x', 'feature'], 'main')).toEqual(['main']);
  expect(micromatch(['main', '1.x', '2.x', 'beta'], '+([0-9])?(.{+([0-9]),x}).x')).toEqual(['1.x', '2.x']);
  expect(micromatch.isMatch('feat', 'feat')).toBe(true);
  expect(micromatch.isMatch('fix', 'feat')).toBe(false);
  expect(micromatch.isMatch('fix', '{feat,fix}')).toBe(true);
  // npmプラグインは何もしない（npmには公開しない）
  const npmPlugin = await import('../../tools/shims/semantic-release-npm/index.js');
  expect(await npmPlugin.publish()).toBe(false);
  expect(await npmPlugin.verifyConditions()).toBeUndefined();
});

// READMEのバッジに書いた版（React・Hono・TypeScript）は、package.jsonの版とそろえる（依存を上げたら、バッジも直す）
test('READMEのバッジの版は、package.jsonの版と同じ（React・Honoは大きい数字、TypeScriptは小さい数字まで）', () => {
  const pkg = json('package.json');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const badge = (name) => readme.match(new RegExp(`img\\.shields\\.io/badge/${name}-([0-9.]+)-`))?.[1];
  const ver = (name) => deps[name].replace(/^[^0-9]*/, '').split('.');
  expect(badge('React')).toBe(ver('react')[0]);
  expect(badge('Hono')).toBe(ver('hono')[0]);
  expect(badge('TypeScript')).toBe(ver('typescript').slice(0, 2).join('.'));
});
