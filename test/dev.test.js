// 開発サーバーで動かすアプリの組み立て（dev/pages.js・mock/pages.js・tools/vite-plugin-gas-pages.js）。
// ブラウザの中で動くサーバー側（DEV_BACKEND）も Node の上で動かし、サンプルが作れて画面用のデータが返るかを見る。
// src/server を直してサンプルの下ごしらえ（dev/seed.js）が動かなくなったら、ここで落ちる
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { APP_URL, appPage, devBackend, indexPage, tutorialPage } from '../dev/pages.js';
import { mockV2Page } from '../mock/pages.js';
import gasPages from '../tools/vite-plugin-gas-pages.js';

describe('DEV_BACKEND（ブラウザの中で動くサーバー側）', () => {
  const context = vm.createContext({});
  vm.runInContext(devBackend(), context, { filename: 'DEV_BACKEND' });
  const backend = vm.runInContext('DEV_BACKEND', context);

  test('サンプルを作り、画面用のデータを返す', () => {
    backend.__seed();
    const d = backend.getConsoleData({});
    expect(d.needLogin).toBeUndefined();
    expect(d.title).toBe('卓予定');
    expect(d.members.map((m) => m.name)).toEqual(['ひより', 'ソラ', 'こまち', 'レン', 'ミナト', 'ユズ']);
    expect(d.sessions).toHaveLength(11);
    expect(d.sessions.filter((s) => s.status === '募集').map((s) => s.name).sort()).toEqual(['新キャンペーン顔合わせ', '雪原の古城']);
    expect(d.appUrl).toBe(APP_URL);
  });

  test('画面が呼ぶ関数がそろっている', () => {
    for (const name of ['getConsoleData', 'saveSession', 'setAvailability', 'setPollVote', 'sendDiscordStep']) {
      expect(typeof backend[name], name).toBe('function');
    }
  });
});

describe('ページ', () => {
  test('アプリ: 本物の画面に、ローカルで動かす部品が差し込まれる', () => {
    const html = appPage();
    const head = html.indexOf('<head>'), params = html.indexOf("localStorage.removeItem('taku.cache')");
    const backend = html.indexOf('var DEV_BACKEND'), stub = html.indexOf('google.script.run の代わり'), app = html.indexOf('var D = null;');
    expect(head).toBeGreaterThanOrEqual(0);
    expect(params).toBeGreaterThan(head);
    expect(backend).toBeGreaterThan(params);
    expect(stub).toBeGreaterThan(backend);
    expect(app).toBeGreaterThan(stub);
    expect(html).toContain('id="devBadge"');
    // サーバー側のコードの中の </script で、埋め込んだ <script> が途中で閉じないように
    expect(html.slice(backend, stub)).not.toMatch(/<\/script/i);
  });

  test('使い方のページ: 「アプリを開く」がアプリへ向く', () => {
    expect(tutorialPage()).toContain('<script>window.APP_URL = "/";</script>');
  });

  test('HtmlService が足すもの（文字コードと viewport）を、開発サーバーでも足す', () => {
    // 使い方のページの HTML は文字コードを書いていない（Apps Script は UTF-8 で返す）。無いとブラウザが文字化けする
    expect(tutorialPage().startsWith('<meta charset="utf-8">')).toBe(true);
    for (const html of [appPage(), tutorialPage()]) expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  test('index.html: doGet と同じく ?page=tutorial で使い方のページ、ほかはアプリ', () => {
    const at = (u) => indexPage({ url: new URL(u, 'http://localhost') });
    expect(at('/?page=tutorial')).toContain('function showAppLinks');
    expect(at('/')).toContain('var DEV_BACKEND');
    expect(at('/?page=other')).toContain('var DEV_BACKEND');
  });

  test('UI 2026 案 ver2: アプリに差し替えを重ねる', () => {
    const html = mockV2Page();
    expect(html).toContain('<title>卓予定（UI 2026 案 ver2）</title>');
    expect(html).toContain('UI 2026 案 ver2 の差し替え');
    expect(html.indexOf('UI 2026 案 ver2 の差し替え')).toBeGreaterThan(html.indexOf('id="devBadge"'));
  });
});

describe('Vite のプラグイン', () => {
  const plugin = gasPages({ pages: { 'index.html': ({ url }) => 'page=' + url.searchParams.get('page') } });
  plugin.configResolved({ root: '/repo' });
  const handle = (filename, originalUrl) => plugin.transformIndexHtml.handler('元の HTML', { filename, originalUrl, path: '/' });

  test('入口の HTML を、開いた URL を渡して作り直す', () => {
    expect(handle('/repo/index.html', '/?page=tutorial')).toBe('page=tutorial');
  });

  test('pages に無い入口はそのまま', () => {
    expect(handle('/repo/promo/x-announcement.html', '/promo/x-announcement.html')).toBe('元の HTML');
  });
});
