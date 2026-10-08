// Discordのボタン（Interactions）。知らせに付けたボタンや選ぶ欄を押すと、DiscordがWorkerへPOSTする（/api/discord/interactions。routes/discord.ts）。
// 署名（Ed25519）を確かめ、押した人（DiscordのユーザーID）をグループのメンバーに結びつけて、本人の回答や参加希望を書く。
// 押した人がそのDiscordサーバーにいることは、Discordが確かめている（押せるのはサーバーにいる人だけ）。
// 受け口のURLとPublic Keyは、運営者が運営の管理画面で入れたときに、Botのトークンで読み書きする（新しいsecretは要らない）
import type { Bindings } from '../env';
import { DISCORD_API } from '../auth/oauth';
import { loadGroup, sessionCode } from '../domain/load';
import { setPollVoteAll, setPollVoteDays, setPollVoteFromAvail } from '../domain/polls';
import { setInterest } from '../domain/sessions';
import type { Actor } from '../auth/guard';
import { AppError, badRequest } from '../lib/errors';
import { BUTTONS_KEY, parseCustomId } from './buttons';
import { discordFetch } from './calls';
import type { Sleep } from './send';

/** metaの鍵。DiscordアプリのPublic Key（16進）。ボタンを使うかは buttons.ts のBUTTONS_KEY */
export const VERIFY_KEY = 'discord_verify_key';
/** 受け口の道 */
export const INTERACTIONS_PATH = '/api/discord/interactions';

const hexBytes = (hex: string): Uint8Array | null => (/^(?:[0-9a-f]{2})+$/i.test(hex) ? new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16))) : null);

/** Discordの署名を確かめる（Ed25519。署名するのは、タイムスタンプと本文をつないだもの） */
export async function verifySignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: string): Promise<boolean> {
  const key = hexBytes(publicKeyHex), sig = hexBytes(signatureHex);
  if (!key || key.length !== 32 || !sig || sig.length !== 64 || !timestamp) return false;
  const pub = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', pub, sig, new TextEncoder().encode(timestamp + body));
}

const putMeta = (db: D1Database, key: string, value: string) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value).run();

