// 運営者への知らせ。運営者（OPERATOR_IDS）に、YokiのBotからDiscordのDMで送る。
//   新しいバージョン: 毎日10時台に1回、元のリポジトリの最新のReleaseを見て（運営の管理画面の「更新」と同じ控え）、まだ知らせていない版なら送る
//   見回りの失敗: 続けて3回失敗したら送る（続けて失敗しているあいだは1回だけ）
//   Botのトークン: 毎時、使えるかを確かめる。使えないあいだはDMも送れないので、運営の管理画面に出し、また使えるようになったら送る
// 運営の管理画面で止められる（metaのoperator_dmが'0'）。試しに送るのは、止めていても送る
import type { AdminOverview, BotCheck, NoticeLast } from '../../shared/admin';
import { parseOperatorIds } from '../auth/operator';
import { savedOrigin } from '../auth/origin';
import { botGet } from '../discord/channel';
import { sendDm } from '../discord/dm';
import type { Bindings } from '../env';
import { badRequest } from '../lib/errors';
import { jst } from '../lib/jst';
import type { UpdateDeps } from '../update/config';
import { APP_VERSION } from '../version';
import { checkRelease, newer } from './update';

export const NOTICE_KEYS = { on: 'operator_dm', last: 'operator_notice_last', version: 'operator_notice_version', bot: 'bot_check' } as const;
/** 見回りが続けて何回失敗したら知らせるか（5分おきなので、15分ほど） */
export const PATROL_FAILS_NOTICE = 3;
/** 新しいバージョンを見る時刻（日本時間。夜中にDMが鳴らないように） */
export const VERSION_HOUR = 10;
/** 新しいバージョンを見るときにGitHubを呼ぶ数の上限（見回りが、外へ出せる呼び出しの残りから引く） */
export const GITHUB_CALLS = 2;

type Env = Pick<Bindings, 'DB' | 'DISCORD_BOT_TOKEN' | 'OPERATOR_IDS' | 'APP_URL'>;

