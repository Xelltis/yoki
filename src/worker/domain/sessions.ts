// 卓の登録・変更・削除・参加希望・まとめての変更（GAS 版 Sessions.js）
import { badRequest, notFound } from '../lib/errors';
import { normTime, parseYmd } from '../lib/jst';
import { splitNames, uniq } from '../lib/text';
import { DATED, PROMOTE, STATUS, STATUS_LIST, type Status } from './constants';
import { type Form, list, requireSelfOrAdmin, str } from './form';
import { sessionCode } from './load';
import { findSession, peopleOf, readWindow, windowInfo } from './model';
import { insertPeopleForSeq, type People, peopleOfSession, replacePeople } from './people';
import type { Ctx } from './types';

/** 状態を読む。知らない値は「開催」（旧い版の「予定」も「開催」） */
function readStatus(v: unknown): Status {
  const s = str(v);
  return (STATUS_LIST as string[]).includes(s) ? (s as Status) : STATUS.HELD;
}

/** 新しい卓の番号を n 個とる（使った番号は使い直さない） */
async function allocateSeq(ctx: Ctx, n: number): Promise<number> {
  const r = await ctx.db
    .prepare('UPDATE groups SET next_session_seq = next_session_seq + ?2 WHERE id = ?1 RETURNING next_session_seq - ?2 AS first')
    .bind(ctx.group.id, n)
    .first<{ first: number }>();
  return r!.first;
}

const INSERT_SESSION = `INSERT INTO sessions (group_id, seq, name, status, date, start_time, end_time, place, memo, series, series_end,
  window_from, window_to, candidates, editor, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, '[]', ?14, ?15)`;

/** 卓を登録・更新する。form.dates に 2 日以上あれば、まとめて登録する（新規だけ） */
export async function saveSession(ctx: Ctx, form: Form) {
  const name = str(form.name);
  if (!name) throw badRequest('卓の名前を入れてください。');
  const dates = uniq(list(form.dates)).sort();
  if (dates.length > 1) return saveSessionDates(ctx, form, name, dates);
  const status = readStatus(form.status);
  const date = form.date ? parseYmd(form.date) : null;
  if (form.date && !date) throw badRequest('開催日の形式が読めません: ' + str(form.date));
  if (!date && DATED.includes(status)) throw badRequest('開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。');
  // 期間。募集は「開催したい期間」、調整中は「候補の期間」。この 2 つの状態だけが持つ
  const win = status === STATUS.RECRUIT || status === STATUS.ADJUSTING ? readWindow(form.windowFrom, form.windowTo) : null;
  const gm = str(form.gm);
  const series = str(form.series);
  let members = uniq(splitNames(list(form.members).join('、') + '、' + str(form.extra)));
  const existing = form.id ? findSession(ctx, form.id) : null;
  const dateChanged = !existing || existing.date !== date;
  // 参加希望・興味あり。参加者や GM になった人は外す。募集から「調整中」「開催」になったら、参加希望の人を参加者に移す
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
             notified_at = ?16, asked_at = ?17, urged_at = ?18, soon_at = ?19, poll_ready_at = ?20
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
        ),
      ...replacePeople(ctx, [{ rowId: existing.rowId, people }]),
    );
    // 調整中でなくなったら、日程調整の回答も消す（候補日と一緒に）
    if (status !== STATUS.ADJUSTING) stmts.push(db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(existing.rowId));
  } else {
    const seq = await allocateSeq(ctx, 1);
    id = sessionCode(seq);
    stmts.push(
      db.prepare(INSERT_SESSION).bind(ctx.group.id, seq, name, status, date, start, end, str(form.place), str(form.memo), series, seriesEnd, win?.from ?? null, win?.to ?? null, ctx.actor.name, at),
      insertPeopleForSeq(ctx, seq, people),
    );
  }
  // 単発の卓から「続けて登録」したときは、元の回にも同じシリーズ名を入れて 1 つのシリーズにする（元の回にシリーズ名が無いときだけ）
  let linked = false;
  const from = series && form.seriesFrom ? ctx.sessions.find((x) => x.id === str(form.seriesFrom)) : undefined;
  if (from && !from.series) {
    stmts.push(db.prepare('UPDATE sessions SET series = ?2, series_end = COALESCE(?3, series_end) WHERE id = ?1').bind(from.rowId, series, seriesEnd));
    linked = true;
  }
  await db.batch(stmts);
  let message = (existing ? '更新しました: ' : '登録しました: ') + name + '（' + id + '）';
  if (linked) message += '　前の回も「' + series + '」にまとめました。';
  if (promoted.length) message += '　参加希望の ' + promoted.join('、') + ' を参加者に加えました。';
  if (dropped.length) message += '　興味ありの ' + dropped.join('、') + ' は外しました。';
  return { ok: true, id, message, promoted, dropped };
}

/**
 * 複数の開催日をまとめて登録する（新規だけ）。GM・参加者・時間・場所・メモ・シリーズは全部同じ。
 * 名前は末尾の数字を進める（「#1」→「#2」）。数字が無ければ 2 回目から「名前 #2」
 */
