// 運営の管理画面の「更新」。動いているバージョンと、元のリポジトリの最新のReleaseを比べる。新しければ、変わったことと表の変更があるかを出し、
// 公開しているリポジトリの更新のワークフローを動かす（update/config.ts）。GitHubを読むのは1時間に1回まで（metaのupdate_checkに控える）
import type { AdminUpdate } from '../../shared/admin';
import { AppError } from '../lib/errors';
import { UPDATE_WORKFLOW, type UpdateDeps } from '../update/config';
import { APP_VERSION } from '../version';

const KEY = 'update_check';
const TTL_MS = 3600_000;

/** 控える中身。upstreamとfrom（そのときの版）が今と違えば、読み直す */
type Check = Pick<AdminUpdate, 'latest' | 'migrations' | 'error' | 'checkedAt'> & { upstream: string; from: string };

/** 版（1.2.3。頭のvはあってもよい）を数の組にする。読めなければnull */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** aがbより新しい版か。どちらかが読めなければ偽 */
export function newer(a: string, b: string): boolean {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 最新のReleaseを読む（控えが1時間より新しければ控えを使う）。運営者への知らせ（operator-notice.ts）も使う */
export async function checkRelease(db: D1Database, deps: UpdateDeps, now: Date, force: boolean): Promise<Check> {
  const raw = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value');
  const saved = raw ? (JSON.parse(raw) as Check) : null;
  if (!force && saved && saved.upstream === deps.upstream && saved.from === APP_VERSION && now.getTime() - Date.parse(saved.checkedAt) < TTL_MS) return saved;
  let c: Check;
  try {
    // 更新のトークンがあれば、それで読む（トークンなしの上限は、Cloudflareのほかの利用者と分け合うため、すぐに尽きる）
    const rel = await deps.api.latestRelease(deps.upstream, deps.token);
    const latest = rel && { version: rel.tag.replace(/^v/, ''), name: rel.name, url: rel.url, publishedAt: rel.publishedAt, notes: rel.body };
    let migrations: boolean | null = null;
    if (latest && newer(latest.version, APP_VERSION)) {
      // 表の変更があるか。今の版のタグが元のリポジトリに無い（フォークで版を変えた）など、比べられなければ分からないまま
      migrations = await deps.api.changedFiles(deps.upstream, 'v' + APP_VERSION, rel.tag, deps.token).then((files) => files.some((f) => f.startsWith('migrations/')), () => null);
    }
    c = { latest, migrations, error: '', checkedAt: now.toISOString(), upstream: deps.upstream, from: APP_VERSION };
  } catch (e) {
    // 読めなければ、前に読めた最新のバージョンは残す。今の版より古ければ（読めたあとに更新した）残さない
    const keep = saved?.latest && !newer(APP_VERSION, saved.latest.version) ? saved : null;
    c = { latest: keep?.latest ?? null, migrations: keep?.migrations ?? null, error: '新しいバージョンを確かめられませんでした（' + message(e) + '）', checkedAt: now.toISOString(), upstream: deps.upstream, from: APP_VERSION };
  }
  await db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(KEY, JSON.stringify(c)).run();
  return c;
}

/** 版と更新の様子。forceならGitHubを読み直す */
export async function updateStatus(db: D1Database, deps: UpdateDeps, now: Date, force = false): Promise<AdminUpdate> {
  const c = await checkRelease(db, deps, now, force);
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
    checked: !c.error, error, checkedAt: c.checkedAt, repo: deps.repo, workflowUrl: deps.repo ? 'https://github.com/' + deps.repo + '/actions/workflows/' + UPDATE_WORKFLOW : '',
    canDispatch, runs,
  };
}

/** 最新のバージョンへの更新を始める（更新のワークフローを動かす）。始めた版を返す */
export async function startUpdate(db: D1Database, deps: UpdateDeps, now = new Date()): Promise<string> {
  if (!deps.repo || !deps.token) throw new AppError(400, '管理画面から更新するには、WorkerのsecretにUPDATE_DISPATCH_TOKENが要ります（使い方のサイトの「新しいバージョンに上げる」）。GitHubのActionsの画面からも更新できます。');
  const c = await checkRelease(db, deps, now, false);
  if (!c.latest || !newer(c.latest.version, APP_VERSION)) throw new AppError(409, '新しいバージョンはありません。「確かめ直す」で、もう一度GitHubを見てください。');
  try {
    await deps.api.dispatch(deps.repo, deps.token, UPDATE_WORKFLOW, { version: c.latest.version });
  } catch (e) {
    throw new AppError(409, '更新を始められませんでした（' + message(e) + '）');
  }
  return c.latest.version;
}
