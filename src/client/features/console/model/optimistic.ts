// 返事を待たずに見せる形（押した瞬間の仮の反映）。データdを受け取り、変えた新しいdを返す（dは書き換えない）。
// 仮の卓のIDは '__tmp__'（何日かまとめて登録するときは '__tmp__0'・'__tmp__1'…）。返事のデータで本物に置き換わる
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';

export const TMP = '__tmp__';
export const isTmp = (id: string) => String(id).indexOf(TMP) === 0;

/** 卓を足すか、同じIDの卓を置き換える。listを渡すと、まとめて足す */
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

/** その日の、その人の予定の印を変える（空なら消す） */
export function withAvail(d: ConsoleData, day: string, name: string, mark: string): ConsoleData {
  const marks = { ...d.avail[day] };
  if (mark) marks[name] = mark; else delete marks[name];
  return { ...d, avail: { ...d.avail, [day]: marks } };
}

/** その日の、その人の予定のメモを変える（空なら消す） */
export function withAvailNote(d: ConsoleData, day: string, name: string, text: string): ConsoleData {
  const notes = { ...(d.availNotes || {})[day] };
  if (text.trim()) notes[name] = { text: text.trim(), at: 'いま' }; else delete notes[name];
  return { ...d, availNotes: { ...d.availNotes, [day]: notes } };
}
