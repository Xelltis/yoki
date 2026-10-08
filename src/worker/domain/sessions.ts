// 卓の登録・変更・削除・参加希望・まとめての変更（GAS版Sessions.js）
import { badRequest, notFound } from '../lib/errors';
import { fmtDateJa, normTime, parseYmd } from '../lib/jst';
import { splitNames, uniq } from '../lib/text';
import { CAPACITY_MAX, DATED, PROMOTE, SESSION_DATES_MAX, STATUS, STATUS_LIST, type Status } from './constants';
import { type Form, list, requireSelf, str } from './form';
import { sessionCode } from './load';
import { findSession, peopleOf, readWindow, windowInfo } from './model';
import { insertPeopleForNext, insertPeopleForSeq, type People, peopleOfSession, replacePeople } from './people';
import { checkGmChange, unassignGoneStmt } from './prep';
import { findScenario, keepPassesStmt, readScenarioId } from './scenarios';
import type { Ctx, Session } from './types';

/** 状態を読む。知らない値は「開催」（旧い版の「予定」も「開催」） */
function readStatus(v: unknown): Status {
  const s = str(v);
  return (STATUS_LIST as string[]).includes(s) ? (s as Status) : STATUS.HELD;
}

/** 新しい卓の番号をn個とる（使った番号は使い直さない） */
async function allocateSeq(ctx: Ctx, n: number): Promise<number> {
  const r = await ctx.db
    .prepare('UPDATE groups SET next_session_seq = next_session_seq + ?2 WHERE id = ?1 RETURNING next_session_seq - ?2 AS first')
    .bind(ctx.group.id, n)
    .first<{ first: number }>();
  return r!.first;
}

const INSERT_SESSION = `INSERT INTO sessions (group_id, seq, name, status, date, start_time, end_time, place, memo, series, series_end,
  window_from, window_to, candidates, editor, updated_at, scenario_id, capacity, recruit_due)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, '[]', ?14, ?15, ?16, ?17, ?18)`;

/**
 * 行けなくなった印を片付ける文。開催でなくなった卓と、参加者でなくなった人の印を消す。allなら（開催日が変わったとき）卓の印を全部消す。
 * 関わる人を書き直す文のあとに、同じbatchで流す
 */
function absenceCleanupStmt(ctx: Ctx, rowIds: number[], all: boolean): D1PreparedStatement {
  return ctx.db
    .prepare(
      `DELETE FROM session_absences WHERE session_id IN (SELECT value FROM json_each(?1)) AND (?2
         OR (SELECT status FROM sessions WHERE id = session_absences.session_id) <> '開催'
         OR member_id NOT IN (SELECT member_id FROM session_people p WHERE p.session_id = session_absences.session_id AND p.role = 'member' AND p.member_id IS NOT NULL))`,
    )
    .bind(JSON.stringify(rowIds), all ? 1 : 0);
}

/**
 * 募集の定員と締め切りを読む。持つのは募集の卓だけ（ほかの状態ならnull）。
 * 送られなければ今のまま（古い画面から保存しても消えないように）。空なら決めない
 */
function readRecruitLimits(form: Form, status: Status, existing: Session | null): { capacity: number | null; due: string | null } {
  if (status !== STATUS.RECRUIT) return { capacity: null, due: null };
  let capacity = existing?.capacity ?? null, due = existing?.recruitDue ?? null;
  if (form.capacity !== undefined) {
    const v = str(form.capacity), n = Number(v);
    if (v && (!Number.isInteger(n) || n < 1 || n > CAPACITY_MAX)) throw badRequest('定員は1〜' + CAPACITY_MAX + '人で入れてください（決めないなら空のまま）。');
    capacity = v ? n : null;
  }
  if (form.recruitDue !== undefined) {
    const v = str(form.recruitDue);
    due = v ? parseYmd(v) : null;
    if (v && !due) throw badRequest('募集の締め切りの日付が読めません: ' + v);
  }
  return { capacity, due };
}