async function saveSessionDates(ctx: Ctx, form: Form, name: string, raw: string[]) {
  if (form.id) throw badRequest('複数日をまとめて登録できるのは新規のときだけです。');
  const status = readStatus(form.status);
  if (!DATED.includes(status)) throw badRequest('複数日をまとめて登録するときは、状態を「開催」にします。');
  const dates = raw.map((d) => {
    const x = parseYmd(d);
    if (!x) throw badRequest('開催日の形式が読めません: ' + d);
    return x;
  });
  const gm = str(form.gm);
  const series = str(form.series);
  const members = uniq(splitNames(list(form.members).join('、') + '、' + str(form.extra)));
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  const names = dates.map((_, i) => (i === 0 ? name : m ? m[1]! + (Number(m[2]) + i) + m[3]! : name + ' #' + (i + 1)));
  const first = await allocateSeq(ctx, dates.length);
  const at = ctx.now.toISOString();
  const seriesEnd = series ? parseYmd(form.seriesEnd) : null;
  const people: People = { gm: gm ? [gm] : [], member: members, want: [], interest: [] };
  const stmts = dates.flatMap((d, i) => [
    ctx.db.prepare(INSERT_SESSION).bind(ctx.group.id, first + i, names[i], status, d, normTime(form.start), normTime(form.end), str(form.place), str(form.memo), series, seriesEnd, null, null, ctx.actor.name, at),
    insertPeopleForSeq(ctx, first + i, people),
  ]);
  await ctx.db.batch(stmts);
  const ids = dates.map((_, i) => sessionCode(first + i));
  return { ok: true, id: ids[0], ids, names, count: dates.length, message: dates.length + ' 回分を登録しました: ' + names.join('、') };
}

/** 募集タブの「参加希望」「興味あり」「取り消す」。片方だけ付く。Discord には送らない */
export async function setInterest(ctx: Ctx, form: Form) {
  requireSelfOrAdmin(ctx, form.name);
  const name = str(form.name);
  if (!name) throw badRequest('上の「あなた」で自分を選んでください。');
  const level = str(form.level) || 'none';
  if (!['want', 'interest', 'none'].includes(level)) throw badRequest('操作が不正です: ' + level);
  const s = findSession(ctx, form.id);
  if (s.status !== STATUS.RECRUIT) throw badRequest('「' + s.name + '」は募集中ではありません（' + s.status + '）。');
  if (level !== 'none' && peopleOf(s).includes(name)) throw badRequest(name + ' はすでにこの卓の' + (s.gm === name ? 'GM' : '参加者') + 'です。');
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
  await ctx.db.prepare('DELETE FROM sessions WHERE id = ?').bind(s.rowId).run();
  return { ok: true, message: '削除しました: ' + s.name };
}

/**
 * 複数の卓をまとめて変える。form: { ids, action, value }
 * action: status / addMember / removeMember / setGm / shiftDays / setSeries / delete
 * 卓の数によらず決まった数の文で書く（D1 の問い合わせの数の上限のため）
 */
export async function bulkUpdateSessions(ctx: Ctx, form: Form) {
  const ids = list(form.ids);
  if (!ids.length) throw badRequest('卓を選んでください。');
  const action = str(form.action);
  const value = str(form.value);
  const targets = ctx.sessions.filter((s) => ids.includes(s.id));
  if (!targets.length) throw notFound('選んだ卓が見つかりません。');

  // 先に検査して、途中で止まらないようにする。label は Discord の「一括で〜」に、done は返事の「N 件の卓〜」に使う
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
    label = action === 'addMember' ? '参加者に ' + value + ' を追加' : action === 'removeMember' ? '参加者から ' + value + ' を外す' : 'GM を ' + value + ' に';
    done = action === 'addMember' ? 'の参加者に ' + value + ' を足しました' : action === 'removeMember' ? 'の参加者から ' + value + ' を外しました' : 'の GM を ' + value + ' にしました';
  } else if (action === 'shiftDays') {
    days = parseInt(value, 10);
    if (Number.isNaN(days) || days === 0) throw badRequest('ずらす日数を入れてください（例: 7 や -1）。');
    label = '開催日を ' + (days > 0 ? '+' : '') + days + ' 日';
    done = 'の開催日を ' + Math.abs(days) + (days > 0 ? ' 日後ろ' : ' 日前') + 'にずらしました';
  } else if (action === 'setSeries') {
    label = value ? 'シリーズを「' + value + '」に' : 'シリーズを外す';
    done = value ? 'のシリーズを「' + value + '」にしました' : 'のシリーズを外しました';
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
             window_from = CASE WHEN ?5 THEN window_from END, window_to = CASE WHEN ?5 THEN window_to END, urged_at = CASE WHEN ?5 THEN urged_at END
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
  await db.batch(stmts);
  let message = targets.length + ' 件の卓' + done + ': ' + targets.map((s) => s.name).join('、');
  if (promoted.length) message += '　参加希望の人を参加者に加えました: ' + promoted.join('、');
  return { ok: true, count: targets.length, message, names: targets.map((s) => s.name), ids: targets.map((s) => s.id), label };
}
