// 画面からの呼び出し（POST /api/g/:groupId/:fn）。formと返事の形はGAS版のまま。
// 呼べる関数はここの一覧だけ。名前は画面と共有する（src/shared/api.tsのRPC_FUNCS。足りなくても多すぎても型の確認で止まる）。
// 管理者だけの関数はadminに「何ができるのは管理者だけか」を書く
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { appOrigin } from '../auth/origin';
import { currentViewer } from '../auth/session';
import { sendDiscordStep } from '../discord/step';
import { realSleep } from '../discord/send';
import { setAvailability, setAvailabilityBulk, setAvailNote, setDayNote } from '../domain/availability';
import { deleteCalendarFeed, saveCalendarFeed } from '../domain/calendar';
import { consoleData } from '../domain/console-data';
import { type Form, readForm } from '../domain/form';
import { loadGroup } from '../domain/load';
import { deleteMember, saveMember, setAdmin, setShareBusy } from '../domain/members';
import { cancelPoll, decidePoll, type Io, setPollVote, setPollVoteAll, setPollVoteFromAvail, startPoll } from '../domain/polls';
import { bulkUpdateSessions, deleteSession, saveSession, setInterest } from '../domain/sessions';
import { getDiscordChannels, renameGroup, saveConsoleSettings, saveSeriesNotify } from '../domain/settings';
import type { Ctx } from '../domain/types';
import { googleConfigured, googleDeps } from '../google/config';
import { hasGoogleWriters, syncGroupWrites } from '../google/sync';
import { saveGoogleSettings, syncGoogleNow, unlinkGoogle, unlinkGoogleLogin } from '../domain/google';
import { deleteGroup } from '../domain/groups';
import { deleteScenario, saveScenario, setScenarioMark } from '../domain/scenarios';
import { assignSlots, savePrep, saveSlotSecret, setSlotHope, submitSheet } from '../domain/prep';
import { setAbsence } from '../domain/absence';
import { getSessionHistory } from '../domain/history';
import { saveRecord, setPcRecord } from '../domain/records';
import { AppError, adminError, authError, goneError, notFound } from '../lib/errors';
import type { RpcName } from '../../shared/api';

type Entry = {
  run: (ctx: Ctx, form: Form, io: Io) => Promise<Record<string, unknown>>;
  /** 管理者だけ。値は「〜ができるのは管理者だけです」の〜 */
  admin?: string;
  /** 返事に最新の画面データ（data）を付けるか。付ければ画面は読み直さずに済む */
  data?: boolean;
  /** 卓（Googleカレンダーに書く中身）を変えるか。変えたら、返事のあとで、連携している人の予定を書き直す */
  calendar?: boolean;
  /** Googleとの連携の一式（io.google）を使うか */
  google?: boolean;
};

export const RPC: Record<Exclude<RpcName, 'getConsoleData'>, Entry> = {
  saveSession: { run: saveSession, data: true, calendar: true },
  setInterest: { run: setInterest, data: true },
  deleteSession: { run: deleteSession, admin: '卓の削除', data: true, calendar: true },
  bulkUpdateSessions: { run: bulkUpdateSessions, admin: '卓をまとめて変えること', data: true, calendar: true },
  saveMember: { run: saveMember, data: true, calendar: true },
  deleteMember: { run: deleteMember, admin: 'メンバーを外すこと', data: true, calendar: true },
  setAdmin: { run: setAdmin, admin: '管理者の名簿を変えること', data: true },
  setAvailability: { run: setAvailability },
  setAvailabilityBulk: { run: setAvailabilityBulk, data: true },
  setAvailNote: { run: setAvailNote, data: true },
  setDayNote: { run: setDayNote, data: true },
  startPoll: { run: startPoll, data: true, calendar: true },
  setPollVote: { run: setPollVote, data: true },
  setPollVoteAll: { run: setPollVoteAll, data: true },
  setPollVoteFromAvail: { run: setPollVoteFromAvail, data: true },
  decidePoll: { run: decidePoll, data: true, calendar: true },
  cancelPoll: { run: cancelPoll, data: true, calendar: true },
  saveConsoleSettings: { run: saveConsoleSettings, admin: '設定を変えること', data: true },
  saveSeriesNotify: { run: saveSeriesNotify, admin: 'シリーズごとの設定を変えること', data: true },
  renameGroup: { run: renameGroup, admin: 'グループの名前を変えること', data: true, calendar: true },
  sendDiscordStep: { run: sendDiscordStep },
  getDiscordChannels: { run: getDiscordChannels, admin: '知らせのチャンネルの一覧を読むこと' },
  saveCalendarFeed: { run: saveCalendarFeed, data: true },
  deleteCalendarFeed: { run: deleteCalendarFeed, data: true },
  saveGoogleSettings: { run: saveGoogleSettings, data: true, google: true },
  syncGoogleNow: { run: syncGoogleNow, data: true, google: true },
  unlinkGoogle: { run: unlinkGoogle, data: true, google: true },
  unlinkGoogleLogin: { run: unlinkGoogleLogin, data: true },
  saveScenario: { run: saveScenario, data: true },
  // 消せるのは登録した人と管理者（中で確かめる）
  deleteScenario: { run: deleteScenario, data: true, calendar: true },
  setScenarioMark: { run: setScenarioMark, data: true },
  // 卓の準備。だれが書けるかは中で確かめる（GM・管理者・本人）
  savePrep: { run: savePrep, data: true },
  saveSlotSecret: { run: saveSlotSecret, data: true },
  assignSlots: { run: assignSlots, data: true },
  setSlotHope: { run: setSlotHope, data: true },
  submitSheet: { run: submitSheet, data: true },
  // 行けなくなった（本人だけ。開催の卓の参加者）。Googleの予定からも外れるので、書き直す
  setAbsence: { run: setAbsence, data: true, calendar: true },
  // 本人の設定（どのグループにも効く）
  setShareBusy: { run: setShareBusy, data: true },
  // 卓の変更の履歴を読む（書かないので、画面のデータは付けない）
  getSessionHistory: { run: getSessionHistory },
  // 卓の記録（GMか管理者）と、自分のPC（参加者本人）。だれが書けるかは中で確かめる
  saveRecord: { run: saveRecord, data: true },
  setPcRecord: { run: setPcRecord, data: true },
  // 消したあとは画面のデータを読めないのでdataを付けない
  deleteGroup: { run: deleteGroup, admin: 'グループを消すこと' },
};

