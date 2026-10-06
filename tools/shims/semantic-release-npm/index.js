// semantic-releaseのnpmプラグイン（@semantic-release/npm）の差し替え。卓予定はnpmに公開しないので、何もしない。
// .releaserc.jsonでプラグインを決めているので、ふだんは読み込まれない（決めていないときの既定の一覧にだけ入っている）。
// 本物はnpm本体を同梱し、その中の部品にnpm auditの指摘があるため、package.jsonのoverridesでこれに替える
export async function verifyConditions() {}
export async function prepare() {}
export async function publish() {
  return false;
}
export async function addChannel() {
  return false;
}
