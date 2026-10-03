// Vite（開発サーバー）と Vitest（test/）の設定。
//   npm run dev   開発サーバー。http://localhost:5173/ で、アプリが Apps Script もシートも無しに動く。
//                 サーバー側はブラウザの中でモックの上で動き、サンプルデータで始まる。src/ を直すと画面が読み込み直される
//   npm test      テスト
import { defineConfig } from 'vite';
import { indexPage } from './dev/pages.js';
import { mockV2Page } from './mock/pages.js';
import gasPages from './tools/vite-plugin-gas-pages.js';

// 入口の HTML と、その中身を作る関数。ここに無い入口（mock/ui2026-v1.html・promo/x-announcement.html）はファイルのまま出す
const pages = {
  'index.html': indexPage,
  'mock/ui2026-v2.html': mockV2Page,
};

const links = [
  ['アプリ', '/'],
  ['使い方', '/?page=tutorial'],
  ['UI 2026 案 ver1', '/mock/ui2026-v1.html'],
  ['UI 2026 案 ver2', '/mock/ui2026-v2.html'],
  ['X 用の告知画像', '/promo/x-announcement.html'],
];

export default defineConfig({
  plugins: [gasPages({ pages, links, watch: ['src', 'test/mock_gas.js', 'dev', 'mock'] })],
  test: {
    include: ['test/**/*.test.js'],
    // Apps Script のスクリプトはタイムゾーン Asia/Tokyo で動く（src/appsscript.json）。テストも同じにする
    env: { TZ: 'Asia/Tokyo' },
  },
});
