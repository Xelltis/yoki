// Discordへの送信。送り先が何か所かあれば（シリーズのチャンネルと基本のチャンネル）、1か所ずつ順に送る。
// 1か所ごとにサーバーへ1回ずつ頼み（sendDiscordStep）、429や5xxなら秒を数えながら送り直す
import type { DiscordReason, DiscordStepResult } from '../../../../shared/api';
import type { ConsoleSync } from './sync';

/** 届かなかった送り先 */
type Failed = { label: string; reason: DiscordReason | null; text: string };
/** 送信の結果。最後の送り先の返事に、届いた先・届かなかった先を足したもの */
export type SendResult = Partial<DiscordStepResult> & { sent: string[]; failed: Failed[]; partial: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 届いた返事に付いてくるもの。最後の送り先で失敗しても渡す */
const KEEP = ['data', 'asked', 'notified'] as const;

/**
 * 送る。status(文) に進み具合が届く。okは、すべての送り先に届いたときtrue。
 * 返事にデータが付いていれば、画面のデータに当てる（sync.write）
 */
export async function discordSend(sync: ConsoleSync, form: Record<string, unknown>, status: (t: string) => void): Promise<{ ok: boolean; r: SendResult }> {
  let attempt = 1, maxTries = 3, to = 0, count = 1;
  const labels: string[] = [], sent: string[] = [], failed: Failed[] = [], got: Partial<DiscordStepResult> = {};
  const where = () => (count > 1 ? '［' + (to + 1) + '/' + count + (labels[to] ? ' ' + labels[to] : '') + '］' : '');
  const finish = (r: Partial<DiscordStepResult>) => {
    const out: SendResult = { ...r, sent, failed, partial: sent.length > 0 && failed.length > 0 };
    KEEP.forEach((k) => { if (got[k] !== undefined && out[k] === undefined) Object.assign(out, { [k]: got[k] }); });
    if (count > 1) {
      if (!failed.length) status('Discordの' + count + 'か所に送りました（' + sent.join('、') + '）。');
      else status((sent.length ? sent.join('、') + 'には届きました。' : '') + failed.map((f) => f.label + 'には届きませんでした（' + (f.reason ? f.reason.label : f.text) + '）').join('。') + '。');
    }
    return { ok: !failed.length, r: out };
  };
  for (;;) {
    status(where() + 'Discordに送信中…（' + attempt + '回目／最大' + maxTries + '回）');
    let r: DiscordStepResult;
    try {
      r = await sync.write<DiscordStepResult>('sendDiscordStep', { ...form, attempt, to }, { quiet: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status(where() + 'Discordに送れませんでした: ' + msg);
      failed.push({ label: labels[to] || 'Discord', reason: null, text: msg });
      return finish({ result: msg });
    }
    if (r.maxTries) maxTries = r.maxTries;
    if (r.targetCount) count = r.targetCount;
    if (r.targetLabel) labels[to] = r.targetLabel;
    const name = labels[to] || 'Discord';
    if (r.ok || !r.retryable) {
      if (r.ok) {
        sent.push(name);
        KEEP.forEach((k) => { if (r[k] !== undefined) Object.assign(got, { [k]: r[k] }); });
        status(where() + 'Discordに送りました' + (attempt > 1 ? '（' + attempt + '回目で成功）' : '') + '。');
      } else {
        const rs = r.reason || { kind: '', label: '原因不明', text: '', advice: '', toolFault: true };
        status(where() + '送信失敗（' + rs.label + '）: ' + rs.text + ' ' + rs.advice + (rs.toolFault ? '' : '　このツールの不具合ではありません。') +
          '　［詳細: ' + (r.raw || r.result) + '、' + attempt + '回試行］');
        failed.push({ label: name, reason: rs, text: r.raw || r.result });
      }
      if (to + 1 < count) { to++; attempt = 1; continue; }
      return finish(r);
    }
    // 送り直せる失敗（429・5xx・通信）。秒を数えてから、次の回を送る
    const rs = r.reason || { kind: '', label: '原因不明', text: '', advice: '', toolFault: true };
    const why = rs.label + 'のため、受け取りを断られました' + (rs.toolFault ? '' : '（ツールの不具合ではありません）');
    let left = Math.max(1, Math.ceil((r.waitMs || 3000) / 1000));
    attempt++;
    status(where() + why + '。' + left + '秒後に' + attempt + '回目を送ります…');
    while (left > 0) {
      await sleep(1000);
      left--;
      if (left > 0) status(where() + why + '。' + left + '秒後に' + attempt + '回目を送ります…');
    }
  }
}

/** 失敗の吹き出し。種類を先に出し、ツールの不具合でなければそう書く。一部だけ届いたときは、届いた先も添える */
export function failToast(r: SendResult): string {
  const f = r && r.failed && r.failed[0], part = !!(r && r.partial);
  const rs = f ? f.reason : r && r.reason;
  if (!rs) return (part && f ? f.label + 'に届きませんでした: ' : '送信失敗: ') + ((f && f.text) || (r && (r.raw || r.result)) || '不明');
  return (part && f ? f.label + 'に届きませんでした（' : '送信失敗（') + rs.label + '）' + (rs.toolFault ? '' : '。ツールの不具合ではありません') +
    (part ? '。' + r.sent.join('、') + 'には届きました' : '。管理画面の「送信の記録」に詳細があります');
}
