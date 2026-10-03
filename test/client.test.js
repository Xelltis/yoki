// 画面の HTML（src/client）。<script> の構文と、doGet と同じ組み立て（CSS と JS の差し込み）を確かめる。
// DOM は無いので、画面のスクリプトは実行しない（動きは開発サーバー npm run dev で開いて確かめる）
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { htmlFiles, render } from '../tools/gas-project.js';

const files = htmlFiles();

describe('<script> の構文', () => {
  const scripts = Object.entries(files).flatMap(([name, html]) =>
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m, i) => [name + ' script#' + i, m[1]]));
  test.each(scripts)('%s', (label, body) => {
    expect(() => new vm.Script(body, { filename: label })).not.toThrow();
  });
});

describe('画面の組み立て', () => {
  test.each([
    ['client/Console', 'client/ConsoleCss', 'client/ConsoleJs'],
    ['client/Tutorial', 'client/TutorialCss', 'client/TutorialJs'],
  ])('%s に CSS と JS が差し込まれる', (page, css, js) => {
    const html = render(page);
    expect(html).toContain(files[css]);
    expect(html).toContain(files[js]);
    expect(html).not.toContain('include_');
  });
});
