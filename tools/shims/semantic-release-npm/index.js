// semantic-release の npm プラグイン（@semantic-release/npm）の差し替え。卓予定は npm に公開しないので、何もしない。
// .releaserc.json でプラグインを決めているので、ふだんは読み込まれない（決めていないときの既定の一覧にだけ入っている）。
// 本物は npm 本体を同梱し、その中の部品に npm audit の指摘があるため、package.json の overrides でこれに替える
export async function verifyConditions() {}
export async function prepare() {}
export async function publish() {
  return false;
}
export async function addChannel() {
  return false;
}
