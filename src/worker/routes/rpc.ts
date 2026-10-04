// 画面からの呼び出し（POST /api/g/:groupId/:fn）。form と返事の形は GAS 版のまま。
// 呼べる関数はここの一覧だけ。名前は画面と共有する（src/shared/api.ts の RPC_FUNCS。足りなくても多すぎても型の確認で止まる）。
// 管理者だけの関数は admin に「何ができるのは管理者だけか」を書く
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { appOrigin } from '../auth/origin';
import { currentViewer } from '../auth/session';
import { sendDiscordStep } from '../discord/step';
import { realSleep } from '../discord/send';
import { setAvailability, setAvailabilityBulk, setAvailNote, setDayNote } from '../domain/availability';
import { consoleData } from '../domain/console-data';
import { type Form, readForm } from '../domain/form';
import { loadGroup } from '../domain/load';
import { deleteMember, saveMember, setAdmin } from '../domain/members';
import { cancelPoll, decidePoll, type Io, setPollVote, setPollVoteAll, startPoll } from '../domain/polls';
import { bulkUpdateSessions, deleteSession, saveSession, setInterest } from '../domain/sessions';
import { renameGroup, saveConsoleSettings, saveSeriesNotify } from '../domain/settings';
import type { Ctx } from '../domain/types';
import { deleteGroup } from '../domain/groups';
import { AppError, adminError, authError, goneError, notFound } from '../lib/errors';
import type { RpcName } from '../../shared/api';

type Entry = {
  run: (ctx: Ctx, form: Form, io: Io) => Promise<Record<string, unknown>>;
  /** 管理者だけ。値は「〜ができるのは管理者だけです」の〜 */
  admin?: string;
  /** 返事に最新の画面データ（data）を付けるか。付ければ画面は読み直さずに済む */
  data?: boolean;
};

export const RPC: Record<Exclude<RpcName, 'getConsoleData'>, Entry> = {
  saveSession: { run: saveSession, data: true },
  setInterest: { run: setInterest, data: true },
  deleteSession: { run: deleteSession, admin: '卓の削除', data: true },
  bulkUpdateSessions: { run: bulkUpdateSessions, admin: '卓をまとめて変えること', data: true },
  saveMember: { run: saveMember, data: true },
  deleteMember: { run: deleteMember, admin: 'メンバーを外すこと', data: true },
  setAdmin: { run: setAdmin, admin: '管理者の名簿を変えること', data: true },
  setAvailability: { run: setAvailability },
  setAvailabilityBulk: { run: setAvailabilityBulk, data: true },
  setAvailNote: { run: setAvailNote, data: true },
  setDayNote: { run: setDayNote, data: true },
  startPoll: { run: startPoll, data: true },
  setPollVote: { run: setPollVote, data: true },
  setPollVoteAll: { run: setPollVoteAll, data: true },
  decidePoll: { run: decidePoll, data: true },
  cancelPoll: { run: cancelPoll, data: true },
  saveConsoleSettings: { run: saveConsoleSettings, admin: '設定を変えること', data: true },
  saveSeriesNotify: { run: saveSeriesNotify, admin: 'シリーズごとの設定を変えること', data: true },
  renameGroup: { run: renameGroup, admin: 'グループの名前を変えること', data: true },
  sendDiscordStep: { run: sendDiscordStep },
  // 消したあとは画面のデータを読めないので data を付けない
  deleteGroup: { run: deleteGroup, admin: 'グループを消すこと' },
};

/** 最後に使われた日時（運営者の管理画面に出す）。書き込みを減らすため、10 分に 1 回まで書き換える */
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
  const access = await groupAccess(c.env.DB, await currentViewer(c), groupId);
  if (!access.ok) {
    if (access.reason === 'notfound') throw goneError();
    if (access.reason === 'forbidden') throw new AppError(403, 'このグループの Discord サーバーのメンバーではありません。');
    throw authError('ログインし直してください。');
  }
  await touchGroup(c.env.DB, groupId);
  const appUrl = appOrigin(c.env, c.req.url) + '/g/' + groupId + '/';
  const load = () => loadGroup(c.env.DB, groupId, access.actor, appUrl);
  const ctx = await load();
  if (!entry) return c.json(consoleData(ctx));
  if (entry.admin && !access.actor.isAdmin) throw adminError(entry.admin);
  const form = await readForm(c.req);
  const io: Io = { reload: load, data: async () => consoleData(await load()), sleep: realSleep };
  const result = await entry.run(ctx, form, io);
  if (entry.data) result.data = await io.data();
  return c.json(result);
});
