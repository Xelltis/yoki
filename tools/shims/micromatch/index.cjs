// micromatch の差し替え。semantic-release（とその commit-analyzer）が使う 2 つの呼び方だけを、picomatch で同じように動かす。
// 本物の micromatch は braces に頼り、braces には直った版の無い npm audit の指摘があるため（package.json の overrides で入れる）。
//   micromatch(list, patterns) … list のうち、patterns に合うものを返す（semantic-release の branches の照合）
//   micromatch.isMatch(str, patterns) … str が patterns に合うか（commit-analyzer の releaseRules の照合）
const picomatch = require('picomatch');

function micromatch(list, patterns, options) {
  const isMatch = picomatch(patterns, options);
  return list.filter((s) => isMatch(s));
}
micromatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);

module.exports = micromatch;
