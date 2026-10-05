// リンクを貼ったときに出る見た目（OGP）。Discord などがリンクの中身を読みに来たときに、卓予定の名前・説明・画像を出す。
// 画面の骨組み（src/client/index.html）にも同じタグがあり、ここはそれを道ごとの文に書き換える。画像は public/og.png（npm run og-image）
import { esc } from '../lib/markup';

/** サービスの一言（画面の index.html の description と同じ） */
export const SITE_DESCRIPTION = 'TRPG の卓の予定を、Discord サーバーの仲間と管理する Web アプリ。みんなの都合・募集・日程調整・Discord への知らせを 1 か所で。';

export type OgPage = { title: string; description: string; url: string };

/**
 * リンクの中身を読みに来たもの（Discord・Slack・X・LINE など）か。ログインしないので、グループの画面へ来るとログインへ送られ、
 * Discord のログインのページの見た目が出てしまう。見分けて、ログインへ送らずに卓予定の見た目を返す
 */
const PREVIEW_BOT = /discordbot|twitterbot|slackbot|slack-imgproxy|facebookexternalhit|telegrambot|whatsapp|linkedinbot|skypeuripreview|embedly|iframely|mastodon|misskey|cardyb|bluesky|redditbot|pinterest|vkshare|applebot|googlebot|bingbot/i;
export const isPreviewBot = (userAgent: string | undefined) => PREVIEW_BOT.test(userAgent ?? '');

/** 頭に置く OGP のタグ。origin は公開しているアドレス（画像の URL を絶対の形にする） */
export function ogTags(origin: string, page: OgPage): string {
  return [
    `<meta name="description" content="${esc(page.description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="卓予定">',
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(page.url)}">`,
    `<meta property="og:image" content="${esc(origin)}/og.png">`,
    '<meta property="og:image:width" content="1600">',
    '<meta property="og:image:height" content="900">',
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('');
}

/** 画面の骨組みの HTML の OGP のタグを、この道のものに置き換える（骨組みのタグを消してから、頭の終わりに足す） */
export function withOg(html: string, origin: string, page: OgPage): string {
  const cleaned = html.replace(/<meta (?:property="og:[^"]*"|name="(?:description|twitter:card)")[^>]*>\s*/g, '');
  return cleaned.replace('</head>', ogTags(origin, page) + '</head>');
}
