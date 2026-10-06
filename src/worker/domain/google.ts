// Googleカレンダーとの連携の設定（画面から）。連携は人ごとで、どのグループの画面から変えても同じ。
// 書き込み・読み込みのオンとオフと時間帯を変える、今すぐ同期する、連携を外す。連携を始めるのはroutes/google.ts（OAuth）
import { type GoogleDeps } from '../google/config';
import { CALL_BUDGET, removeBusyMarks, removeEvents, syncUser, tryAccessToken, windowMinutes } from '../google/sync';
import { badRequest } from '../lib/errors';
import { normTime } from '../lib/jst';
import { open } from '../lib/secretbox';
import { type Form, str } from './form';
import type { Io } from './polls';
import type { Ctx } from './types';

function requireGoogle(ctx: Ctx, io: Io): GoogleDeps {
  if (!io.google) throw badRequest('Googleカレンダーとの連携は、運営者が設定していないので使えません。');
  if (!ctx.google) throw badRequest('Googleと連携していません。');
  return io.google;
}

/** 暗号にしたrefresh token（連携の行が無ければ空） */
async function sealedToken(db: D1Database, userId: string): Promise<string> {
  return (await db.prepare('SELECT refresh_token FROM google_links WHERE user_id = ?').bind(userId).first<string>('refresh_token')) ?? '';
}

const removedText = (n: number) => (n ? '書き込んだ予定を' + n + '件消しました。' : '');

/**
 * 設定を変える。form: { write: 卓を書き込むか, read: 予定から印を入れるか, from / to: 印を決める時間帯（HH:MM。toは24:00まで） }。
 * 書き込みをやめたら書いた予定を消し、読み込みをやめたらGoogleから入れた印を消す。オンのものは、返事のあとですぐに同期する
 */
export async function saveGoogleSettings(ctx: Ctx, form: Form, io: Io) {
  const deps = requireGoogle(ctx, io);
  const link = ctx.google!;
  const write = !!form.write, read = !!form.read;
  const from = normTime(form.from), to = str(form.to) === '24:00' ? '24:00' : normTime(form.to);
  const fm = windowMinutes(from), tm = windowMinutes(to);
  if (fm === null || tm === null) throw badRequest('時間帯は19:00のように入れてください。');
  if (fm >= tm) throw badRequest('時間帯の終わりは、始まりより後にしてください。');
  const userId = ctx.actor.userId;
  let removed = 0;
  if (link.write_events === 1 && !write) {
    const at = await tryAccessToken(ctx.db, deps, userId, await sealedToken(ctx.db, userId), ctx.now);
    removed = await removeEvents(ctx.db, deps, at, userId, { left: CALL_BUDGET });
  }
  await ctx.db.batch([
    ctx.db.prepare('UPDATE google_links SET write_events = ?, read_busy = ?, busy_from = ?, busy_to = ?, busy_at = NULL WHERE user_id = ?').bind(write ? 1 : 0, read ? 1 : 0, from, to, userId),
    ...(link.read_busy === 1 && !read ? removeBusyMarks(ctx.db, userId) : []),
  ]);
  if (write || read) io.defer?.(syncUser(ctx.db, deps, userId, ctx.now, { write, busy: read }));
  return { ok: true, message: 'Google連携の設定を保存しました。' + removedText(removed) };
}

/** 今すぐ同期する（卓の書き込みと、予定の読み込み） */
export async function syncGoogleNow(ctx: Ctx, _form: Form, io: Io) {
  const deps = requireGoogle(ctx, io);
  const r = await syncUser(ctx.db, deps, ctx.actor.userId, ctx.now, { write: true, busy: true });
  if (!r.ok) throw badRequest(r.message);
  return { ok: true, message: r.message };
}

/**
 * 1人の連携を片付ける。書き込んだ予定・Googleから入れた印・連携の行（refresh token）を消し、Googleの許可も取り消す。
 * 本人が外すとき（unlinkGoogle）と、運営者が利用者を消すとき（domain/admin.tsのdeleteUser）に使う。消した予定の数を返す
 */
export async function forgetGoogle(db: D1Database, deps: GoogleDeps, userId: string, now: Date): Promise<number> {
  const sealed = await sealedToken(db, userId);
  const at = await tryAccessToken(db, deps, userId, sealed, now);
  const removed = await removeEvents(db, deps, at, userId, { left: CALL_BUDGET });
  try {
    await deps.api.revoke(await open(deps.key, sealed));
  } catch {
    // 鍵を替えたなどで読めないtokenは、取り消せない（本人がGoogleのアカウントの画面から外せる）
  }
  await db.batch([...removeBusyMarks(db, userId), db.prepare('DELETE FROM google_links WHERE user_id = ?').bind(userId)]);
  return removed;
}

/** Googleでのログインを外す（Discordでは今までどおりログインできる。カレンダーとの連携は別で、そのまま） */
export async function unlinkGoogleLogin(ctx: Ctx) {
  await ctx.db.prepare('DELETE FROM google_logins WHERE user_id = ?').bind(ctx.actor.userId).run();
  return { ok: true, message: 'Googleでのログインを外しました。Discordでは、今までどおりログインできます。' };
}

/** 連携を外す（forgetGoogle） */
export async function unlinkGoogle(ctx: Ctx, _form: Form, io: Io) {
  const deps = requireGoogle(ctx, io);
  const removed = await forgetGoogle(ctx.db, deps, ctx.actor.userId, ctx.now);
  return { ok: true, message: 'Googleとの連携を外しました。' + removedText(removed) };
}