/** ボタンを使うか（運営者が入れたか）と、Public Key */
export async function buttonsState(db: D1Database): Promise<{ on: boolean; verifyKey: string }> {
  const rows = (await db.prepare('SELECT key, value FROM meta WHERE key IN (?1, ?2)').bind(BUTTONS_KEY, VERIFY_KEY).all<{ key: string; value: string }>()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { on: m[BUTTONS_KEY] === '1', verifyKey: m[VERIFY_KEY] ?? '' };
}

/**
 * 知らせのボタンを使う・やめる（運営者）。使うときは、DiscordアプリのPublic Keyを読んで控え、受け口のURLをDiscordアプリに入れる。
 * URLを入れるとき、Discordは受け口に確かめの要求（PING）を送るので、Public Keyを先に控える
 */
export async function setButtons(env: Bindings, on: boolean, origin: string): Promise<string> {
  const db = env.DB;
  if (!on) {
    await putMeta(db, BUTTONS_KEY, '0');
    return '知らせにボタンを付けるのをやめました。';
  }
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) throw badRequest('YokiのBotのトークンが無いので、ボタンを使えません。');
  const headers = { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
  const app = await discordFetch(DISCORD_API + '/applications/@me', { headers });
  const verifyKey = String(((await app.json().catch(() => null)) as { verify_key?: string } | null)?.verify_key ?? '');
  if (!app.ok || !hexBytes(verifyKey)) throw badRequest('DiscordアプリのPublic Keyを読めませんでした（HTTP ' + app.status + '）。Botのトークンを確かめてください。');
  await putMeta(db, VERIFY_KEY, verifyKey);
  const url = origin + INTERACTIONS_PATH;
  const res = await discordFetch(DISCORD_API + '/applications/@me', { method: 'PATCH', headers, body: JSON.stringify({ interactions_endpoint_url: url }) });
  if (!res.ok) {
    throw badRequest('Discordが受け口のURL（' + url + '）を受け付けませんでした（HTTP ' + res.status + '）。公開のアドレスで開いた運営の管理画面から入れてください。');
  }
  await putMeta(db, BUTTONS_KEY, '1');
  return '知らせにボタンを付けます。日程調整と募集の知らせから、Discordで答えられます。';
}

/** Discordから届く、押されたボタンの中身（使うところだけ） */
export type ComponentInteraction = {
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { custom_id?: string; values?: string[] };
};

/**
 * 押されたボタンを処理し、本人にだけ見せる文を返す。グループ・メンバー・卓が見つからなければ、そう返す。
 * 押した人のDiscordのユーザーIDで、ログインしたことのあるメンバー（user_id）を先に、無ければDiscordのIDを入れたメンバーを探す
 */
export async function handleComponent(env: Bindings, it: ComponentInteraction, appBase: string, now: Date, sleep: Sleep): Promise<string> {
  const id = parseCustomId(it.data?.custom_id);
  if (!id) return 'このボタンは使えません。Yokiの画面から操作してください。';
  const db = env.DB;
  const userId = it.member?.user?.id ?? it.user?.id ?? '';
  const group = await db.prepare('SELECT id, guild_id FROM groups WHERE id = ?').bind(id.groupId).first<{ id: string; guild_id: string }>();
  if (!group || !it.guild_id || group.guild_id !== it.guild_id) return 'このボタンのグループが見つかりません。';
  const appUrl = appBase + '/g/' + group.id + '/';
  if (await db.prepare('SELECT 1 FROM users WHERE id = ? AND banned_at IS NOT NULL').bind(userId).first()) return 'このアカウントでは使えません。';
  const m = await db
    .prepare('SELECT id, name, is_admin, user_id FROM members WHERE group_id = ?1 AND (user_id = ?2 OR discord_id = ?2) ORDER BY user_id IS NULL LIMIT 1')
    .bind(group.id, userId)
    .first<{ id: number; name: string; is_admin: number; user_id: string | null }>();
  if (!m) return 'まだこのグループのメンバーではありません。一度Yokiでグループを開いてから、もう一度押してください: ' + appUrl;
  const actor: Actor = { memberId: m.id, name: m.name, isAdmin: m.is_admin === 1, userId: m.user_id ?? '' };
  const bot = { token: env.DISCORD_BOT_TOKEN ?? '', clientId: env.DISCORD_CLIENT_ID };
  const load = () => loadGroup(db, group.id, actor, appUrl, now, bot);
  const ctx = await load();
  const io = { reload: load, data: noData, sleep };
  const form = { id: sessionCode(id.seq), name: m.name };
  try {
    const r = id.action === 'fill' ? await setPollVoteFromAvail(ctx, form, io)
      : id.action === 'any' ? await setPollVoteAll(ctx, form, io)
        : id.action === 'days' ? await setPollVoteDays(ctx, { ...form, days: it.data?.values ?? [] }, io)
          : await setInterest(ctx, { ...form, level: id.action });
    return r.message;
  } catch (e) {
    if (e instanceof AppError) return e.message;
    throw e;
  }
}

// 書き込みに渡すioのdataは、型を満たすためだけ（日程調整の書き込みは、読み直した中身を返事に使い、参加希望はdataを使わない）
/* istanbul ignore next -- @preserve ボタンの処理では呼ばれない */
async function noData(): Promise<unknown> { return {}; }

/** 「考え中」で返したあとに、本人にだけ見える返事を書き直す（Discordの決まりで、返事は3秒以内に返し、続きはこちらで書く） */
export async function editReply(it: ComponentInteraction, content: string): Promise<void> {
  await discordFetch(DISCORD_API + '/webhooks/' + it.application_id + '/' + it.token + '/messages/@original', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}
