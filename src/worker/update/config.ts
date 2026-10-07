// 運営の管理画面の「更新」の設定。
//   新しい版は、元のリポジトリ（UPSTREAM_REPOSITORY。無ければDEFAULT_UPSTREAM）のGitHubのReleaseから読む（トークンは要らない）
//   更新は、公開しているリポジトリ（APP_REPOSITORY。公開のときに入る）の更新のワークフロー（.github/workflows/update.yml）がする
//   UPDATE_DISPATCH_TOKEN（そのリポジトリのActionsを動かすだけの権限）があれば、管理画面のボタンでワークフローを動かせる。
//   無ければ、GitHubのActionsの画面の「Run workflow」で動かす
// 開発サーバーでAPP_REPOSITORYが空なら、開発用の偽のGitHub（dev.ts）を使う。偽物を選ぶ道はimport.meta.env.DEVのときだけ
import type { Bindings } from '../env';
import { realGitHub, type UpdateApi } from './api';
import { fakeGitHub } from './dev';

/** 元のリポジトリ（Yokiの本家） */
export const DEFAULT_UPSTREAM = 'Xelltis/yoki';
/** 更新のワークフロー */
export const UPDATE_WORKFLOW = 'update.yml';

/** apiはGitHub、upstreamは元のリポジトリ、repoは公開しているリポジトリ（分からなければ空）、tokenはワークフローを動かすトークン（無ければ空） */
export type UpdateDeps = { api: UpdateApi; upstream: string; repo: string; token: string };

/** owner/nameの形だけを通す（GitHubのAPIの道に入れるため）。ownerは英数字とハイフン、nameに . や .. は使わせない */
const REPO = /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/;
const repoOr = (v: string | undefined, fallback: string) => (v && REPO.test(v) ? v : fallback);

export function updateDeps(env: Bindings): UpdateDeps {
  const upstream = repoOr(env.UPSTREAM_REPOSITORY, DEFAULT_UPSTREAM);
  if (import.meta.env?.DEV && !env.APP_REPOSITORY) return { api: fakeGitHub(env.DB), upstream, repo: 'example/yoki', token: 'dev' };
  return { api: realGitHub(), upstream, repo: repoOr(env.APP_REPOSITORY, ''), token: env.UPDATE_DISPATCH_TOKEN ?? '' };
}