/** 卓を登録・更新する。form.datesに2日以上あれば、まとめて登録する（新規だけ） */
export async function saveSession(ctx: Ctx, form: Form) {
  const name = str(form.name);
  if (!name) throw badRequest('卓の名前を入れてください。');
  const dates = uniq(list(form.dates)).sort();
  if (dates.length > 1) return saveSessionDates(ctx, form, name, dates);
  const status = readStatus(form.status);
  const date = form.date ? parseYmd(form.date) : null;
  if (form.date && !date) throw badRequest('開催日の形式が読めません: ' + str(form.date));
  if (!date && DATED.includes(status)) throw badRequest('開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。');
  // 期間。募集は「開催したい期間」、調整中は「候補の期間」。この2つの状態だけが持つ
  const win = status === STATUS.RECRUIT || status === STATUS.ADJUSTING ? readWindow(form.windowFrom, form.windowTo) : null;
  const gm = str(form.gm);
  const series = str(form.series);
  let members = uniq(splitNames(list(form.members).join('、') + '、' + str(form.extra)));
  const existing = form.id ? findSession(ctx, form.id) : null;
  if (existing) checkGmChange(ctx, existing, gm);
  // シナリオ。送られなければ今のまま（古い画面から保存しても外れないように）
  const scenarioId = form.scenarioId === undefined ? (existing?.scenarioId ?? null) : readScenarioId(ctx, form.scenarioId);
  const limits = readRecruitLimits(form, status, existing);
  const dateChanged = !existing || existing.date !== date;
  // 参加希望・興味あり。参加者やGMになった人は外す。募集から「調整中」「開催」になったら、参加希望の人を参加者に移す
  const notIn = (n: string) => !members.includes(n) && n !== gm;
  let want = existing ? existing.want.filter(notIn) : [];
  let interest = existing ? existing.interest.filter(notIn) : [];
  let promoted: string[] = [], dropped: string[] = [];
  if (existing && existing.status === STATUS.RECRUIT && PROMOTE.includes(status)) {
    // 参加希望はそのまま参加者に。興味ありは、画面で選ばれた人だけが参加者に入っている
    promoted = want.slice();
    members = uniq(members.concat(promoted));
    want = [];
    dropped = interest.filter((n) => !members.includes(n));
    interest = [];
  }
  const start = normTime(form.start), end = normTime(form.end);
  const at = ctx.now.toISOString();
  const seriesEnd = series ? parseYmd(form.seriesEnd) : null;
  const people: People = { gm: gm ? [gm] : [], member: members, want, interest };
  const db = ctx.db;
  const stmts: D1PreparedStatement[] = [];
  let id: string;
  if (existing) {
    id = existing.id;
    const oldWin = windowInfo(existing.windowFrom, existing.windowTo)?.text ?? '';
    stmts.push(
      db
        .prepare(
          `UPDATE sessions SET name = ?2, status = ?3, date = ?4, start_time = ?5, end_time = ?6, place = ?7, memo = ?8, series = ?9, series_end = ?10,
             window_from = ?11, window_to = ?12, candidates = ?13, editor = ?14, updated_at = ?15,
             notified_at = ?16, asked_at = ?17, urged_at = ?18, soon_at = ?19, poll_ready_at = ?20, scenario_id = ?21,
             capacity = ?22, recruit_due = ?23, due_urged_at = ?24
           WHERE id = ?1`,
        )
        .bind(
          existing.rowId, name, status, date, start, end, str(form.place), str(form.memo), series, seriesEnd,
          win?.from ?? null, win?.to ?? null, JSON.stringify(status === STATUS.ADJUSTING ? existing.candidates : []), ctx.actor.name, at,
          // 開催日が変わったら開催前の知らせを、期間が変わったら期間前の催促を、開催日か開始時刻が変わったら開始直前の知らせを、送り直せるようにする
          !dateChanged ? existing.notifiedAt : null,
          status === STATUS.RECRUIT ? existing.askedAt : null,
          oldWin === (win?.text ?? '') ? existing.urgedAt : null,
          !dateChanged && existing.start === start ? existing.soonAt : null,
          status === STATUS.ADJUSTING ? existing.pollReadyAt : null,
          scenarioId,
          // 締め切りを変えたら、締め切りの日の知らせを送り直せるようにする
          limits.capacity, limits.due, limits.due && limits.due === existing.recruitDue ? existing.dueUrgedAt : null,
        ),
      ...replacePeople(ctx, [{ rowId: existing.rowId, people }]),
    );
    // HOを割り当てた人が参加者でなくなったら、割り当てを外す（秘匿HOを読めなくする）
    if (existing.slots.some((x) => x.memberId !== null)) stmts.push(unassignGoneStmt(ctx, [existing.rowId]));
    // 調整中でなくなったら、日程調整の回答も消す（候補日と一緒に）
    if (status !== STATUS.ADJUSTING) stmts.push(db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(existing.rowId));
    // 開催日が変わったり、開催でなくなったり、参加者から外れたりしたら、行けなくなった印を消す
    if (existing.absent.length) stmts.push(absenceCleanupStmt(ctx, [existing.rowId], dateChanged));
  } else {
    const seq = await allocateSeq(ctx, 1);
    id = sessionCode(seq);
    stmts.push(
      db.prepare(INSERT_SESSION).bind(ctx.group.id, seq, name, status, date, start, end, str(form.place), str(form.memo), series, seriesEnd, win?.from ?? null, win?.to ?? null, ctx.actor.name, at, scenarioId,
        limits.capacity, limits.due),
      insertPeopleForSeq(ctx, seq, people),
    );
  }
  // 単発の卓から「続けて登録」したときは、元の回にも同じシリーズ名を入れて1つのシリーズにする（元の回にシリーズ名が無いときだけ）
  let linked = false;
  const from = series && form.seriesFrom ? ctx.sessions.find((x) => x.id === str(form.seriesFrom)) : undefined;
  if (from && !from.series) {
    stmts.push(db.prepare('UPDATE sessions SET series = ?2, series_end = COALESCE(?3, series_end) WHERE id = ?1').bind(from.rowId, series, seriesEnd));
    linked = true;
  }
  await db.batch(stmts);
  let message = (existing ? '更新しました: ' : '登録しました: ') + name + '（' + id + '）';
  if (linked) message += '　前の回も「' + series + '」にまとめました。';
  if (promoted.length) message += '　参加希望の' + promoted.join('、') + 'を参加者に加えました。';
  if (dropped.length) message += '　興味ありの' + dropped.join('、') + 'は外しました。';
  return { ok: true, id, message, promoted, dropped };
}

