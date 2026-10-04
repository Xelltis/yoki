// 入れないとき・見つからないときに出す、短いお知らせのページ
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]!);

/** お知らせのページ。どのページにも、次に行く先のリンクを 1 つ付ける */
export function noticePage(title: string, message: string, link: { href: string; label: string }): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - 卓予定</title><link rel="icon" href="/icon.png">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.7 system-ui, sans-serif; background: #f3f5f8; color: #1d2433; }
  @media (prefers-color-scheme: dark) { body { background: #0b0f16; color: #e6ebf2; } .card { background: #151b26 !important; } }
  .card { max-width: 440px; margin: 16px; padding: 28px 32px; border-radius: 16px; background: #fff; box-shadow: 0 8px 30px rgba(0, 0, 0, .08); }
  h1 { font-size: 18px; margin: 0 0 8px; }
  a { color: #0e7490; font-weight: 600; }
</style></head>
<body><div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="${esc(link.href)}">${esc(link.label)}</a></p></div></body></html>`;
}
