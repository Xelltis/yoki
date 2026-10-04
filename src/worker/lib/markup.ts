// 運営者が書く本文（利用規約・プライバシーポリシー）を HTML にする。書けるのは、見出し・箇条書き・番号付き・段落・リンクだけ。
// HTML のタグは使えない（そのまま文字で出す）
//   ## 見出し / ### 小見出し      「#」1〜2 個は h2、3 個からは h3
//   - 項目 / * 項目               箇条書き
//   1. 項目 / 1) 項目             番号付き
//   空行                          段落を分ける（続けて書いた行は、段落の中の改行になる）
//   [文字](URL)                   リンク（URL は https:// http:// mailto: か、/ で始まるこのサイトの道）
//   https://… と メールアドレス     そのままリンクになる
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]!);

/** [文字](URL)・URL・メールアドレス。URL とメールアドレスは英数字と記号だけ（後ろに続く日本語を巻き込まない） */
const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|\/(?!\/))[^\s()]*)\)|https?:\/\/[\w\-.~:/?#@!$&*+,;=%]+|[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g;

/** 1 行の中の文字。リンクのほかは逃がす */
export function inline(text: string): string {
  let out = '', last = 0;
  for (const m of text.matchAll(LINK)) {
    let whole = m[0], href: string, label: string;
    if (m[1] !== undefined) {
      label = m[1]; href = m[2]!;
    } else {
      // 文の終わりの句読点（「https://example.com.」の「.」）は、リンクに入れない
      whole = whole.replace(/[.,;:!?]+$/, '');
      label = whole; href = /^https?:/.test(whole) ? whole : 'mailto:' + whole;
    }
    out += esc(text.slice(last, m.index)) + '<a href="' + esc(href) + '">' + esc(label) + '</a>';
    last = m.index + whole.length;
  }
  return out + esc(text.slice(last));
}

type List = { tag: 'ul' | 'ol'; items: string[] };

/** 本文を HTML にする */
export function renderDoc(text: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: List | null = null;
  const flush = () => {
    if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    if (list) out.push('<' + list.tag + '>' + list.items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + list.tag + '>');
    para = []; list = null;
  };
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    const li = /^(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if (!line) {
      flush();
    } else if (h) {
      flush();
      const tag = h[1]!.length <= 2 ? 'h2' : 'h3';
      out.push('<' + tag + '>' + inline(h[2]!) + '</' + tag + '>');
    } else if (li) {
      const tag = li[1] ? 'ul' : 'ol';
      if (para.length || (list && (list as List).tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(li[2]!);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}