/** 最後に使われた日時（運営者の管理画面に出す）。書き込みを減らすため、10分に1回まで書き換える */
const TOUCH_MS = 10 * 60_000;
async function touchGroup(db: D1Database, groupId: string, now = new Date()): Promise<void> {
  await db.prepare('UPDATE groups SET last_used_at = ?1 WHERE id = ?2 AND (last_used_at IS NULL OR last_used_at < ?3)')
    .bind(now.toISOString(), groupId, new Date(now.getTime() - TOUCH_MS).toISOString())
    .run();
}

export const rpcRoutes = new Hono<AppEnv>();

rpcRoutes.post('/api/g/:groupId/:fn', async (c) => {
  const fn = c.req.param('fn');
  const entry = Object.hasOwn(RPC, fn) ? RPC[fn as keyof typeof RPC] : undefined;
  if (!entry && fn !== 'getConsoleData') throw notFound('そんな操作はありません: ' + fn);
  const groupId = c.req.param('groupId');
  const access = await groupAccess(c.env.DB, await currentViewer(c), groupId, c.env.DISCORD_BOT_TOKEN);
  if (!access.ok) {
    if (access.reason === 'notfound') throw goneError();
    if (access.reason === 'forbidden') throw new AppError(403, 'このグループのDiscordサーバーのメンバーではありません。');
    throw authError('ログインし直してください。');
  }
  await touchGroup(c.env.DB, groupId);
  const appUrl = appOrigin(c.env, c.req.url) + '/g/' + groupId + '/';
  const load = () =>
    loadGroup(c.env.DB, groupId, access.actor, appUrl, new Date(), { token: c.env.DISCORD_BOT_TOKEN ?? '', clientId: c.env.DISCORD_CLIENT_ID }, googleConfigured(c.env));
  const ctx = await load();
  if (!entry) return c.json(consoleData(ctx));
  if (entry.admin && !access.actor.isAdmin) throw adminError(entry.admin);
  const form = await readForm(c.req);
  const google = entry.google || entry.calendar ? await googleDeps(c.env, appOrigin(c.env, c.req.url)) : null;
  // 裏の仕事（Googleとの同期）は、失敗を自分で連携の印に残すので、ここでは拾わない
  const defer = (work: Promise<unknown>) => c.executionCtx.waitUntil(work);
  const io: Io = { reload: load, data: async () => consoleData(await load()), sleep: realSleep, google, defer };
  const result = await entry.run(ctx, form, io);
  // 卓が変わったら、このグループでGoogleに書き込んでいる人がいるときだけ、返事のあとで予定を書き直す
  if (entry.calendar && google && (await hasGoogleWriters(c.env.DB, groupId))) defer(syncGroupWrites(c.env.DB, google, groupId, new Date()));
  // 卓をDiscordのイベントに出しているグループは、書き直しが要る印を付ける（書くのは見回り。重なって同じイベントを作らないように）
  if (entry.calendar && ctx.group.discord_events === 1) await c.env.DB.prepare('UPDATE groups SET events_pending = 1 WHERE id = ?').bind(groupId).run();
  // 書き込みが読み直した中身を返していれば、そのまま使う（もう一度読まない）
  if (entry.data && !result.data) result.data = await io.data();
  return c.json(result);
});
