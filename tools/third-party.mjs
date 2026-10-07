// 第三者のライセンスの断り書き（THIRD_PARTY_NOTICES.md）を書き出す。npm run notices
//   アプリ: package-lock.jsonの実行時の依存（devでないもの。自前の差し替えは除く）と、組み立てで入るもの（Tailwind CSSのCSS・アイコンの集まり）
//   サイト: ブラウザに入る部品（SITE_PACKAGES。VitePressの依存が変わったら見直す）と、アイコンの集まり
//   リポジトリに置いているもの: tools/yomiyasu
// 版・ライセンス・著作権の行は、node_modulesの各パッケージから読む。ライセンスの本文はtools/licenses/（MITはyomiyasuのLICENSEから）。
// test/client/third-party.test.jsが、書き出したものと今の依存が合っているかを確かめる
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
export const OUT = 'THIRD_PARTY_NOTICES.md';

/** 使い方のサイトのブラウザに入る部品（VitePressのテーマ・Vue・検索など） */
export const SITE_PACKAGES = ['vitepress', 'vue', '@vue/runtime-dom', '@vue/runtime-core', '@vue/reactivity', '@vue/shared', '@vueuse/core', '@vueuse/shared', 'minisearch', 'mark.js', 'focus-trap', 'tabbable'];
/** 組み立てたアプリのCSSに入るもの */
const BUILD_PACKAGES = { tailwindcss: '組み立てたCSS' };

/** パッケージのアドレス（GitHubならリポジトリ、無ければホームページかnpm） */
function urlOf(p, name) {
  const r = (typeof p.repository === 'string' ? p.repository : p.repository?.url ?? '').replace(/^github:/, '');
  const m = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#.*)?$/.exec(r) ?? /^([\w.-]+\/[\w.-]+)$/.exec(r);
  if (m) return 'https://github.com/' + m[1];
  return p.homepage || 'https://www.npmjs.com/package/' + name;
}

/** node_modulesの1つのパッケージ（dirはリポジトリからの道）の名前・版・ライセンス・アドレス・著作権の行 */
function pkgAt(dir, name, note = '') {
  const abs = path.join(root, dir);
  const p = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
  const file = fs.readdirSync(abs).find((f) => /^licen[cs]e/i.test(f));
  let copyright = file ? [...new Set(fs.readFileSync(path.join(abs, file), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^copyright\b/i.test(l)))] : [];
  // LICENSEのファイルが無いパッケージは、作者から
  if (!copyright.length && p.author) copyright = ['Copyright (c) ' + (typeof p.author === 'string' ? p.author.replace(/\s*[<(].*$/, '') : p.author.name)];
  return { name, note, version: p.version, license: p.license, url: urlOf(p, name), copyright };
}

/** アプリの実行時の依存（package-lock.jsonでdevでないもの。自前の差し替え（link）は除く） */
export function appPackages() {
  const lock = JSON.parse(read('package-lock.json')).packages;
  return Object.entries(lock)
    .filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !v.devOptional && !v.optional && !v.link)
    .map(([k]) => pkgAt(k, k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** 使ってよいアイコンの集まり（tools/icons.tsのALLOWED_ICON_SETS）。中身は@iconify-jsonの集まりの説明から */
function iconSets() {
  const sets = [...read('tools/icons.ts').matchAll(/^\s+'([\w-]+)': '[\w.-]+',/gm)].map((m) => m[1]);
  return sets.map((set) => {
    const dir = 'node_modules/@iconify-json/' + set;
    const info = JSON.parse(read(dir + '/info.json'));
    const p = JSON.parse(read(dir + '/package.json'));
    return { name: info.name, note: 'アイコン。' + p.name, version: p.version, license: info.license.spdx, url: info.author.url, copyright: [info.author.name] };
  });
}

/** リポジトリに置いているもの */
function vendored() {
  const lic = read('tools/yomiyasu/LICENSE');
  return [{ name: 'yomiyasu', note: '日本語の検査。`tools/yomiyasu/`', version: '—', license: 'MIT', url: 'https://github.com/nanaism/yomiyasu', copyright: lic.split('\n').filter((l) => /^copyright\b/i.test(l.trim())) }];
}

/** ライセンスの本文（SPDX → 見出しと本文） */
function licenseTexts() {
  const mit = read('tools/yomiyasu/LICENSE');
  // MITの本文は、著作権の行のあと（著作権の行は表に書く）
  const body = mit.slice(mit.indexOf('Permission is hereby granted'));
  return {
    MIT: { title: 'MIT License', text: body },
    'Apache-2.0': { title: 'Apache License 2.0', text: read('tools/licenses/Apache-2.0.txt') },
    Unlicense: { title: 'The Unlicense', text: read('tools/licenses/Unlicense.txt') },
  };
}

const cell = (s) => String(s).replace(/\|/g, '\\|');
function table(rows) {
  const lines = ['| 名前 | 版 | ライセンス | 著作権 |', '|---|---|---|---|'];
  for (const r of rows) lines.push(`| [${cell(r.name)}](${r.url})${r.note ? '（' + cell(r.note) + '）' : ''} | ${cell(r.version)} | ${cell(r.license)} | ${r.copyright.map(cell).join('<br>') || '—'} |`);
  return lines.join('\n');
}

/** THIRD_PARTY_NOTICES.mdの中身 */
export function render() {
  const icons = iconSets();
  const app = [...icons, ...Object.entries(BUILD_PACKAGES).map(([n, note]) => pkgAt('node_modules/' + n, n, note)), ...appPackages()];
  const site = [...icons, ...SITE_PACKAGES.map((n) => pkgAt('node_modules/' + n, n))];
  const repo = vendored();
  const texts = licenseTexts();
  const used = [...new Set([...app, ...site, ...repo].map((r) => r.license))];
  const missing = used.filter((l) => !texts[l]);
  if (missing.length) throw new Error('本文の無いライセンスがあります: ' + missing.join('、') + '（tools/licenses/ に本文を置き、tools/third-party.mjsに足す）');
  return [
    '# 第三者のライセンス',
    '',
    'Yokiが使っている、第三者のソフトウェアと素材の一覧です。Yokiそのもののライセンスは、[LICENSE](LICENSE)（MIT）にあります。',
    '',
    'このファイルは、`npm run notices`（`tools/third-party.mjs`）が書き出したものです。手では直さず、依存を変えたら書き出し直してください。',
    '',
    '## アプリ',
    '',
    '組み立てたアプリ（Workerと画面）に入り、設置したYokiから配られるものです。',
    '',
    table(app),
    '',
    '## 使い方のサイト',
    '',
    '使い方のサイト（`website/`）のブラウザに入るものです。',
    '',
    table(site),
    '',
    '## リポジトリに置いているもの',
    '',
    table(repo),
    '',
    '## ライセンスの本文',
    '',
    'MIT Licenseでは、上の表の著作権の行と、次の本文を組み合わせて読んでください。',
    ...Object.keys(texts).filter((k) => used.includes(k)).flatMap((k) => ['', '### ' + texts[k].title, '', '```text', texts[k].text.replace(/\s+$/, ''), '```']),
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.writeFileSync(path.join(root, OUT), render());
  console.log(OUT + ' を書き出しました');
}
