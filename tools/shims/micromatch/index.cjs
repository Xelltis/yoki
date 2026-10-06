// micromatchの差し替え。semantic-release（とそのcommit-analyzer）が使う2つの呼び方だけを、picomatchで同じように動かす。
// 本物のmicromatchはbracesに頼り、bracesには直った版の無いnpm auditの指摘があるため（package.jsonのoverridesで入れる）。
//   micromatch(list, patterns) … listのうち、patternsに合うものを返す（semantic-releaseのbranchesの照合）
//   micromatch.isMatch(str, patterns) … strがpatternsに合うか（commit-analyzerのreleaseRulesの照合）
const picomatch = require('picomatch');

function micromatch(list, patterns, options) {
  const isMatch = picomatch(patterns, options);
  return list.filter((s) => isMatch(s));
}
micromatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);

module.exports = micromatch;
