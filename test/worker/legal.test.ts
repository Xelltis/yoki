// 利用規約とプライバシーポリシー: 本文の書き方（lib/markup.ts）、/terms・/privacy のページ、運営者の API（/api/admin/legal）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminLegal } from '../../src/shared/admin';
import { DEFAULT_LEGAL, DEFAULT_LEGAL_DATE } from '../../src/worker/domain/legal-text';
import { jst } from '../../src/worker/lib/jst';
import { inline, renderDoc } from '../../src/worker/lib/markup';
import { call, loginAs, postJson } from './helpers';

describe('本文の書き方', () => {
  test('見出し・箇条書き・番号付き・段落。続けて書いた行は段落の中の改行', () => {
    expect(renderDoc('# 大\n## 中\n### 小\n#### もっと小')).toBe('<h2>大</h2>\n<h2>中</h2>\n<h3>小</h3>\n<h3>もっと小</h3>');
    expect(renderDoc('はじめ\nつづき\n\n次の段落')).toBe('<p>はじめ<br>つづき</p>\n<p>次の段落</p>');
    expect(renderDoc('- あ\n* い\n1. う\n2) え')).toBe('<ul><li>あ</li><li>い</li></ul>\n<ol><li>う</li><li>え</li></ol>');
    // 段落のすぐ後の箇条書き、箇条書きのすぐ後の段落は、分ける
    expect(renderDoc('前置き\n- 項目\nあとがき')).toBe('<p>前置き</p>\n<ul><li>項目</li></ul>\n<p>あとがき</p>');
    // 印のあとに空白が無ければ、ただの文。改行は \r\n でも \r でもよい
    expect(renderDoc('-ではない\r\n#でもない\r  前後の空白は除く  ')).toBe('<p>-ではない<br>#でもない<br>前後の空白は除く</p>');
    expect(renderDoc('')).toBe('');
  });

  test('HTML は使えない（文字で出す）', () => {
    expect(renderDoc('<script>alert("x")</script> & \'')).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;</p>');
    expect(renderDoc('## <b>太</b>')).toBe('<h2>&lt;b&gt;太&lt;/b&gt;</h2>');
  });

  test('リンク: [文字](URL)・URL・メールアドレス。文の終わりの句読点と、続く日本語は入れない', () => {
    expect(inline('[規約](/terms)と[外](https://example.com/a?b=1&c=2)')).toBe('<a href="/terms">規約</a>と<a href="https://example.com/a?b=1&amp;c=2">外</a>');
    expect(inline('[メール](mailto:op@example.com)')).toBe('<a href="mailto:op@example.com">メール</a>');
    expect(inline('https://example.com/contact。こちらへ')).toBe('<a href="https://example.com/contact">https://example.com/contact</a>。こちらへ');
    expect(inline('見て https://example.com/x. 次')).toBe('見て <a href="https://example.com/x">https://example.com/x</a>. 次');
    expect(inline('連絡は op.yoki+web@mail.example.jp まで')).toBe('連絡は <a href="mailto:op.yoki+web@mail.example.jp">op.yoki+web@mail.example.jp</a> まで');
    // 使えない URL（javascript: や // で始まるもの）は、リンクにしない
    expect(inline('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    expect(inline('[x](//evil.example)')).toBe('[x](//evil.example)');
    expect(inline('リンクなし')).toBe('リンクなし');
  });

  test('既定の文は、見出しと箇条書きのある HTML になる', () => {
    const terms = renderDoc(DEFAULT_LEGAL.terms);
    expect(terms).toContain('<h2>1. 本サービス</h2>');
    expect(terms).toContain('<a href="/privacy">プライバシーポリシー</a>');
    expect(renderDoc(DEFAULT_LEGAL.privacy)).toContain('<h3>Discord から受け取るもの</h3>');
  });
});

const OP = { id: '400000000000000099', name: '運営' };
let op = '';
let logs: string[] = [];
beforeEach(async () => {
  op = await loginAs(OP, []);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)); });
});
afterEach(() => vi.restoreAllMocks());

const page = async (path: string) => {
  const res = await call(path);
  return { status: res.status, type: res.headers.get('Content-Type'), html: await res.text() };
};
const getLegal = async () => (await (await call('/api/admin/legal', { sid: op })).json()) as AdminLegal;
const save = async (body: Record<string, unknown>, sid = op) => {
  const res = await postJson('/api/admin/legal', body, sid);
  return { status: res.status, body: (await res.json()) as { message?: string; error?: string } };
};
const today = () => jst(new Date()).ymd;
const metaKeys = async () => (await env.DB.prepare("SELECT key FROM meta WHERE key LIKE 'legal%' ORDER BY key").all<{ key: string }>()).results.map((r) => r.key);