/**
 * 複数の開催日をまとめて登録する（新規だけ）。GM・参加者・時間・場所・メモ・シリーズは全部同じ。
 * 名前は末尾の数字を進める（「#1」→「#2」）。数字が無ければ2回目から「名前 #2」
 */
async function saveSessionDates(ctx: Ctx, form: Form, name: string, raw: string[]) {
  if (form.id) throw badRequest('複数日をまとめて登録できるのは新規のときだけです。');
  const status = readStatus(form.status);
  if (!DATED.includes(status)) throw badRequest('複数日をまとめて登録するときは、状態を「開催」にします。');
  if (raw.length > SESSION_DATES_MAX) throw badRequest('まとめて登録できるのは' + SESSION_DATES_MAX + '日分までです。');
  const dates = raw.map((d) => {
    const x = parseYmd(d);
    if (!x) throw badRequest('開催日の形式が読めません: ' + d);
    return x;
  });
  const gm = str(form.gm);
  const series = str(form.series);
  const scenarioId = readScenarioId(ctx, form.scenarioId);
  const members = uniq(splitNames(list(form.members).join('、') + '、' + str(form.extra)));
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  const names = dates.map((_, i) => (i === 0 ? name : m ? m[1]! + (Number(m[2]) + i) + m[3]! : name + ' #' + (i + 1)));
  const at = ctx.now.toISOString();
  const seriesEnd = series ? parseYmd(form.seriesEnd) : null;
  const people: People = { gm: gm ? [gm] : [], member: members, want: [], interest: [] };
  // 卓・関わる人・番号を、日数によらず3文で書く（D1の1回の呼び出しで使える問い合わせの数を超えないように）。
  // 番号は、グループの次の番号から順に振り、最後に進める。1つのbatchなので、途中で失敗すれば番号も進まない
  const [, , seq] = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO sessions (group_id, seq, name, status, date, start_time, end_time, place, memo, series, series_end, window_from, window_to, candidates, editor, updated_at,
                               scenario_id)
         SELECT ?1, (SELECT next_session_seq FROM groups WHERE id = ?1) + json_extract(value, '$.i'), json_extract(value, '$.name'), ?2, json_extract(value, '$.date'),
                ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, '[]', ?9, ?10, ?12
           FROM json_each(?11)`,
      )
      .bind(ctx.group.id, status, normTime(form.start), normTime(form.end), str(form.place), str(form.memo), series, seriesEnd, ctx.actor.name, at,
        JSON.stringify(dates.map((d, i) => ({ i, name: names[i], date: d }))), scenarioId),
    insertPeopleForNext(ctx, dates.length, people),
    ctx.db.prepare('UPDATE groups SET next_session_seq = next_session_seq + ?2 WHERE id = ?1 RETURNING next_session_seq - ?2 AS first').bind(ctx.group.id, dates.length),
  ]);
  const first = (seq!.results[0] as { first: number }).first;
  const ids = dates.map((_, i) => sessionCode(first + i));
  return { ok: true, id: ids[0], ids, names, count: dates.length, message: dates.length + '回分を登録しました: ' + names.join('、') };
}

/** 募集タブの「参加希望」「興味あり」「取り消す」。片方だけ付く。Discordには送らない */
export async function setInterest(ctx: Ctx, form: Form) {
  const name = requireSelf(ctx, form.name);
  const level = str(form.level) || 'none';
  if (!['want', 'interest', 'none'].includes(level)) throw badRequest('操作が不正です: ' + level);
  const s = findSession(ctx, form.id);
  if (s.status !== STATUS.RECRUIT) throw badRequest('「' + s.name + '」は募集中ではありません（' + s.status + '）。');
  if (level !== 'none' && peopleOf(s).includes(name)) throw badRequest(name + 'はすでにこの卓の' + (s.gm === name ? 'GM' : '参加者') + 'です。');
  // 締め切りを過ぎたら、新しく付けられない（取り消すことはできる）
  if (level !== 'none' && s.recruitDue && ctx.today > s.recruitDue) throw badRequest('「' + s.name + '」の募集は締め切りました（' + fmtDateJa(s.recruitDue) + 'まで）。');
  if (level === 'want' && s.capacity !== null && !s.want.includes(name) && s.want.length >= s.capacity) {
    throw badRequest('「' + s.name + '」は定員（' + s.capacity + '人）に達しています。「興味あり」なら付けられます。');
  }
  const want = s.want.filter((n) => n !== name);
  const interest = s.interest.filter((n) => n !== name);
  if (level === 'want') want.push(name);
  if (level === 'interest') interest.push(name);
  await ctx.db.batch([
    ...replacePeople(ctx, [{ rowId: s.rowId, people: { ...peopleOfSession(s), want, interest } }]),
    ctx.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').bind(ctx.now.toISOString(), s.rowId),
  ]);
  const message =
    level === 'want' ? '「' + s.name + '」に参加希望を出しました: ' + name
    : level === 'interest' ? '「' + s.name + '」に興味ありを付けました: ' + name
    : '「' + s.name + '」への希望を取り消しました: ' + name;
  return { ok: true, id: s.id, level, message };
}

export async function deleteSession(ctx: Ctx, form: Form) {
  const s = findSession(ctx, form.id);
  const del = ctx.db.prepare('DELETE FROM sessions WHERE id = ?').bind(s.rowId);
  // 「終了」の卓にシナリオが付いていれば、その卓から出していた通過を、消す前に印として残す
  if (s.status === STATUS.DONE && s.scenarioId !== null) await ctx.db.batch([keepPassesStmt(ctx, [s.rowId]), del]);
  else await del.run();
  return { ok: true, message: '削除しました: ' + s.name };
}

/**
 * 複数の卓をまとめて変える。form: { ids, action, value }
 * action: status / addMember / removeMember / setGm / shiftDays / setSeries / setScenario / delete
 * 卓の数によらず決まった数の文で書く（D1の問い合わせの数の上限のため）
 */
export async function bulkUpdateSessions(ctx: Ctx, form: Form) {
  const ids = list(form.ids);
  if (!ids.length) throw badRequest('卓を選んでください。');
  const action = str(form.action);
  const value = str(form.value);
  const targets = ctx.sessions.filter((s) => ids.includes(s.id));
  if (!targets.length) throw notFound('選んだ卓が見つかりません。');

  // 先に検査して、途中で止まらないようにする。labelはDiscordの「一括で〜」に、doneは返事の「N件の卓〜」に使う
  let label = '';
  let done = '';
  let days = 0;
  if (action === 'status') {
    if (!(STATUS_LIST as string[]).includes(value)) throw badRequest('状態が不正です: ' + value);
    const noDate = targets.filter((s) => !s.date);
    if (DATED.includes(value as Status) && noDate.length) throw badRequest('開催日が無いので「' + value + '」にできません: ' + noDate.map((s) => s.name).join('、'));
    label = '状態を「' + value + '」に';
    done = 'の状態を「' + value + '」にしました';
  } else if (action === 'addMember' || action === 'removeMember' || action === 'setGm') {
    if (!value) throw badRequest('名前を選んでください。');
    if (action === 'setGm') targets.forEach((s) => checkGmChange(ctx, s, value));
    label = action === 'addMember' ? '参加者に' + value + 'を追加' : action === 'removeMember' ? '参加者から' + value + 'を外す' : 'GMを' + value + 'に';
    done = action === 'addMember' ? 'の参加者に' + value + 'を足しました' : action === 'removeMember' ? 'の参加者から' + value + 'を外しました' : 'のGMを' + value + 'にしました';
  } else if (action === 'shiftDays') {
    days = parseInt(value, 10);
    if (Number.isNaN(days) || days === 0) throw badRequest('ずらす日数を入れてください（例: 7や -1）。');
    label = '開催日を' + (days > 0 ? '+' : '') + days + '日';
    done = 'の開催日を' + Math.abs(days) + (days > 0 ? '日後ろ' : '日前') + 'にずらしました';
  } else if (action === 'setSeries') {
    label = value ? 'シリーズを「' + value + '」に' : 'シリーズを外す';
    done = value ? 'のシリーズを「' + value + '」にしました' : 'のシリーズを外しました';
  } else if (action === 'setScenario') {
    const sc = value ? findScenario(ctx, value) : null;
    label = sc ? 'シナリオを「' + sc.name + '」に' : 'シナリオを外す';
    done = sc ? 'のシナリオを「' + sc.name + '」にしました' : 'のシナリオを外しました';
  } else if (action === 'delete') {
    label = '削除';
    done = 'を削除しました';
  } else {
    throw badRequest('操作が不正です: ' + action);
  }

  const db = ctx.db;
  const at = ctx.now.toISOString();
  const rowIds = JSON.stringify(targets.map((s) => s.rowId));
  const inTargets = 'id IN (SELECT value FROM json_each(?1))';
  const stamp = 'editor = ?2, updated_at = ?3';
  const stmts: D1PreparedStatement[] = [];
  const promoted: string[] = [];
  const peopleChanges: { rowId: number; people: People }[] = [];

  if (action === 'delete') {
    // 「終了」の卓から出していた通過は、消す前に印として残す
    if (targets.some((s) => s.status === STATUS.DONE && s.scenarioId !== null)) stmts.push(keepPassesStmt(ctx, targets.map((s) => s.rowId)));
    stmts.push(db.prepare('DELETE FROM sessions WHERE ' + inTargets).bind(rowIds));
  } else if (action === 'status') {
    const v = value as Status;
    const keepWindow = v === STATUS.RECRUIT || v === STATUS.ADJUSTING;
    stmts.push(
      db
        .prepare(
          `UPDATE sessions SET status = ?4, ${stamp},
             asked_at = CASE WHEN ?4 = '募集' THEN asked_at END,
             candidates = CASE WHEN ?4 = '調整中' THEN candidates ELSE '[]' END,
             poll_ready_at = CASE WHEN ?4 = '調整中' THEN poll_ready_at END,
             window_from = CASE WHEN ?5 THEN window_from END, window_to = CASE WHEN ?5 THEN window_to END, urged_at = CASE WHEN ?5 THEN urged_at END,
             capacity = CASE WHEN ?4 = '募集' THEN capacity END, recruit_due = CASE WHEN ?4 = '募集' THEN recruit_due END,
             due_urged_at = CASE WHEN ?4 = '募集' THEN due_urged_at END
           WHERE ${inTargets}`,
        )
        .bind(rowIds, ctx.actor.name, at, v, keepWindow ? 1 : 0),
    );
    if (v !== STATUS.ADJUSTING) stmts.push(db.prepare('DELETE FROM poll_votes WHERE session_id IN (SELECT value FROM json_each(?))').bind(rowIds));
    if (PROMOTE.includes(v)) {
      for (const s of targets) {
        if (!s.want.length) continue;
        // 参加希望の人を参加者に移す
        const add = s.want.filter((n) => !s.members.includes(n) && n !== s.gm);
        peopleChanges.push({ rowId: s.rowId, people: { ...peopleOfSession(s), member: uniq(s.members.concat(add)), want: [] } });
        add.forEach((n) => promoted.push(n + '（' + s.name + '）'));
      }
    }
  } else if (action === 'shiftDays') {
    stmts.push(
      db.prepare(`UPDATE sessions SET date = date(date, ?4), notified_at = NULL, soon_at = NULL, ${stamp} WHERE ${inTargets} AND date IS NOT NULL`)
        .bind(rowIds, ctx.actor.name, at, (days > 0 ? '+' : '') + days + ' days'),
    );
  } else if (action === 'setSeries') {
    stmts.push(db.prepare(`UPDATE sessions SET series = ?4, ${stamp} WHERE ${inTargets}`).bind(rowIds, ctx.actor.name, at, value));
  } else if (action === 'setScenario') {
    stmts.push(db.prepare(`UPDATE sessions SET scenario_id = ?4, ${stamp} WHERE ${inTargets}`).bind(rowIds, ctx.actor.name, at, readScenarioId(ctx, value)));
  } else {
    for (const s of targets) {
      const p = peopleOfSession(s);
      if (action === 'addMember') p.member = uniq(s.members.concat([value]));
      if (action === 'removeMember') p.member = s.members.filter((n) => n !== value);
      if (action === 'setGm') p.gm = [value];
      peopleChanges.push({ rowId: s.rowId, people: p });
    }
    stmts.push(db.prepare(`UPDATE sessions SET ${stamp} WHERE ${inTargets}`).bind(rowIds, ctx.actor.name, at));
  }
  stmts.push(...replacePeople(ctx, peopleChanges));
  // 参加者から外した人のHOの割り当ても外す
  const assigned = peopleChanges.filter((c) => targets.find((s) => s.rowId === c.rowId)!.slots.some((x) => x.memberId !== null));
  if (assigned.length) stmts.push(unassignGoneStmt(ctx, assigned.map((c) => c.rowId)));
  // 行けなくなった印も片付ける（開催日をずらしたら全部）
  const absent = targets.filter((s) => s.absent.length);
  if (absent.length && action !== 'delete') stmts.push(absenceCleanupStmt(ctx, absent.map((s) => s.rowId), action === 'shiftDays'));
  await db.batch(stmts);
  let message = targets.length + '件の卓' + done + ': ' + targets.map((s) => s.name).join('、');
  if (promoted.length) message += '　参加希望の人を参加者に加えました: ' + promoted.join('、');
  return { ok: true, count: targets.length, message, names: targets.map((s) => s.name), ids: targets.map((s) => s.id), label };
}
