# CLAUDE.md

このリポジトリで作業するときの決まり。動かし方と書くときの決まりは [README.md](README.md)、作りとその理由は [docs/architecture.md](docs/architecture.md) にある。

## 何のリポジトリか

卓予定（Yoki）。TRPG の卓の予定を、Discord サーバーの仲間と管理する Web アプリ。

- アプリ: Cloudflare Workers（TypeScript・Hono）＋ D1 ＋ Discord ログイン。サーバーは `src/worker/`、画面は `src/client/`
- サイト: 紹介と使い方。`website/`（VitePress）を GitHub Pages に公開する
- 文書・画面の文・コミットの説明は日本語。短い文で、平易に書く

## コマンド

| コマンド | すること |
|---|---|
| `npm run dev` | アプリを開発サーバーで動かす（http://localhost:5173/ 、「開発用ログイン」でサンプルのグループに入る） |
| `npm test` | サーバーと画面のテスト |
| `npm run typecheck` | 型の確認（アプリ・設定ファイル・サイト） |
| `npm run e2e` | ブラウザで通しで確かめる（開発サーバーをその場で立てる） |
| `npm run build` | 組み立てる。開発用ログインが残っていたら止まる |
| `npm run site` / `npm run site:build` | サイトを手元で開く・組み立てる |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを撮り直す |

`npm run deploy`（本番の D1 と Worker に公開する）は、人が実行する。頼まれない限り動かさない。

## 変えたら確かめること

- いつも: `npm test` と `npm run typecheck`
- 画面（`src/client/`）を変えたら: `npm run e2e`。見た目が変わったら `npm run screenshots` で撮り直し、画像もコミットする
- サイト（`website/`）を変えたら: `npm run site:build`
- 表（D1）を変えたら: `migrations/` に番号の続くファイルを足す。すでにあるファイルは書き換えない

## 守ること

README の「書くときの決まり」に加えて、次を守る。

- 日付と時刻は `src/worker/lib/jst.ts` で日本時間として扱う（Workers は UTC で動く）
- 画面とサーバーの約束（呼べる関数の名前・画面データの型・返事の形）は `src/shared/api.ts` に置く。呼べる関数を足すときは、ここの `RPC_FUNCS` とサーバーの一覧（`src/worker/routes/rpc.ts`）の両方に足す
- 画面（`src/client/console/`）のファイルは、読み込んだときに何もしない。イベントの登録は `init()` に書き、`main.ts` から呼ぶ
- 開発用ログイン（`src/worker/auth/dev.ts`）は `import.meta.env.DEV` のときだけ登録する
- Discord のトークンは保存しない。秘密の値（`.dev.vars`）はコミットしない
- アイコンを足したら、読み込む一覧にも足す（画面は各ページの `icon_names`、サイトは `website/.vitepress/config.ts` の `ICONS`。テストが確かめる）

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) を採用する。形は commitlint（`commitlint.config.js`。`@commitlint/config-conventional` に、日本語向けの調整を足したもの）が確かめる。

```
<type>(<scope>): <説明>

<本文>

<フッター>
```

- **type**: 次のどれか

  | type | 使うとき |
  |---|---|
  | `feat` | 機能を足す・変える |
  | `fix` | 不具合を直す |
  | `docs` | 文書だけ（README・docs/・CLAUDE.md・サイトの本文） |
  | `style` | 動きの変わらない見た目の整え（空白・並び） |
  | `refactor` | 動きを変えずにコードを直す |
  | `perf` | 速くする |
  | `test` | テストだけ |
  | `build` | 組み立て・依存・設定（package.json・vite・wrangler） |
  | `ci` | GitHub Actions |
  | `chore` | そのほか（Git の設定など） |
  | `revert` | 前のコミットを取り消す |

- **scope**（なくてもよい）: `worker`・`client`・`site`・`db`・`discord`・`auth`・`e2e`・`deps` など、変えた場所
- **説明**: 日本語で、何をするかを短く書く。「〜する」の形で、句点は付けない
- **本文**（なくてもよい）: 空行のあとに、理由と中身を箇条書きで書く
- **互換を壊す変更**（URL・表・設定の名前が変わるなど）: type のあとに `!` を付け、フッターに `BREAKING CHANGE: 何が変わり、どうすればよいか` を書く
- 1 つのコミットには 1 つの目的だけを入れる
- コミットのときは lefthook（`lefthook.yml`）が、型の確認・テストと、説明の形（commitlint）を確かめる。止まったら直してからコミットし直す。`LEFTHOOK=0` や `--no-verify` で飛ばさない

例:

```
feat(client): 予定表の上に絞り込みのボタンを出す

- 土日祝だけ・全員空きだけ・自分の列だけを、押すたびに入り切りできるようにする
- 細かい条件は今までどおり「絞り込み」の中に残す
```

```
fix(build): 公開のときに組み立てた設定を使う
```

コミットと push は、頼まれたときだけする。push の前には確かめる（`.claude/settings.json` で聞くようにしてある）。
