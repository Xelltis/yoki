// 組み立てたあと、wrangler deployの行き先を直下に写す（vite.config.tsのdeployRedirect）。Workers Buildsの公開が、これで組み立てたWorkerを見つける
import path from 'node:path';
import { expect, test } from 'vitest';
import { moveDeployConfig } from '../../vite.config';

const root = path.join(import.meta.dirname, '../..');

test('行き先を直下に写すと、Workerの名前の組み立て先を指す（ボタンで設置するときに名前を変えても公開できる）', () => {
  const from = path.join(root, 'src/client/.wrangler/deploy');
  const to = path.join(root, '.wrangler/deploy');
  // プラグインは、組み立て先をWorkerの名前にする（- は _ に替わる）
  for (const dir of ['yoki', 'yoki2', 'my_yoki']) {
    const text = JSON.stringify({ configPath: `../../../../dist/${dir}/wrangler.json`, auxiliaryWorkers: [] });
    expect(JSON.parse(moveDeployConfig(text, from, to))).toEqual({ configPath: `../../dist/${dir}/wrangler.json`, auxiliaryWorkers: [] });
  }
});
