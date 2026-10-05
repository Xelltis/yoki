// Worker がその場で作るページ: 入れないとき・見つからないときの短いお知らせと、利用規約・プライバシーポリシー
import { type AdminLegal, LEGAL_KINDS, LEGAL_TITLES, type LegalKind } from '../../shared/admin';
import { fmtDateLong } from '../lib/jst';
import { esc, inline, renderDoc } from '../lib/markup';

/** どのページにも付ける頭のタグ（ファビコン・ホーム画面のアイコン・manifest・文字。画面の index.html と同じ） */
const HEAD_ICONS = '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#2d2afe">'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400..700&display=swap">';
/** 色（画面の src/client/styles/theme.css と同じ。明るい・端末のダーク） */
const COLORS = ':root { color-scheme: light dark; --bg: #f3f4ff; --card: #fff; --text: #15163a; --muted: #5d608a; --line: #e1e3fa; --link: #2421d6; --bar: #2d2afe; }'
  + ' @media (prefers-color-scheme: dark) { :root { --bg: #0c0d29; --card: #16173e; --text: #eceeff; --muted: #a2a5d4; --line: #2a2c66; --link: #a8c0ff; --bar: #2422c9; } }'
  + ' body { margin: 0; font-family: "Noto Sans JP", system-ui, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }'
  + ' .card { border-radius: 16px; background: var(--card); border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(21, 22, 58, .05), 0 6px 18px rgba(45, 42, 254, .06); }';

/** お知らせのページ。どのページにも、次に行く先のリンクを 1 つ付ける */
export function noticePage(title: string, message: string, link: { href: string; label: string }): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - 卓予定</title>${HEAD_ICONS}
<style>
  ${COLORS}
  body { min-height: 100vh; display: grid; place-items: center; font-size: 15px; line-height: 1.7; }
  .card { max-width: 440px; margin: 16px; padding: 28px 32px; border-top: 6px solid var(--bar); }
  .logo { display: block; width: 40px; height: 40px; margin-bottom: 14px; border-radius: 11px; }
  h1 { font-size: 19px; margin: 0 0 8px; }
  a { color: var(--link); font-weight: 700; }
</style></head>
<body><div class="card"><img class="logo" src="/icon-192.png" alt=""><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="${esc(link.href)}">${esc(link.label)}</a></p></div></body></html>`;
}

/** 利用規約・プライバシーポリシーのページ。上に運営者と問い合わせ先、下にもう一方への道を出す。JS は使わない */
export function legalPage(kind: LegalKind, legal: AdminLegal): string {
  const doc = legal[kind], title = LEGAL_TITLES[kind];
  const unset = '<span class="unset">まだ設定されていません</span>';
  const links = LEGAL_KINDS.map((k) => (k === kind ? '<span>' + LEGAL_TITLES[k] + '</span>' : '<a href="/' + k + '">' + LEGAL_TITLES[k] + '</a>')).join('') + '<a href="/">卓予定の入口へ</a>';
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - 卓予定</title>${HEAD_ICONS}
<style>
  ${COLORS}
  body { font-size: 15px; line-height: 1.8; }
  header { background: var(--bar); }
  .brand { display: inline-flex; align-items: center; gap: 10px; padding: 12px 20px; color: #fff; font-size: 17px; font-weight: 700; text-decoration: none; }
  .brand img { width: 32px; height: 32px; border-radius: 9px; box-shadow: 0 0 0 2px rgba(255, 255, 255, .9); }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { padding: 28px 32px; overflow-wrap: anywhere; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  h2 { font-size: 18px; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
  h3 { font-size: 15px; margin: 20px 0 4px; }
  ul, ol { padding-left: 1.5em; }
  li + li { margin-top: 4px; }
  a { color: var(--link); }
  dl.who { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; margin: 0 0 8px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 12px; font-size: 14px; }
  dl.who dt { color: var(--muted); }
  dl.who dd { margin: 0; }
  .unset { color: var(--muted); }
  nav { display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: center; margin-top: 20px; font-size: 14px; }
  nav span { color: var(--muted); }
  @media (max-width: 600px) { .card { padding: 20px 18px; } dl.who { grid-template-columns: 1fr; } dl.who dd { margin-bottom: 6px; } }
</style></head>
<body><header><a class="brand" href="/"><img src="/icon-192.png" alt="">卓予定</a></header><main>
<article class="card">
<h1>${title}</h1>
<dl class="who"><dt>運営者</dt><dd>${legal.operator ? esc(legal.operator) : unset}</dd><dt>問い合わせ先</dt><dd>${legal.contact ? inline(legal.contact) : unset}</dd><dt>更新日</dt><dd>${fmtDateLong(doc.updatedAt)}</dd></dl>
${renderDoc(doc.text)}
</article>
<nav>${links}</nav>
</main></body></html>`;
}
