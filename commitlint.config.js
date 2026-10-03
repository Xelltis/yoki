// コミットの説明の決まり（Conventional Commits）。lefthook の commit-msg で確かめる。
// 決まりの説明は CLAUDE.md の「コミット」。type の一覧は config-conventional のまま
export default {
  extends: ['@commitlint/config-conventional'],
  helpUrl: 'https://github.com/Xelltis/yoki/blob/main/CLAUDE.md#コミット',
  rules: {
    // 説明は日本語で書く。英字で始まる固有名詞（「Discord に…」など）を、文頭の大文字として止めないようにする
    'subject-case': [0],
    // 説明の終わりに句点を付けない
    'subject-full-stop': [2, 'never', '。'],
    // 日本語の本文は 1 行が長くなりやすいので、行の長さは見ない
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
