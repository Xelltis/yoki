// 開発用ログインで使う人（サンプルのグループのメンバー）。Discord ID はサンプルデータのメンバーと同じにしてあり、
// ログインすると、その名前のメンバーに結びつく。ひよりは Discord サーバーの管理者（グループの管理者）
export const DEV_GUILD = { id: 'dev-guild', name: '開発用サーバー' };
export const SAMPLE_GROUP_ID = 'sample';

export const DEV_USERS = [
  { name: 'ひより', id: '400000000000000010', manager: true },
  { name: 'ソラ', id: '400000000000000011', manager: false },
  { name: 'こまち', id: '400000000000000012', manager: false },
  { name: 'レン', id: '400000000000000013', manager: false },
  { name: 'ミナト', id: '400000000000000014', manager: false },
  { name: 'ユズ', id: '400000000000000015', manager: false },
];
