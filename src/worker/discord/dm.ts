// BotからのDM（運営者への知らせ・自分あてのDMの知らせ）。DMのチャンネルを開き（POST /users/@me/channels）、そこへ書く。
// 同じ人とのDMのチャンネルはいつも同じなので、自分あての知らせでは控えて使い回す（domain/dm-notices.ts）。
// Botが書けるのは、Botと同じサーバーにいて、サーバーのメンバーからのDMを許している人だけ（Discordの決まり）
import { DISCORD_API } from '../auth/oauth';
import { discordFetch } from './calls';

/** DMの結果。statusはDiscordの返事（通信が切れたら0）、errorは届かなかった理由（届けば空） */
export type DmResult = { ok: boolean; status: number; error: string };

/** Discordの断りを、直せる文にする */
function dmError(status: number, code: number): string {
  if (status === 401) return 'Botのトークンが使えません（HTTP 401）';
  if (code === 50007) return 'DMを受け取れない設定です。Botと同じサーバーにいて、サーバーのメンバーからのDMを許しているかを確かめてください';
  return 'HTTP ' + status + (code ? '・' + code : '');
}

const codeOf = async (res: Response) => Number(((await res.json().catch(() => null)) as { code?: unknown } | null)?.code) || 0;
const cut = (e: unknown): DmResult => ({ ok: false, status: 0, error: '通信が切れました（' + (e instanceof Error ? e.message : String(e)) + '）' });
const headersOf = (token: string) => ({ Authorization: 'Bot ' + token, 'Content-Type': 'application/json' });

/** BotとのDMのチャンネルを開く。channelは開けたときだけ。通信が切れても投げない */
export async function openDm(token: string, userId: string): Promise<DmResult & { channel: string }> {
  try {
    const ch = await discordFetch(DISCORD_API + '/users/@me/channels', { method: 'POST', headers: headersOf(token), body: JSON.stringify({ recipient_id: userId }) });
    if (!ch.ok) return { ok: false, status: ch.status, error: dmError(ch.status, await codeOf(ch)), channel: '' };
    const id = String(((await ch.json().catch(() => null)) as { id?: unknown } | null)?.id ?? '');
    if (!id) return { ok: false, status: ch.status, error: dmError(ch.status, 0), channel: '' };
    return { ok: true, status: ch.status, error: '', channel: id };
  } catch (e) {
    return { ...cut(e), channel: '' };
  }
}

/** 開いたDMのチャンネルに書く。メンションは効かせない。通信が切れても投げない */
export async function postDm(token: string, channel: string, content: string): Promise<DmResult> {
  try {
    const res = await discordFetch(DISCORD_API + '/channels/' + channel + '/messages', { method: 'POST', headers: headersOf(token), body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
    if (!res.ok) return { ok: false, status: res.status, error: dmError(res.status, await codeOf(res)) };
    return { ok: true, status: res.status, error: '' };
  } catch (e) {
    return cut(e);
  }
}

/** 1人にDMを送る（チャンネルを開いてから書く） */
export async function sendDm(token: string, userId: string, content: string): Promise<DmResult> {
  const o = await openDm(token, userId);
  return o.ok ? postDm(token, o.channel, content) : { ok: o.ok, status: o.status, error: o.error };
}
