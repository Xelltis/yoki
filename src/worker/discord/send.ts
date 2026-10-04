// Discord へ送る（GAS 版 discordAttempt_・postDiscord_・classifyDiscordFailure_）。卓予定の Bot で、チャンネルにメッセージを書く。
// 429 と 5xx・通信の切れは、少し待って最大 3 回まで送り直す。1 回ごとに送信記録（notify_log）に 1 行残す
import { DISCORD_API } from '../auth/oauth';
import { isChannelId } from './channel';
import type { Payload } from './payloads';
import { targetNote, type Target } from './targets';

export const RETRY_WAITS_MS = [3000, 8000];
/** サンプルのグループのチャンネル（実在しない）。ここへは送らずに、送ったことにする（開発用ログインとスクリーンショット用） */
export const SAMPLE_CHANNEL = '000000000000000000';
export const MAX_TRIES = RETRY_WAITS_MS.length + 1;
const MAX_WAIT_MS = 15000;
/** 通信が切れたときのエラーの文。種類分け（通信）と、送り直してよいかの両方で使う */
const NETWORK_ERROR = /DNS|address|resolve|timed out|timeout|network/i;
/** Bot のトークンが無いとき（運営者の設定。送らずに記録する） */
const NO_BOT = 'Discord の Bot が設定されていません';
/** 送り先がチャンネルの ID の形でないとき（送らずに記録する） */
const BAD_CHANNEL = 'チャンネルの ID が正しくありません';

export type Reason = { kind: string; label: string; toolFault: boolean; text: string; advice: string };

export type Attempt = {
  ok: boolean;
  code: number;
  retryable: boolean;
  waitMs: number;
  result: string;
  raw: string;
  reason: Reason | null;
  attempt: number;
  maxTries: number;
};

/** 送った記録を残す相手（グループ）と、送るのに使う Bot のトークン */
export type LogTo = { db: D1Database; groupId: string; token: string; now?: () => Date };

/** 送信記録に 1 行書く（送らなかったときや、送ったこと以外の記録にも使う） */
export async function appendLog(log: Omit<LogTo, 'token'>, kind: string, target: string, result: string): Promise<void> {
  await log.db
    .prepare('INSERT INTO notify_log (group_id, at, kind, target, result) VALUES (?, ?, ?, ?, ?)')
    .bind(log.groupId, (log.now?.() ?? new Date()).toISOString(), kind, target, result)
    .run();
}

/** 失敗の種類分け。画面と送信記録の両方がこれを使う */
export function classifyFailure(code: number, errText: string): Reason {
  if (code === 429) {
    return { kind: 'rate_limit', label: 'Discord 側の制限', toolFault: false,
      text: 'Discord が、送る回数が多いことを理由に受け取りを断りました（Discord の手前の Cloudflare が断ることもあります）。', advice: '数分おいて、もう一度送ってください。' };
  }
  if (code >= 500) return { kind: 'discord_down', label: 'Discord 側の不調', toolFault: false, text: 'Discord が一時的に応答できていません。', advice: '時間をおいて送り直してください。' };
  if (code === 401 || (!code && errText === NO_BOT)) {
    return { kind: 'bad_bot', label: 'Bot の設定', toolFault: false,
      text: code ? '卓予定の Bot のトークンが正しくありません。' : '卓予定の Bot が設定されていません。', advice: '卓予定を公開している運営者に知らせてください。' };
  }
  if (code === 403) {
    return { kind: 'no_permission', label: 'チャンネルの権限', toolFault: false, text: 'Bot がそのチャンネルを見られないか、書き込めません。',
      advice: '管理画面の「知らせ」から Bot をサーバーに招き、チャンネルの権限で「チャンネルを見る」「メッセージを送信」「埋め込みリンク」を許可してください。' };
  }
  if (code === 404 || (!code && errText === BAD_CHANNEL)) {
    return { kind: 'no_channel', label: 'チャンネル', toolFault: false,
      text: code ? 'チャンネルが見つかりません（消されたか、Bot がサーバーから外されています）。' : 'チャンネルの ID が正しくありません。', advice: '管理画面の「知らせ」でチャンネルを選び直して「接続テスト」を。' };
  }
  if (code === 400) {
    return { kind: 'bad_payload', label: '本文', toolFault: true, text: 'Discord が本文を受け付けませんでした。',
      advice: '卓名やメモが極端に長くないか確かめてください。直らなければツール側の問題かもしれないので、送信記録の詳細を添えて知らせてください。' };
  }
  if (NETWORK_ERROR.test(errText)) return { kind: 'network', label: '通信', toolFault: false, text: 'Discord に届く前に通信が切れました。', advice: '時間をおいて送り直してください。' };
  return { kind: 'unknown', label: '原因不明', toolFault: true, text: '原因を判別できませんでした。', advice: '送信記録の詳細を添えて知らせてください。' };
}

