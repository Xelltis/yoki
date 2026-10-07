// 更新のワークフロー（.github/workflows/update.yml）が使う。「Deploy to Cloudflare」のボタンで設置したリポジトリを新しい版のファイルで入れ替えるとき、
// 設置したときにCloudflareがwrangler.jsoncに書き込んだ値（Workerの名前・D1のデータベースの名前とID）を、新しい版のwrangler.jsoncに引き継ぐ。
//   node tools/update/carry-wrangler.mjs <今のwrangler.jsonc> <新しい版のwrangler.jsonc>   … 新しい版のほうを書き換える
// 新しい版のファイルはコメント付きのまま、値の行だけを書き換える（元のリポジトリのwrangler.jsoncの書き方に合わせてある）
import { readFileSync, writeFileSync } from 'node:fs';

/** JSONC（コメントと、閉じる前のカンマを許すJSON）を読む */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // 文字列はそのまま写す（中の // や /* はコメントではない）
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const str = (v) => JSON.stringify(v);

/** 今の設定（current）から、Workerの名前とD1（binding: DB）の名前・IDを、新しい版の文（next）に移す */
export function carry(currentText, nextText) {
  const cur = parseJsonc(currentText);
  let out = nextText;
  if (cur.name) out = out.replace(/^( {2}"name": )"[^"]*"/m, `$1${str(cur.name)}`);
  const db = (cur.d1_databases ?? []).find((d) => d.binding === 'DB');
  if (!db) return out;
  // 新しい版のDBの塊（"binding": "DB" から閉じる } まで）の中だけを書き換える
  return out.replace(/("binding": "DB",[\s\S]*?)(\n\s*\})/, (_, body, close) => {
    let b = body;
    if (db.database_name) b = b.replace(/("database_name": )"[^"]*"/, `$1${str(db.database_name)}`);
    if (db.database_id) {
      if (/"database_id":/.test(b)) b = b.replace(/("database_id": )"[^"]*"/, `$1${str(db.database_id)}`);
      else b = b.replace(/(\n(\s*)"database_name": "[^"]*",?)/, (line, _l, sp) => `${line.endsWith(',') ? line : line + ','}\n${sp}"database_id": ${str(db.database_id)},`);
    }
    return b + close;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [current, next] = process.argv.slice(2);
  writeFileSync(next, carry(readFileSync(current, 'utf8'), readFileSync(next, 'utf8')));
}
