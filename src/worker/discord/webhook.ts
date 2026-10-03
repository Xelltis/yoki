// Discord の Webhook URL。Discord の形の URL だけを受け付け、それ以外には送らない。画面には伏せた形だけ渡す
const WEBHOOK = /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d{17,20}\/[\w-]+$/;

export function isDiscordWebhook(url: string): boolean {
  return WEBHOOK.test(url);
}

/** 先頭 40 文字と末尾 4 文字だけ見せる（GAS 版 maskUrl_） */
export function maskUrl(url: string): string {
  if (!url) return '';
  if (url.length <= 48) return url.slice(0, 30) + '…';
  return url.slice(0, 40) + '…' + url.slice(-4);
}

export const WEBHOOK_FORMAT_ERROR = 'Discord の Webhook URL の形ではありません。https://discord.com/api/webhooks/… で始まる URL を貼ってください。';
