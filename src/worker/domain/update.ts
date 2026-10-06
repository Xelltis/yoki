// 運営の管理画面の「更新」。動いている版と、元のリポジトリの最新の Release を比べる。新しければ、変わったことと表の変更があるかを出し、
// 公開しているリポジトリの更新のワークフローを動かす（update/config.ts）。GitHub を読むのは 1 時間に 1 回まで（meta の update_check に控える）
import type { AdminUpdate } from '../../shared/admin';
import { AppError } from '../lib/errors';
import { UPDATE_WORKFLOW, type UpdateDeps } from '../update/config';
import { APP_VERSION } from '../version';

const KEY = 'update_check';
const TTL_MS = 3600_000;

/** 控える中身。upstream と from（そのときの版）が今と違えば、読み直す */
type Check = Pick<AdminUpdate, 'latest' | 'migrations' | 'error' | 'checkedAt'> & { upstream: string; from: string };

/** 版（1.2.3。頭の v はあってもよい）を数の組にする。読めなければ null */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a が b より新しい版か。どちらかが読めなければ偽 */
export function newer(a: string, b: string): boolean {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function check(db: D1Database, deps: UpdateDeps, now: Date, force: boolean): Promise<Check> {
  const raw = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value');
  const saved = raw ? (JSON.parse(raw) as Check) : null;
  if (!force && saved && saved.upstream === deps.upstream && saved.from === APP_VERSION && now.getTime() - Date.parse(saved.checkedAt) < TTL_MS) return saved;
  let c: Check;
  try {
    const rel = await deps.api.latestRelease(deps.upstream);
    const latest = rel && { version: rel.tag.replace(/^v/, ''), name: rel.name, url: rel.url, publishedAt: rel.publishedAt, notes: rel.body };
    let migrations: boolean | null = null;
    if (latest && newer(latest.version, APP_VERSION)) {
      // 表の変更があるか。今の版のタグが元のリポジトリに無い（フォークで版を変えた）など、比べられなければ分からないまま
      migrations = await deps.api.changedFiles(deps.upstream, 'v' + APP_VERSION, rel.tag).then((files) => files.some((f) => f.startsWith('migrations/')), () => null);
    }
    c = { latest, migrations, error: '', checkedAt: now.toISOString(), upstream: deps.upstream, from: APP_VERSION };
  } catch (e) {
    // 読めなければ、前に読めた最新の版は残す
    c = { latest: saved?.latest ?? null, migrations: saved?.migrations ?? null, error: '新しい版を確かめられませんでした（' + message(e) + '）', checkedAt: now.toISOString(), upstream: deps.upstream, from: APP_VERSION };
  }
  await db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(KEY, JSON.stringify(c)).run();
  return c;
}

/** 版と更新の様子。force なら GitHub を読み直す */
export async function updateStatus(db: D1Database, deps: UpdateDeps, now: Date, force = false): Promise<AdminUpdate> {
  const c = await check(db, deps, now, force);
  const canDispatch = !!(deps.repo && deps.token);
  let runs: AdminUpdate['runs'] = [], error = c.error;
  if (canDispatch) {
    try {
      runs = await deps.api.runs(deps.repo, deps.token, UPDATE_WORKFLOW);
    } catch (e) {
      error = error || '更新の記録を読めませんでした（' + message(e) + '）';
    }
  }
  return {
    current: APP_VERSION, upstream: deps.upstream, latest: c.latest, available: !!c.latest && newer(c.latest.version, APP_VERSION), migrations: c.migrations,
    error, checkedAt: c.checkedAt, repo: deps.repo, workflowUrl: deps.repo ? 'https://github.com/' + deps.repo + '/actions/workflows/' + UPDATE_WORKFLOW : '',
    canDispatch, runs,
  };
}

/** 最新の版への更新を始める（更新のワークフローを動かす）。始めた版を返す */
export async function startUpdate(db: D1Database, deps: UpdateDeps, now = new Date()): Promise<string> {
  if (!deps.repo || !deps.token) throw new AppError(400, '管理画面から更新するには、Worker の secret に UPDATE_DISPATCH_TOKEN が要ります（README の「新しい版に上げる」）。GitHub の Actions の画面からも更新できます。');
  const c = await check(db, deps, now, false);
  if (!c.latest || !newer(c.latest.version, APP_VERSION)) throw new AppError(409, '新しい版はありません。「確かめ直す」で、もう一度 GitHub を見てください。');
  try {
    await deps.api.dispatch(deps.repo, deps.token, UPDATE_WORKFLOW, { version: c.latest.version });
  } catch (e) {
    throw new AppError(409, '更新を始められませんでした（' + message(e) + '）');
  }
  return c.latest.version;
}