/** Retry-After ヘッダーか Discord の retry_after（秒）から、待つミリ秒を取る。無ければ 0 */
function retryAfterMs(res: Response, body: string): number {
  const h = res.headers.get('Retry-After');
  if (h && !Number.isNaN(Number(h))) return Number(h) * 1000;
  try {
    const j = JSON.parse(body) as { retry_after?: unknown };
    if (typeof j.retry_after === 'number') return j.retry_after * (j.retry_after > 100 ? 1 : 1000);
  } catch {
    // JSON でない本文
  }
  return 0;
}

/**
 * 1 回だけ送り、結果を送信記録に 1 行残す。本文の @everyone や @here、ロールでは呼ばない（メンションするのは人だけ）
 */
export async function discordAttempt(log: LogTo, payload: Payload, kind: string, target: string, attemptIn: number, channelId: string): Promise<Attempt> {
  const attempt = Math.min(Math.max(Math.trunc(attemptIn) || 1, 1), MAX_TRIES);
  if (!channelId) return { ok: false, code: 0, retryable: false, waitMs: 0, result: '送らず: 送り先のチャンネルが未設定', raw: '', reason: null, attempt, maxTries: MAX_TRIES };
  let code = 0, body = '', retryAfter = 0, errText = '';
  if (channelId === SAMPLE_CHANNEL) {
    code = 200;
  } else if (!log.token) {
    errText = NO_BOT;
  } else if (!isChannelId(channelId)) {
    errText = BAD_CHANNEL;
  } else {
    try {
      const res = await fetch(DISCORD_API + '/channels/' + channelId + '/messages', {
        method: 'POST',
        headers: { Authorization: 'Bot ' + log.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, allowed_mentions: { parse: ['users'] } }),
      });
      code = res.status;
      body = await res.text();
      retryAfter = retryAfterMs(res, body);
    } catch (err) {
      errText = String(err);
    }
  }
  const ok = code >= 200 && code < 300;
  const canRetry = !ok && (code === 429 || code >= 500 || (!code && NETWORK_ERROR.test(errText)));
  const last = attempt >= MAX_TRIES || !canRetry;
  // 送り直すのは 1・2 回目だけなので、RETRY_WAITS_MS にいつも値がある
  const waitMs = canRetry && !last ? Math.min(Math.max(RETRY_WAITS_MS[attempt - 1]!, retryAfter), MAX_WAIT_MS) : 0;
  const raw = code ? 'HTTP ' + code + ' ' + body.slice(0, 200) : 'ERROR ' + errText;
  const reason = ok ? null : classifyFailure(code, errText);
  let result: string;
  if (ok) result = 'OK (' + code + ')' + (attempt > 1 ? '（' + attempt + ' 回目）' : '');
  else if (!last) result = raw + '（' + attempt + ' 回目、' + Math.ceil(waitMs / 1000) + ' 秒後に送り直し）';
  else {
    result = '送信失敗（' + reason!.label + '）: ' + raw + '（' + attempt + ' 回目' + (attempt > 1 ? '、打ち止め' : '') + '）　→ ' + reason!.text + ' ' + reason!.advice +
      (reason!.toolFault ? '' : '　このツールの不具合ではありません。');
  }
  await appendLog(log, kind, target, result);
  return { ok, code, retryable: canRetry && !last, waitMs, result, raw, reason, attempt, maxTries: MAX_TRIES };
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 送り直しも含めて送る（サーバーから送るとき。画面からは 1 回ずつ sendDiscordStep を呼ぶ） */
export async function postDiscord(log: LogTo, payload: Payload, kind: string, target: string, channelId: string, sleep: Sleep = realSleep): Promise<boolean> {
  // 送り直してよいのは MAX_TRIES 回目の手前まで（discordAttempt が retryable で決める）。届いたときも retryable は false
  let attempt = 1;
  let r = await discordAttempt(log, payload, kind, target, attempt, channelId);
  while (r.retryable) {
    await sleep(r.waitMs);
    r = await discordAttempt(log, payload, kind, target, ++attempt, channelId);
  }
  return r.ok;
}

/** いくつかの送り先へ同じ文を送る。すべて届けば true（GAS 版 postToTargets_） */
export async function postToTargets(log: LogTo, payload: Payload, kind: string, target: string, targets: Target[], sleep: Sleep = realSleep): Promise<boolean> {
  let all = targets.length > 0;
  for (const t of targets) if (!(await postDiscord(log, payload, kind, target + targetNote(t), t.channelId, sleep))) all = false;
  return all;
}
