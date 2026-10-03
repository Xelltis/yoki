# Yoki（卓予定管理）

TRPG の卓の予定を、Google スプレッドシートと Apps Script で管理するツール。ウェブアプリの画面から、卓の登録、メンバーの都合（△×）、募集、日程調整を行い、知らせを Discord の Webhook に送る。

## ファイル

| パス | 中身 |
|---|---|
| `Code.gs` | サーバー側の処理。シートの読み書き、Discord への送信、見回りのトリガー |
| `Console.html` | ウェブアプリの画面 |
| `Tutorial.html` | 使い方のページ（`?page=tutorial` で開く） |
| `appsscript.json` | Apps Script の設定（ウェブアプリの公開範囲など） |
| `test/` | Apps Script のモックの上で `Code.gs` を通しで動かすテスト |
| `demo/` | 広報用のデモ画面（本物の画面と `Code.gs` をブラウザだけで動かす） |
| `mock/` | 画面の作り直し案のモック |
| `広報/` | X 用の告知画像 |
| `docs/` | 導入手順・使い方・検証の記録（`卓予定管理_構想.md`）と、配布や画面の作り直しの案 |

## テスト

```
uv run test/run_test.py
```

## Apps Script への反映

[clasp](https://github.com/google/clasp) で送る。`.clasp.json`（スクリプト ID）はリポジトリに入れていないので、手元で作る。

```
clasp push --force
clasp redeploy <デプロイ ID> -d "卓予定管理シートverNN"
```

送るのは `.claspignore` で絞った 4 つ（`Code.gs`・`Console.html`・`Tutorial.html`・`appsscript.json`）だけ。詳しい手順は `docs/卓予定管理_構想.md` にある。
