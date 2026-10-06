// 日本語の文書の検査。yomiyasu（https://github.com/nanaism/yomiyasu）のyomiyasu_lint.pyを、tools/yomiyasu/ に本家のまま置いて使う。
//   node tools/lint-ja.mjs            … Gitに入っているMarkdownを全部（README・CLAUDE.md・docs・サイトの本文）
//   node tools/lint-ja.mjs a.md b.md  … 渡したファイルだけ（lefthookがコミットするMarkdownを渡す）
// 指摘（warn・error）が1件でもあれば止まる（yomiyasuの --strictと同じ）。info（「AではなくB」）は止めない
import { execFileSync, spawnSync } from 'node:child_process';

const LINT = 'tools/yomiyasu/yomiyasu_lint.py';
const args = process.argv.slice(2).filter((f) => f.endsWith('.md'));
const files = (args.length ? args : execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n'))
  .filter((f) => f && !f.startsWith('tools/yomiyasu/'));

let count = 0;
for (const file of files) {
  // -B: 読み込んだスクリプトの控え（__pycache__）をリポジトリに書かない
  const r = spawnSync('python3', ['-B', LINT, file, '--json'], { encoding: 'utf8' });
  if (r.error || r.status === 2) {
    console.error(r.error ? 'python3が見つかりません（yomiyasuの検査に要ります）' : r.stderr);
    process.exit(2);
  }
  for (const f of JSON.parse(r.stdout).findings) {
    if (f.severity === 'info') continue;
    count++;
    console.log(`${file}:${f.line} [${f.rule}] ${f.message}\n  > ${f.snippet}`);
  }
}
if (count) {
  console.log(`\n日本語の検査（yomiyasu）: ${count}件の指摘があります。`);
  process.exit(1);
}