const putMeta = (db: D1Database, key: string, value: string) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value).run();
const getMeta = (db: D1Database, key: string) => db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<string>('value');
function parse<T>(raw: string | null | undefined): T | null {
  try { return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
/** 日時を、DMに書く日本時間（2026-10-10 20:05）にする */
function jstText(iso: string): string {
  const p = jst(new Date(iso));
  return p.ymd + ' ' + String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
}

/** 運営の管理画面の「様子」に出す中身。metaはoverviewがまとめて読んだもの */
export function noticeOverview(m: Record<string, string>, env: { operators: number; botToken: boolean }): AdminOverview['notices'] {
  const bot = parse<BotCheck>(m[NOTICE_KEYS.bot]);
  return {
    on: m[NOTICE_KEYS.on] !== '0',
    operators: env.operators,
    bot: { state: !env.botToken ? 'missing' : !bot ? 'unknown' : bot.ok ? 'ok' : 'bad', at: bot?.at ?? '', since: bot?.since ?? '' },
    version: m[NOTICE_KEYS.version] ?? '',
    last: parse<NoticeLast>(m[NOTICE_KEYS.last]),
  };
}

/** 運営者への知らせを使う・止める */
export async function setNoticeOn(db: D1Database, on: boolean): Promise<string> {
  await putMeta(db, NOTICE_KEYS.on, on ? '1' : '0');
  return on ? '運営者への知らせを、DiscordのDMで送ります。' : '運営者への知らせを止めました。';
}

/** idsの人にDMを送り、結果を控える */
async function send(env: Env, kind: string, content: string, ids: string[], now: Date): Promise<NoticeLast> {
  const token = env.DISCORD_BOT_TOKEN;
  let sent = 0, failed = 0, error = '';
  for (const id of ids) {
    const r = token ? await sendDm(token, id, content) : { ok: false, error: 'Botのトークンがありません' };
    if (r.ok) sent++;
    else { failed++; error ||= r.error; }
  }
  const last: NoticeLast = { at: now.toISOString(), kind, sent, failed, error };
  await putMeta(env.DB, NOTICE_KEYS.last, JSON.stringify(last));
  return last;
}

/** 運営者みんなに送る。止めている・運営者がいなければ送らずにnull */
export async function notifyOperators(env: Env, kind: string, content: string, now: Date): Promise<NoticeLast | null> {
  const ids = parseOperatorIds(env.OPERATOR_IDS);
  if (!ids.length || (await getMeta(env.DB, NOTICE_KEYS.on)) === '0') return null;
  return send(env, kind, content, ids, now);
}

/** 試しに、押した運営者にだけ送る（止めていても送る） */
export async function testNotice(env: Env, userId: string, now: Date): Promise<string> {
  if (!env.DISCORD_BOT_TOKEN) throw badRequest('YokiのBotのトークンが無いので、DMを送れません。WorkerのsecretにDISCORD_BOT_TOKENを入れてください。');
  const r = await send(env, '試し', '🔔 Yokiからの試しのDMです。運営者への知らせは、このように届きます。', [userId], now);
  if (!r.sent) throw badRequest('DMを送れませんでした（' + r.error + '）。');
  return 'DMを送りました。Discordで届いたかを確かめてください。';
}

/** 見回りの失敗。続けて失敗した回数が、ちょうど知らせる回数になったときだけ送る */
export async function noticePatrolFailed(env: Env, fails: number, error: string, now: Date): Promise<void> {
  if (fails !== PATROL_FAILS_NOTICE) return;
  const origin = await savedOrigin(env);
  const text = '⚠️ Yokiの知らせの見回りが、' + fails + '回続けて失敗しています（最後は' + jstText(now.toISOString()) + '）。\n理由: ' + error
    + (origin ? '\n運営の管理画面: ' + origin + '/admin/' : '');
  await notifyOperators(env, '見回りの失敗', text, now);
}

/**
 * Botのトークンが使えるかを確かめる（見回りが毎時）。使えなくなったら控え、また使えるようになったら運営者に知らせる。
 * Discordが混んでいる・応えないときは、確かめられなかったことにして控えを変えない
 */
export async function checkBot(env: Env, now: Date): Promise<void> {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) return;
  let status: number;
  try {
    status = (await botGet(token, '/users/@me')).status;
  } catch {
    return;
  }
  if (status !== 200 && status !== 401) return;
  const prev = parse<BotCheck>(await getMeta(env.DB, NOTICE_KEYS.bot));
  const ok = status === 200;
  const rec: BotCheck = { ok, at: now.toISOString(), since: ok ? '' : prev && !prev.ok ? prev.since : now.toISOString() };
  await putMeta(env.DB, NOTICE_KEYS.bot, JSON.stringify(rec));
  if (ok && prev && !prev.ok) {
    await notifyOperators(env, 'Botのトークン', '✅ YokiのBotのトークンが、また使えるようになりました。\n' + jstText(prev.since) + 'ごろから使えなかったので、そのあいだのDiscordへの知らせは届いていません（各グループの「送信の記録」に残っています）。', now);
  }
}

/** 新しいバージョンを見て、まだ知らせていない版なら運営者に知らせる（見回りが毎日1回）。止めていればGitHubも読まない */
export async function noticeVersion(env: Env, github: UpdateDeps, now: Date, origin: string): Promise<void> {
  if ((await getMeta(env.DB, NOTICE_KEYS.on)) === '0' || !parseOperatorIds(env.OPERATOR_IDS).length) return;
  const c = await checkRelease(env.DB, github, now, false);
  if (!c.latest || !newer(c.latest.version, APP_VERSION) || (await getMeta(env.DB, NOTICE_KEYS.version)) === c.latest.version) return;
  const text = '📦 Yokiの新しいバージョンv' + c.latest.version + 'が出ました（いまはv' + APP_VERSION + '）。' + (c.migrations ? '表の変更があります。' : '')
    + '\n変わったこと: ' + c.latest.url + (origin ? '\n運営の管理画面の「更新」から更新できます: ' + origin + '/admin/update/' : '');
  const r = await send(env, '新しいバージョン', text, parseOperatorIds(env.OPERATOR_IDS), now);
  // だれにも届かなければ、次の日にもう一度送る
  if (r.sent) await putMeta(env.DB, NOTICE_KEYS.version, c.latest.version);
}
