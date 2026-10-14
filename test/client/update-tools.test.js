// 版を出す・更新するときの道具: package.jsonの版の書き換え（tools/release）と、ボタンで設置したリポジトリのwrangler.jsoncの引き継ぎ・
// 更新の手順（tools/update）
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { setLockVersion, setPackageVersion } from '../../tools/release/commit-version.mjs';
import { carry, parseJsonc } from '../../tools/update/carry-wrangler.mjs';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('版を出すと、package.jsonのいちばん上のversionだけが変わり、package-lock.jsonはnpmと同じ形のまま', () => {
  const pkg = read('package.json');
  const next = setPackageVersion(pkg, '9.8.7');
  expect(JSON.parse(next).version).toBe('9.8.7');
  expect(next.split('\n').filter((l, i) => l !== pkg.split('\n')[i])).toEqual(['  "version": "9.8.7",']);
  const lock = read('package-lock.json');
  expect(setLockVersion(lock, JSON.parse(lock).version)).toBe(lock);
  const bumped = JSON.parse(setLockVersion(lock, '9.8.7'));
  expect([bumped.version, bumped.packages[''].version]).toEqual(['9.8.7', '9.8.7']);
  expect(() => setPackageVersion('{\n  "name": "x"\n}\n', '1.0.0')).toThrow();
});

