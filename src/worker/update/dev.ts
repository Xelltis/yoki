// 開発用の偽のGitHub（開発サーバーだけ）。運営の管理画面の「更新」を、本物のGitHubなしで試すため。
// 最新の版はいつも、今の版の小さい版を1つ上げたもの。表の変更も含む。更新を頼むと、metaのdev_updateに実行を足す。
// config.tsがimport.meta.env.DEVのときだけ選ぶので、本番の組み立てには入らない
import { APP_VERSION } from '../version';
import type { UpdateApi, UpdateRun } from './api';

const KEY = 'dev_update';
const REPO_URL = 'https://github.com/example/yoki';

/** 今の版の小さい版を1つ上げる（1.2.3 → 1.3.0） */
export function nextMinor(v: string): string {
  const p = (v + '.0.0').split('.').map((x) => Number(x) || 0);
  return p[0]! + '.' + (p[1]! + 1) + '.0';
}

export function fakeGitHub(db: D1Database): UpdateApi {
  const next = nextMinor(APP_VERSION);
  const read = async () => JSON.parse((await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value')) ?? '[]') as UpdateRun[];
  return {
    async latestRelease() {
      return {
        tag: 'v' + next, name: 'v' + next, url: REPO_URL + '/releases/tag/v' + next, publishedAt: '2026-01-01T00:00:00Z',
        body: '## [' + next + '](' + REPO_URL + '/compare/v' + APP_VERSION + '...v' + next + ') (2026-01-01)\n\n\n'
          + '### 足したこと・変えたこと\n\n* **client:** 開発用の偽の版です ([0000000](' + REPO_URL + '/commit/0000000))\n\n'
          + '### 直したこと\n\n* 偽の不具合を直す ([1111111](' + REPO_URL + '/commit/1111111))\n',
      };
    },
    async changedFiles() {
      return ['src/worker/app.ts', 'migrations/9999_dev.sql'];
    },
    async dispatch(_repo, _token, _workflow, inputs) {
      const runs = await read();
      runs.unshift({ id: runs.length + 1, status: 'queued', conclusion: '', createdAt: new Date().toISOString(), url: REPO_URL + '/actions/runs/' + (runs.length + 1) + '?version=' + inputs.version });
      await db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(KEY, JSON.stringify(runs.slice(0, 5))).run();
    },
    async runs() {
      return read();
    },
  };
}
