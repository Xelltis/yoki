// BotからのDM（運営者への知らせ）。DMのチャンネルを開き（POST /users/@me/channels）、そこへ書く。
// Botが書けるのは、Botと同じサーバーにいて、サーバーのメンバーからのDMを許している人だけ（Discordの決まり）
import { DISCORD_API } from '../auth/oauth';
import { discordFetch } from './calls';

/** DMの結果。errorは届かなかった理由（届けば空） */
export type DmResult = { ok: boolean; error: string };

/** Discordの断りを、運営者が直せる文にする */
function dmError(status: number, code: number): string {
  if (status === 401) return 'Botのトークンが使えません（HTTP 401）';
  if (code === 50007) return 'DMを受け取れない設定です。Botと同じサーバーにいて、サーバーのメンバーからのDMを許しているかを確かめてください';
  return 'HTTP ' + status + (code ? '・' + code : '');
}

const codeOf = async (res: Response) => Number(((await res.json().catch(() => null)) as { code?: unknown } | null)?.code) || 0;

/** 1人にDMを送る。メンションは効かせない。通信が切れても投げずに、理由を返す */
export async function sendDm(token: string, userId: string, content: string): Promise<DmResult> {
  const headers = { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
  try {
    const ch = await discordFetch(DISCORD_API + '/users/@me/channels', { method: 'POST', headers, body: JSON.stringify({ recipient_id: userId }) });
    if (!ch.ok) return { ok: false, error: dmError(ch.status, await codeOf(ch)) };
    const id = String(((await ch.json().catch(() => null)) as { id?: unknown } | null)?.id ?? '');
    if (!id) return { ok: false, error: dmError(ch.status, 0) };
    const res = await discordFetch(DISCORD_API + '/channels/' + id + '/messages', { method: 'POST', headers, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
    if (!res.ok) return { ok: false, error: dmError(res.status, await codeOf(res)) };
    return { ok: true, error: '' };
  } catch (e) {
    return { ok: false, error: '通信が切れました（' + (e instanceof Error ? e.message : String(e)) + '）' };
  }
}
