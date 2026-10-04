// 返事を待たずに見せる形（押した瞬間の仮の反映）。データ d を受け取り、変えた新しい d を返す（d は書き換えない）。
// 仮の卓の ID は '__tmp__'（何日かまとめて登録するときは '__tmp__0'・'__tmp__1'…）。返事のデータで本物に置き換わる
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';

export const TMP = '__tmp__';
export const isTmp = (id: string) => String(id).indexOf(TMP) === 0;

/** 卓を足すか、同じ ID の卓を置き換える。list を渡すと、まとめて足す */
export function withSessions(d: ConsoleData, list: ConsoleSession[]): ConsoleData {
  let sessions = d.sessions.slice();
  list.forEach((t) => {
    const i = sessions.findIndex((s) => s.id === t.id);
    if (i >= 0) sessions = sessions.map((s, j) => (j === i ? t : s)); else sessions.push(t);
  });
  return { ...d, sessions };
}

/** 仮の卓を外す（保存に失敗したとき） */
export function withoutTmp(d: ConsoleData): ConsoleData {
  return { ...d, sessions: d.sessions.filter((s) => !isTmp(s.id)) };
}

/** 卓を外す（消したとき） */
export function withoutSession(d: ConsoleData, id: string): ConsoleData {
  return { ...d, sessions: d.sessions.filter((s) => s.id !== id) };
}

/** 卓の一部を変える */
export function withSession(d: ConsoleData, id: string, change: (s: ConsoleSession) => ConsoleSession): ConsoleData {
  return { ...d, sessions: d.sessions.map((s) => (s.id === id ? change(s) : s)) };
}