describe('ページ', () => {
  test('直していなければ既定の文。運営者と問い合わせ先は「まだ設定されていません」。ログインしなくても読める', async () => {
    const t = await page('/terms');
    expect(t.status).toBe(200);
    expect(t.type).toContain('text/html');
    expect(t.html).toContain('<title>利用規約 - 卓予定</title>');
    expect(t.html).toContain('<h1>利用規約</h1>');
    expect(t.html).toContain('<dt>運営者</dt><dd><span class="unset">まだ設定されていません</span></dd>');
    expect(t.html).toContain('<dt>更新日</dt><dd>2026年10月5日</dd>');
    expect(t.html).toContain('<h2>7. 保証と責任</h2>');
    // もう一方のページへの道。いまのページはリンクにしない
    expect(t.html).toContain('<span>利用規約</span><a href="/privacy">プライバシーポリシー</a>');
    const p = await page('/privacy');
    expect(p.html).toContain('<h1>プライバシーポリシー</h1>');
    expect(p.html).toContain('<a href="/terms">利用規約</a><span>プライバシーポリシー</span>');
  });
});

describe('運営者の API', () => {
  test('はじめは既定の文で、運営者と問い合わせ先は空', async () => {
    const d = await getLegal();
    expect(d).toEqual({
      operator: '', contact: '',
      terms: { text: DEFAULT_LEGAL.terms, custom: false, updatedAt: DEFAULT_LEGAL_DATE, defaultText: DEFAULT_LEGAL.terms },
      privacy: { text: DEFAULT_LEGAL.privacy, custom: false, updatedAt: DEFAULT_LEGAL_DATE, defaultText: DEFAULT_LEGAL.privacy },
    });
  });

  test('運営者の名前・問い合わせ先・本文を保存すると、ページに出る。直した本文の更新日は今日。監査の控えを出す', async () => {
    const r = await save({ operator: ' <卓>運営 ', contact: 'https://example.com/contact', terms: '## 決まり\r\n- 仲良く\r\n', privacy: DEFAULT_LEGAL.privacy });
    expect(r).toEqual({ status: 200, body: { ok: true, message: '利用規約とプライバシーポリシーの設定を保存しました。' } });
    const d = await getLegal();
    expect(d).toMatchObject({ operator: '<卓>運営', contact: 'https://example.com/contact', terms: { text: '## 決まり\n- 仲良く', custom: true, updatedAt: today() }, privacy: { custom: false } });
    const t = (await page('/terms')).html;
    expect(t).toContain('<dt>運営者</dt><dd>&lt;卓&gt;運営</dd>');
    expect(t).toContain('<dt>問い合わせ先</dt><dd><a href="https://example.com/contact">https://example.com/contact</a></dd>');
    expect(t).toContain('<h2>決まり</h2>\n<ul><li>仲良く</li></ul>');
    expect(t).toContain('<dd>' + jst(new Date()).year + '年');
    // プライバシーポリシーは既定の文のまま（行を作らない）
    expect((await page('/privacy')).html).toContain('<dt>更新日</dt><dd>2026年10月5日</dd>');
    expect(await metaKeys()).toEqual(['legal_contact', 'legal_operator', 'legal_terms']);
    expect(logs.map((l) => JSON.parse(l))).toEqual([{ audit: 'operator', by: OP.id, action: 'setLegal', target: 'legal', operator: ' <卓>運営 ', contact: 'https://example.com/contact', changed: ['terms'] }]);
  });

  test('本文が変わらなければ更新日はそのまま。省いた項目は変えない', async () => {
    await save({ operator: '運営', terms: '決まり' });
    await env.DB.prepare("UPDATE meta SET value = ? WHERE key = 'legal_terms'").bind(JSON.stringify({ text: '決まり', at: '2026-01-02' })).run();
    await save({ terms: '決まり\n' });
    expect((await getLegal()).terms).toMatchObject({ text: '決まり', updatedAt: '2026-01-02' });
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ operator: null, contact: null, changed: [] });
    await save({ terms: '新しい決まり' });
    expect(await getLegal()).toMatchObject({ operator: '運営', contact: '', terms: { text: '新しい決まり', updatedAt: today() } });
  });

  test('本文を空か既定の文と同じにすると、既定の文に戻る。名前を空にすると消える', async () => {
    await save({ operator: '運営', contact: 'op@example.com', terms: 'A', privacy: 'B' });
    await save({ operator: '', contact: '', terms: '', privacy: DEFAULT_LEGAL.privacy });
    const d = await getLegal();
    expect(d).toMatchObject({ operator: '', contact: '', terms: { custom: false, updatedAt: DEFAULT_LEGAL_DATE }, privacy: { custom: false } });
    expect(await metaKeys()).toEqual([]);
    expect(JSON.parse(logs.at(-1)!).changed).toEqual(['terms', 'privacy']);
    // null も空と同じ
    await save({ privacy: 'C' });
    await save({ privacy: null });
    expect((await getLegal()).privacy.custom).toBe(false);
  });

  test('長すぎるものは断り、何も変えない', async () => {
    expect((await save({ operator: 'あ'.repeat(101) })).body.error).toBe('運営者の名前は 100 文字までです。');
    expect((await save({ operator: '運営', contact: 'x'.repeat(301) })).body.error).toBe('問い合わせ先は 300 文字までです。');
    expect((await save({ operator: '運営', privacy: 'あ'.repeat(20001) })).body.error).toBe('プライバシーポリシーは 20000 文字までです。');
    expect((await save({ terms: 'あ'.repeat(20000) })).status).toBe(200);
    expect(await metaKeys()).toEqual(['legal_terms']);
  });
});
