#!/usr/bin/env bash
# Yokiを新しい版に上げる。更新のワークフロー（.github/workflows/update.yml）が、取り込む版のこのファイルを取り出して動かす
# （いつも取り込む版の手順で動くように。ボタンで作ったリポジトリの更新のワークフローは、書き換えずに使い続けるため）。
# 動かす前に、ワークフローが版のタグ（TAG。例 v1.2.0）を元のリポジトリ（UPSTREAM）からfetchしてある。取り込み方は、リポジトリの作り方で変わる。
#   「Deploy to Cloudflare」のボタンで作ったリポジトリ（元の履歴とつながっていない）: 取り込む版のファイルで入れ替える。
#     .github/ は入れ替えも比べもしない。CloudflareのGitHub Appはワークフローのファイルを書けないので、ボタンで作ったリポジトリには
#     .github/workflows/ が無く、更新のワークフローは運営者が1回だけ入れる。それを残し、ワークフローのファイルを変えないので、Actionsの既定のトークンで書き込める。
#     設置したときにCloudflareがwrangler.jsoncに書いた値（Workerの名前・D1の名前とID）は引き継ぐ（carry-wrangler.mjs）。
#     mainに入れると、Cloudflareの組み立て（Workers Builds）が公開する
#   フォーク（元の履歴とつながっている）: 版のタグをマージする。公開は、GitHub Actionsで公開すると決めていれば（YOKI_DEPLOY_WITH_ACTIONS）公開のワークフロー（deploy.yml）がする
# 表（D1）の変更は、公開のときに当たる（Workers Buildsはpackage.jsonのdeploy、deploy.ymlは変える前の地点を控えてから当てる）。
# mainを変えずにPRを作って止まるとき: フォークでマージがぶつかったとき。ボタンで作ったリポジトリのコードを、設置した人が変えていたとき
# 環境変数: TAG・UPSTREAM・GH_TOKEN（ghが使う）・UPDATE_TOKEN（ActionsのsecretのUPDATE_PUSH_TOKEN。無ければ空）・DEPLOY_WITH_ACTIONS（varsのYOKI_DEPLOY_WITH_ACTIONS）
set -eo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
branch="update/$TAG"

# PR を作って止まる（main は変えない）。$1 は PR の本文
stop_with_pr() {
  git push --force origin "HEAD:refs/heads/$branch"
  gh pr create --base main --head "$branch" --title "chore: Yokiの${TAG}を取り込む" --body "$1" \
    || echo '::warning::PR を作れませんでした（Settings → Actions の「Allow GitHub Actions to create and approve pull requests」を入れるか、手で作ってください）'
  echo "::error::$TAG を main に入れずに、$branch を PR にしました。GitHub の画面で確かめてマージしてください"
  exit 1
}

if git merge-base HEAD "$TAG" > /dev/null 2>&1; then
  # フォーク: 版のタグをマージする
  if git merge-base --is-ancestor "$TAG" HEAD; then
    echo "すでに $TAG を取り込んでいます。" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  if ! git merge --no-edit -m "chore: Yokiの${TAG}を取り込む" "$TAG"; then
    git merge --abort
    git checkout -q -B "$branch" "$TAG^{commit}"
    stop_with_pr "元のリポジトリの $TAG を取り込もうとして、このリポジトリの変更とぶつかりました。ぶつかったところを直してマージすると、公開されます。"
  fi
  # 版のタグも、このリポジトリに置く（main より先に）
  git push origin "refs/tags/$TAG"
else
  # ボタンで作ったリポジトリ: 取り込む版のファイルで入れ替える（.github/ は除く）
  now="v$(node -p "require('./package.json').version")"
  if [ "$now" = "$TAG" ]; then
    echo "すでに $TAG です。" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  # 設置した人がコードを変えたか: 今の版（設置したときと、前の更新で入れた版）と比べる。wrangler.jsonc は Cloudflare が書き換えるので除く
  changed=yes
  if git fetch --no-tags "https://github.com/$UPSTREAM.git" "refs/tags/$now:refs/tags/$now" 2> /dev/null \
    && git diff --quiet "$now" HEAD -- . ':(exclude)wrangler.jsonc' ':(exclude).github'; then changed=no; fi
  cp wrangler.jsonc "$RUNNER_TEMP/wrangler.jsonc"
  git rm -q -r -- . ':(exclude).github'
  git checkout "$TAG" -- . ':(exclude).github'
  node tools/update/carry-wrangler.mjs "$RUNNER_TEMP/wrangler.jsonc" wrangler.jsonc
  git add -A
  git commit -q -m "chore: Yokiの${TAG}を取り込む"
  if [ "$changed" = yes ]; then
    stop_with_pr "このリポジトリのコードが、元のリポジトリの $now から変わっています。新しい版の $TAG のファイルで入れ替えると、その変更は消えます。差分を確かめて、残したい変更が無ければマージしてください（マージすると公開されます）。"
  fi
fi

if ! git push origin HEAD:main; then
  echo '::error::main に書き込めませんでした。Settings → Actions の「Workflow permissions」を確かめてください。フォークで、元のリポジトリがワークフローのファイル（.github/workflows/）を変えた版は、Actions の secret に UPDATE_PUSH_TOKEN が要ります（サイトの「新しい版に上げる」）'
  exit 1
fi
echo "$TAG を取り込みました。公開が続けて進みます。" >> "$GITHUB_STEP_SUMMARY"

# GitHub Actions で公開しているリポジトリ（YOKI_DEPLOY_WITH_ACTIONS）だけ。UPDATE_PUSH_TOKEN で書き込んだときは push で公開のワークフローが動き、
# GITHUB_TOKEN のときは動かないので、ここで動かす。ボタンで作ったリポジトリは、main への push で Workers Builds が公開する
if [ -z "$UPDATE_TOKEN" ] && [ "$DEPLOY_WITH_ACTIONS" = true ]; then
  gh workflow run deploy.yml --ref main
fi