test('アプリの版はpackage.jsonから読む（ボタンで設置したリポジトリにはタグが無い）', () => {
  expect(read('vite.config.ts')).toMatch(/appVersion[\s\S]*package\.json/);
  expect(JSON.parse(read('package.json')).version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('JSONCを読む: コメント・閉じる前のカンマ・文字列の中の // を正しく扱う', () => {
  expect(parseJsonc('{\n  // c\n  "a": "http://x", /* b */ "b": [1, 2,],\n}')).toEqual({ a: 'http://x', b: [1, 2] });
  // リポジトリのwrangler.jsoncも読める
  expect(parseJsonc(read('wrangler.jsonc')).d1_databases[0].binding).toBe('DB');
});

test('更新でwrangler.jsoncを入れ替えるとき、Workerの名前とD1の名前・IDを引き継ぐ。コメントは新しい版のまま', () => {
  const next = read('wrangler.jsonc');
  // Cloudflareが書き換えたもの（コメントが無く、字下げがタブでもよい）
  const current = JSON.stringify({ name: 'my-yoki', d1_databases: [{ binding: 'DB', database_name: 'my-db', database_id: 'abc-123', migrations_dir: './migrations' }] }, null, '\t');
  const out = carry(current, next);
  const v = parseJsonc(out);
  expect(v.name).toBe('my-yoki');
  expect(v.d1_databases).toEqual([{ binding: 'DB', database_name: 'my-db', database_id: 'abc-123', migrations_dir: './migrations' }]);
  expect(out).toContain('// YokiのWorkerの設定');
  // 新しい版にIDの行があれば、値だけを替える。もう一度引き継いでも同じ
  expect(carry(current, out)).toBe(out);
  // D1が無い（引き継ぐものが無い）なら、名前だけ
  expect(parseJsonc(carry('{ "name": "only" }', next)).d1_databases[0].database_id).toBeUndefined();
});

test('更新のワークフローは、管理画面が入れ方を案内するときの写し（tools/update/workflow.yml）と同じ中身', () => {
  // ボタンで作ったリポジトリには .github/workflows/ が無いので、Workerは写しのほうを読む
  expect(read('.github/workflows/update.yml')).toBe(read('tools/update/workflow.yml'));
  expect(read('tools/update/workflow.yml')).toContain('tools/update/update.sh');
});

/**
 * 更新の手順（tools/update/update.sh）を、手元の仮のリポジトリで動かす。
 * 元のリポジトリ（https://github.com/o/u.git をGitのinsteadOfで手元に向ける）にv1.0.0とv1.1.0を作る。
 * 設置した人のリポジトリは、push先（裸のリポジトリ）と、そこから取り出した作業の場所。ghは呼ばれた引数を控えるだけの偽物
 */
describe('更新の手順', () => {
  let tmp = '';
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** 仮の場所を作り、gitを動かす関数などを返す */
  function setup() {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-update-'));
    const up = path.join(tmp, 'up'), origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work'), bin = path.join(tmp, 'bin');
    const ghLog = path.join(tmp, 'gh.log'), summary = path.join(tmp, 'summary.md'), runner = path.join(tmp, 'runner');
    fs.mkdirSync(bin);
    fs.mkdirSync(runner);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "$*" >> "$GH_LOG"\n', { mode: 0o755 });
    const env = {
      PATH: bin + path.delimiter + process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.file://' + up + '.insteadOf', GIT_CONFIG_VALUE_0: 'https://github.com/o/u.git',
      GH_LOG: ghLog, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: runner, UPSTREAM: 'o/u', UPDATE_TOKEN: '', DEPLOY_WITH_ACTIONS: '',
    };
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
    const put = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
    /** 元のリポジトリに版を作る（package.jsonの版・アプリのファイル・ワークフローを変えてタグを付ける） */
    const release = (version, app, workflows) => {
      put(up, 'package.json', JSON.stringify({ name: 'yoki', version }) + '\n');
      put(up, 'src/app.txt', app);
      for (const w of workflows) put(up, '.github/workflows/' + w, 'name: ' + w + '\n');
      git(up, 'add', '-A');
      git(up, 'commit', '-q', '-m', 'v' + version);
      git(up, 'tag', 'v' + version);
    };
    fs.mkdirSync(up);
    git(up, 'init', '-q', '-b', 'main');
    for (const f of ['wrangler.jsonc', 'tools/update/carry-wrangler.mjs', 'tools/update/update.sh']) put(up, f, read(f));
    release('1.0.0', 'v1.0\n', ['update.yml']);
    release('1.1.0', 'v1.1\n', ['update.yml', 'deploy.yml']);
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    /** 更新のワークフローと同じに、版のタグをfetchしてから手順を動かす。終わったときの番号を返す */
    const run = (tag, extra = {}) => {
      git(work, 'fetch', '-q', '--no-tags', 'https://github.com/o/u.git', 'refs/tags/' + tag + ':refs/tags/' + tag);
      const script = path.join(runner, 'update.sh');
      fs.writeFileSync(script, git(work, 'show', tag + ':tools/update/update.sh') + '\n');
      return spawnSync('bash', [script], { cwd: work, env: { ...env, ...extra, TAG: tag }, encoding: 'utf8' }).status;
    };
    const gh = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '');
    /** push先のmainにあるファイル */
    const files = (ref = 'main') => git(origin, 'ls-tree', '-r', '--name-only', ref).split('\n');
    const show = (ref, file) => git(origin, 'show', ref + ':' + file);
    return { up, origin, work, git, put, run, gh, files, show };
  }

  /** ボタンで作ったリポジトリ: v1.0.0の中身を1つのコミットにしたもの。Cloudflareは .github/ を写さず、wrangler.jsoncに値を書く */
  function buttonRepo(s) {
    fs.mkdirSync(s.work);
    s.git(s.work, 'init', '-q', '-b', 'main');
    s.git(s.work, 'remote', 'add', 'origin', s.origin);
    s.git(s.up, 'archive', '--format=tar', '-o', path.join(tmp, 'v1.tar'), 'v1.0.0');
    execFileSync('tar', ['-xf', path.join(tmp, 'v1.tar'), '-C', s.work, '--exclude=.github']);
    s.put(s.work, 'wrangler.jsonc', JSON.stringify({ name: 'my-yoki', d1_databases: [{ binding: 'DB', database_name: 'my-db', database_id: 'abc-123', migrations_dir: './migrations' }] }, null, '\t'));
    s.git(s.work, 'add', '-A');
    s.git(s.work, 'commit', '-q', '-m', 'Initial commit');
    // 運営者が1回だけ入れる更新のワークフロー
    s.put(s.work, '.github/workflows/update.yml', 'name: mine\n');
    s.git(s.work, 'add', '-A');
    s.git(s.work, 'commit', '-q', '-m', '更新のワークフローを入れる');
    s.git(s.work, 'push', '-q', 'origin', 'HEAD:main');
  }

  test('ボタンで作ったリポジトリは、新しい版のファイルで入れ替えてmainに入れる。.github/ はそのまま残し、wrangler.jsoncの値は引き継ぐ', () => {
    const s = setup();
    buttonRepo(s);
    expect(s.run('v1.1.0')).toBe(0);
    expect(s.show('main', 'src/app.txt')).toBe('v1.1');
    expect(JSON.parse(s.show('main', 'package.json')).version).toBe('1.1.0');
    // 新しい版のワークフロー（deploy.yml）は入れず、運営者が入れた更新のワークフローを残す（Actionsの既定のトークンで書き込めるように）
    expect(s.files().filter((f) => f.startsWith('.github/'))).toEqual(['.github/workflows/update.yml']);
    expect(s.show('main', '.github/workflows/update.yml')).toBe('name: mine');
    const w = parseJsonc(s.show('main', 'wrangler.jsonc'));
    expect([w.name, w.d1_databases[0].database_id]).toEqual(['my-yoki', 'abc-123']);
    expect(s.gh()).toBe('');
    // 同じ版をもう一度取り込もうとしても、何もしない
    s.git(s.work, 'pull', '-q', 'origin', 'main');
    const head = s.git(s.origin, 'rev-parse', 'main');
    expect(s.run('v1.1.0')).toBe(0);
    expect(s.git(s.origin, 'rev-parse', 'main')).toBe(head);
  });

  test('ボタンで作ったリポジトリのコードを変えていたら、mainを変えずにPRを作って止まる', () => {
    const s = setup();
    buttonRepo(s);
    s.put(s.work, 'src/app.txt', 'mine\n');
    s.git(s.work, 'commit', '-q', '-am', '手で直す');
    s.git(s.work, 'push', '-q', 'origin', 'HEAD:main');
    expect(s.run('v1.1.0')).toBe(1);
    expect(s.show('main', 'src/app.txt')).toBe('mine');
    expect(s.show('update/v1.1.0', 'src/app.txt')).toBe('v1.1');
    expect(s.gh()).toMatch(/^pr create --base main --head update\/v1\.1\.0 /);
  });

  test('フォークは、版のタグをマージする。GitHub Actionsで公開するなら、公開のワークフローを動かす', () => {
    const s = setup();
    s.git(tmp, 'clone', '-q', s.up, s.work);
    s.git(s.work, 'checkout', '-q', '-B', 'main', 'v1.0.0');
    s.git(s.work, 'remote', 'set-url', 'origin', s.origin);
    s.git(s.work, 'push', '-q', 'origin', 'main');
    expect(s.run('v1.1.0', { DEPLOY_WITH_ACTIONS: 'true' })).toBe(0);
    expect(s.show('main', 'src/app.txt')).toBe('v1.1');
    expect(s.files()).toContain('.github/workflows/deploy.yml');
    expect(s.git(s.origin, 'tag')).toBe('v1.1.0');
    expect(s.gh()).toBe('workflow run deploy.yml --ref main\n');
  });
});
