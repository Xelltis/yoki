// グループの書き出し（管理画面の「このグループ」）。サーバーが返したJSONを、ファイルにして渡す。卓の一覧はCSVにもする
import type { GroupExport } from '../../../../shared/api';

/** 文字をファイルにして、ブラウザに保存させる */
export function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * CSVの1つの値。いつも " で囲み、中の " は2つにする。
 * 表計算のアプリが式として読まないように、= + - @ で始まる値の頭に ' を付ける（メンバーが書いた卓の名前やメモが入るため）
 */
const cell = (v: string) => '"' + (/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"';

/** 卓の一覧のCSV（表計算のアプリで開けるように、頭にBOMを付ける） */
export function sessionsCsv(x: GroupExport): string {
  const head = ['卓のID', '名前', '状態', '開催日', '開始', '終了', 'GM', '共同GM', '参加者', '場所', 'シリーズ', 'シナリオ', 'メモ', 'ログ'];
  const rows = x.sessions.map((s) => [s.id, s.name, s.status, s.date, s.start, s.end, s.gm, s.coGms.join('、'), s.members.join('、'), s.place, s.series, s.scenario, s.memo, s.record.logUrl]);
  return '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
