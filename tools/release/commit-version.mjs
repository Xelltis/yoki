// semantic-releaseのプラグイン（.releaserc.json）。版を出すときに、package.jsonとpackage-lock.jsonのversionを新しい版にしてコミットし、
// mainへpushする。semantic-releaseは、prepareでできたコミットにタグを付ける（vX.Y.Zのタグの中身にも、同じ版が入る）。
// 版をファイルに持たせるのは、履歴とタグを持たない中身からも、同じ版で組み立てられるようにするため（アプリの版はpackage.jsonから読む。vite.config.tsのappVersion）。
// CIで動くので、Gitのフック（lefthook）は入っていない（lefthookはCIでは入らない）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BOT = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

/** package.jsonのいちばん上の "version" を書き換える（ほかの書き方はそのまま残す） */
export function setPackageVersion(text, version) {
  const out = text.replace(/^( {2}"version": ")[^"]*(")/m, `$1${version}$2`);
  if (out === text && !text.includes(`"version": "${version}"`)) throw new Error('package.jsonにversionがありません');
  return out;
}

/** package-lock.jsonの、このパッケージの版（いちばん上と packages[""]）を書き換える。npmと同じ形（2つの空白で字下げ、最後に改行）で書く */
export function setLockVersion(text, version) {
  const lock = JSON.parse(text);
  lock.version = version;
  lock.packages[''].version = version;
  return JSON.stringify(lock, null, 2) + '\n';
}

export async function prepare(_config, { cwd, env, nextRelease, options, branch, logger }) {
  const version = nextRelease.version;
  const pkg = path.join(cwd, 'package.json');
  const lock = path.join(cwd, 'package-lock.json');
  writeFileSync(pkg, setPackageVersion(readFileSync(pkg, 'utf8'), version));
  writeFileSync(lock, setLockVersion(readFileSync(lock, 'utf8'), version));
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  git('add', 'package.json', 'package-lock.json');
  // [skip ci]: このpushで、公開のワークフローをもう一度動かさない（GITHUB_TOKENのpushは、もともと動かさない）
  git(...BOT, 'commit', '-m', `chore(release): v${version} [skip ci]`);
  // options.repositoryUrlは、semantic-releaseがトークンを入れたアドレス（タグのpushと同じ）
  git('push', options.repositoryUrl, `HEAD:refs/heads/${branch.name}`);
  logger.log('package.jsonの版を %s にしてコミットしました', version);
}

