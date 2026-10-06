// 名前とメンバーの変換。中ではメンバーをIDで持ち、メンバーに無い人（ゲスト）は名前だけで持つ。画面とのやり取りは名前
import type { Ctx, Role, Session } from './types';

export type PersonRef = { member_id: number | null; guest_name: string | null };
export type People = Record<Role, string[]>;

export function personRef(ctx: Ctx, name: string): PersonRef {
  const m = ctx.memberByName.get(name);
  return m ? { member_id: m.id, guest_name: null } : { member_id: null, guest_name: name };
}

export function peopleOfSession(s: Session): People {
  return { gm: s.gm ? [s.gm] : [], member: s.members, want: s.want, interest: s.interest };
}

type Row = PersonRef & { session_id: number | null; role: Role; pos: number };

function rows(ctx: Ctx, sessionId: number | null, people: People): Row[] {
  const out: Row[] = [];
  for (const role of ['gm', 'member', 'want', 'interest'] as Role[]) {
    people[role].forEach((name, pos) => out.push({ session_id: sessionId, role, pos, ...personRef(ctx, name) }));
  }
  return out;
}

const INSERT_FROM_JSON = (sessionSql: string, jsonParam: string) =>
  `INSERT INTO session_people (session_id, role, pos, member_id, guest_name)
   SELECT ${sessionSql}, json_extract(value, '$.role'), json_extract(value, '$.pos'), json_extract(value, '$.member_id'), json_extract(value, '$.guest_name')
     FROM json_each(${jsonParam})`;

/** いくつかの卓の関わる人を、まとめて書き直す（卓の数によらず2文） */
export function replacePeople(ctx: Ctx, changes: { rowId: number; people: People }[]): D1PreparedStatement[] {
  if (!changes.length) return [];
  const all = changes.flatMap((c) => rows(ctx, c.rowId, c.people));
  return [
    ctx.db.prepare('DELETE FROM session_people WHERE session_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(changes.map((c) => c.rowId))),
    ctx.db.prepare(INSERT_FROM_JSON("json_extract(value, '$.session_id')", '?1')).bind(JSON.stringify(all)),
  ];
}

/** 新しく入れる卓（まだidが分からない）の関わる人。グループと番号で卓を引く */
export function insertPeopleForSeq(ctx: Ctx, seq: number, people: People): D1PreparedStatement {
  return ctx.db
    .prepare(INSERT_FROM_JSON('(SELECT id FROM sessions WHERE group_id = ?1 AND seq = ?2)', '?3'))
    .bind(ctx.group.id, seq, JSON.stringify(rows(ctx, null, people)));
}
