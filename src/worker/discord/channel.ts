// DiscordのチャンネルとBot（YokiのDiscordアプリ）。送り先はチャンネルのIDで持ち、Botのトークンで読む・送る。
// Gatewayには繋がず、RESTだけを使う。トークンはWorkerのsecret（DISCORD_BOT_TOKEN）
import { DISCORD_API } from '../auth/oauth';
import { discordFetch } from './calls';

/** チャンネルのID（17〜20桁の数字） */
export function isChannelId(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

/** Botを招くときに求める権限: チャンネルを見る（1024）・メッセージを送る（2048）・埋め込みリンク（16384） */
export const BOT_PERMISSIONS = 1024 + 2048 + 16384;

/** 「イベントを作成」（1<<44）。イベントを作り、自分が作ったイベントを書き換え・消せる。卓をDiscordのイベントに出すグループだけが求める */
export const CREATE_EVENTS = 2 ** 44;

/** グループのサーバーにBotを招くURL。eventsなら「イベントを作成」の権限も求める。DiscordアプリのClient IDが無ければ空 */
export function botInviteUrl(clientId: string | undefined, guildId: string, events = false): string {
  if (!clientId) return '';
  const permissions = String(BOT_PERMISSIONS + (events ? CREATE_EVENTS : 0));
  const q = new URLSearchParams({ client_id: clientId, scope: 'bot', permissions, guild_id: guildId, disable_guild_select: 'true' });
  return 'https://discord.com/oauth2/authorize?' + q.toString();
}

/** Botの権限でDiscordのAPIを読む。statusと、JSONの本文（読めなければnull）を返す */
export async function botGet(token: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await discordFetch(DISCORD_API + path, { headers: { Authorization: 'Bot ' + token } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export type Channel = { id: string; name: string; category: string };
type ApiChannel = { id: string; name: string; type: number; position: number; parent_id: string | null; guild_id?: string };
/** 送り先にできるチャンネルの種類: テキスト（0）とアナウンス（5） */
const SENDABLE = [0, 5];

/**
 * サーバーの、送り先にできるチャンネルの一覧（カテゴリーごと、Discordの並び順）。
 * Botがサーバーにいない・見られないときはnull。そのほかの失敗は投げる
 */
export async function listChannels(token: string, guildId: string): Promise<Channel[] | null> {
  const r = await botGet(token, '/guilds/' + guildId + '/channels');
  if (r.status === 403 || r.status === 404) return null;
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error('Discordのチャンネルの一覧を読めませんでした（HTTP ' + r.status + '）');
  const all = r.body as ApiChannel[];
  const cat = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const key = (c: ApiChannel) => {
    const p = c.parent_id ? cat.get(c.parent_id) : undefined;
    return [p ? p.position : -1, c.parent_id ?? '', c.position] as const;
  };
  return all
    .filter((c) => SENDABLE.includes(c.type))
    .sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2] - kb[2];
    })
    .map((c) => ({ id: c.id, name: c.name, category: c.parent_id ? cat.get(c.parent_id)?.name ?? '' : '' }));
}

/** 1つのチャンネル（送り先にできる種類だけ）。Botが見られない・無いときはnull */
export async function getChannel(token: string, channelId: string): Promise<{ id: string; name: string; guildId: string } | null> {
  const r = await botGet(token, '/channels/' + channelId);
  const c = r.body as ApiChannel | null;
  if (r.status !== 200 || !c || !SENDABLE.includes(c.type)) return null;
  return { id: c.id, name: c.name, guildId: c.guild_id ?? '' };
}
