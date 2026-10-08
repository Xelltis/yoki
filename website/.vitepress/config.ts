// Yokiのサイト（GitHub Pages）。紹介と使い方を載せる
//   npm run site         手元で開く（http://localhost:5174/yoki/）
//   npm run site:build   組み立てる（website/.vitepress/dist/）
import Icons from 'unplugin-icons/vite';
import { defineConfig, postcssIsolateStyles } from 'vitepress';

/** サイトを公開するアドレス（GitHub Pages）。baseと、SNSに貼ったときの画像・URLに使う */
const SITE_URL = 'https://xelltis.github.io/yoki/';
/** アプリを公開したアドレス（例: https://yoki.example.workers.dev/）。書くと、上のナビに「アプリを開く」が出る */
const APP_URL = '';

const base = new URL(SITE_URL).pathname;

export default defineConfig({
  lang: 'ja',
  title: 'Yoki',
  description: 'TRPGの卓の予定を、Discordサーバーの仲間と決めるWebアプリ。だれでも自分のCloudflareに設置できるOSS。',
  base,
  cleanUrls: true,
  vite: {
    // 開発サーバーは5174番（アプリの開発サーバーの5173番と並べて動かせる）
    server: { port: 5174 },
    // vp-rawを付けた部品（試せる例など）には、本文の見た目（表の罫線など）を当てない
    css: { postcss: { plugins: [postcssIsolateStyles({ includeFiles: [/vp-doc\.css/] })] } },
    // アイコン（~icons/<集まり>/<名前> をimportすると、SVGのVueの部品になる。使う名前はtheme/icons.ts）。大きさは1em
    plugins: [Icons({ compiler: 'vue3', scale: 1 })],
  },
  sitemap: { hostname: SITE_URL },
  head: [
    // アイコンはnpm run iconsがbrand/yoki.pngから書き出す（アプリと同じ絵）
    ['link', { rel: 'icon', href: base + 'favicon.ico', sizes: '32x32' }],
    ['link', { rel: 'icon', type: 'image/png', href: base + 'icon-192.png', sizes: '192x192' }],
    ['link', { rel: 'apple-touch-icon', href: base + 'apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#2d2afe' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    // 文字はアプリと同じNoto Sans JP（アイコンはSVGでJSに入っている。theme/icons.ts）
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400..700&display=swap' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Yoki' }],
    ['meta', { property: 'og:image', content: SITE_URL + 'og.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  // SNSに貼ったときの題名・説明・URLを、ページごとに出す
  transformHead({ pageData, title, description }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    return [
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: SITE_URL + path }],
    ];
  },
  // 注意書き（::: warning や > [!WARNING]）の見出しを日本語にする
  markdown: { container: { tipLabel: 'ヒント', warningLabel: '注意', dangerLabel: '危険', infoLabel: '情報', detailsLabel: 'くわしく', noteLabel: 'メモ', importantLabel: '大事', cautionLabel: '気を付ける' } },
  themeConfig: {
    logo: '/icon-192.png',
    nav: [
      { text: '始め方', link: '/guide/start' },
      { text: '使い方', link: '/guide/availability', activeMatch: '^/guide/(?!start)' },
      { text: '設置する', link: '/setup/', activeMatch: '^/setup/' },
      { text: 'GitHub', link: 'https://github.com/Xelltis/yoki' },
      ...(APP_URL ? [{ text: 'アプリを開く', link: APP_URL }] : []),
    ],
    // トップのページの下に出る（横の並びの無いページだけ）。OSSであることと、ライセンス・第三者のライセンスへのリンク
    footer: {
      message: 'Yokiは<a href="https://github.com/Xelltis/yoki">MIT LicenseのOSS</a>です。使っている部品のライセンスは<a href="https://github.com/Xelltis/yoki/blob/main/THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>にあります。',
    },
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
            { text: 'シナリオと通過', link: '/guide/scenario' },
            { text: '卓の準備（HO・キャラシ）', link: '/guide/prep' },
            { text: '最新の状態にする', link: '/guide/sync' },
            { text: 'カレンダーに出す', link: '/guide/calendar-sync' },
          ],
        },
        {
          text: 'GM',
          items: [
            { text: '卓を登録する', link: '/guide/register' },
            { text: '日程を決める', link: '/guide/decide' },
            { text: 'Discordに知らせる', link: '/guide/discord' },
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
      // Yokiを自分のCloudflareに設置する運営者向け
      '/setup/': [
        { text: '設置する', items: [{ text: '設置の手順', link: '/setup/' }, { text: 'Discordアプリを作る', link: '/setup/discord' }] },
        {
          text: '設置したあとに',
          items: [
            { text: '新しい版に上げる', link: '/setup/update' },
            { text: 'Googleと連携する', link: '/setup/google' },
            { text: '独自のドメインで公開する', link: '/setup/domain' },
            { text: '運営の管理画面', link: '/setup/admin' },
          ],
        },
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
    notFound: { title: 'ページが見つかりません', quote: 'URLが変わったか、ページが無くなったようです。', linkLabel: 'トップへ', linkText: 'トップへ戻る' },
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
