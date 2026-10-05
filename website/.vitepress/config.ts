// 卓予定のサイト（GitHub Pages）。紹介と使い方を載せる
//   npm run site         手元で開く（http://localhost:5174/yoki/）
//   npm run site:build   組み立てる（website/.vitepress/dist/）
import { defineConfig, postcssIsolateStyles } from 'vitepress';

/** サイトを公開するアドレス（GitHub Pages）。base と、SNS に貼ったときの画像・URL に使う */
const SITE_URL = 'https://xelltis.github.io/yoki/';
/** アプリを公開したアドレス（例: https://yoki.example.workers.dev/）。書くと、上のナビに「アプリを開く」が出る */
const APP_URL = '';

/** 本文と部品で使う Material Symbols の名前（アルファベット順）。足したら、ここにも足す（テストが確かめる） */
export const ICONS = [
  'add', 'arrow_back', 'block', 'calendar_month', 'campaign', 'check', 'check_circle', 'date_range', 'edit_calendar', 'event',
  'event_available', 'flag', 'help', 'how_to_vote', 'login', 'logout', 'notifications', 'play_circle', 'refresh',
  'restart_alt', 'settings', 'shield', 'sticky_note_2', 'task_alt', 'touch_app', 'visibility',
];

const base = new URL(SITE_URL).pathname;

export default defineConfig({
  lang: 'ja',
  title: '卓予定',
  description: 'TRPG の卓の予定を、Discord サーバーの仲間と決める Web アプリ。',
  base,
  cleanUrls: true,
  vite: {
    // 開発サーバーは 5174 番（アプリの開発サーバーの 5173 番と並べて動かせる）
    server: { port: 5174 },
    // vp-raw を付けた部品（試せる例など）には、本文の見た目（表の罫線など）を当てない
    css: { postcss: { plugins: [postcssIsolateStyles({ includeFiles: [/vp-doc\.css/] })] } },
  },
  sitemap: { hostname: SITE_URL },
  head: [
    // アイコンは npm run icons が brand/yoki.png から書き出す（アプリと同じ絵）
    ['link', { rel: 'icon', href: base + 'favicon.ico', sizes: '32x32' }],
    ['link', { rel: 'icon', type: 'image/png', href: base + 'icon-192.png', sizes: '192x192' }],
    ['link', { rel: 'apple-touch-icon', href: base + 'apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#2d2afe' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0&icon_names=' + ICONS.join(',') + '&display=block' }],
    // 文字はアプリと同じ Noto Sans JP
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400..700&display=swap' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: '卓予定' }],
    ['meta', { property: 'og:image', content: SITE_URL + 'og.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  // SNS に貼ったときの題名・説明・URL を、ページごとに出す
  transformHead({ pageData, title, description }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    return [
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: SITE_URL + path }],
    ];
  },
  themeConfig: {
    logo: '/icon-192.png',
    nav: [
      { text: '始め方', link: '/guide/start' },
      { text: '使い方', link: '/guide/availability', activeMatch: '^/guide/(?!start)' },
      ...(APP_URL ? [{ text: 'アプリを開く', link: APP_URL }] : []),
    ],
    sidebar: {
      '/guide/': [
        { text: 'はじめる', items: [{ text: '始め方', link: '/guide/start' }] },
        {
          text: 'みんな',
          items: [
            { text: '予定を入れる', link: '/guide/availability' },
            { text: 'カレンダーを読む', link: '/guide/calendar' },
            { text: '卓に参加する', link: '/guide/join' },
            { text: '日程調整に答える', link: '/guide/vote' },
            { text: '最新の状態にする', link: '/guide/sync' },
          ],
        },
        {
          text: 'GM',
          items: [
            { text: '卓を登録する', link: '/guide/register' },
            { text: '日程を決める', link: '/guide/decide' },
            { text: 'Discord に知らせる', link: '/guide/discord' },
          ],
        },
        {
          text: '管理者',
          items: [
            { text: 'メンバーと管理者', link: '/guide/members' },
            { text: '管理画面', link: '/guide/admin' },
          ],
        },
        { text: '困ったとき', items: [{ text: 'よくある質問', link: '/guide/faq' }] },
      ],
    },
    outline: { level: [2, 3], label: 'このページの内容' },
    docFooter: { prev: '前のページ', next: '次のページ' },
    darkModeSwitchLabel: '見た目',
    lightModeSwitchTitle: 'ライトにする',
    darkModeSwitchTitle: 'ダークにする',
    sidebarMenuLabel: 'メニュー',
    returnToTopLabel: '上に戻る',
    skipToContentLabel: '本文へ',
    notFound: { title: 'ページが見つかりません', quote: 'URL が変わったか、ページが無くなったようです。', linkLabel: 'トップへ', linkText: 'トップへ戻る' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '検索', buttonAriaLabel: '検索' },
          modal: {
            displayDetails: '詳しく表示',
            resetButtonTitle: '消す',
            backButtonTitle: '閉じる',
            noResultsText: '見つかりませんでした',
            footer: { selectText: '開く', navigateText: '選ぶ', closeText: '閉じる' },
          },
        },
        // 日本語は語の間に空白が無いので、ブラウザの単語の区切り（Intl.Segmenter）で語に分ける。
        // 関数は文字列にしてブラウザへ渡されるので、外の変数を使わずに書く
        miniSearch: {
          options: {
            tokenize: (text: string) => Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)).filter((s) => s.isWordLike).map((s) => s.segment),
          },
          searchOptions: { combineWith: 'AND', prefix: true, fuzzy: false },
        },
      },
    },
  },
});
