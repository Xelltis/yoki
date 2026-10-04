// 送り先の選び方・Webhook URL の形と伏せ方・開催前の知らせの日時。データを読まずに、作った値を渡して確かめる
import { describe, expect, test } from 'vitest';
import { discordTargets, targetNote, unionTargets } from '../../src/worker/discord/targets';
import { isDiscordWebhook, maskUrl } from '../../src/worker/discord/webhook';
import { aheadText, notifyDaysOf, notifyHourOf, notifyWhenText, notifyYmdOf } from '../../src/worker/domain/notify';
import type { GroupRow, Session } from '../../src/worker/domain/types';

const HOOK = (n: number) => 'https://discord.com/api/webhooks/12345678901234567' + n + '/token' + n;

// 基本のチャンネルと募集のチャンネルがある。開催前の知らせは基本の値で前日の 20 時台
const ctx = {
  group: { webhook_url: HOOK(1), remind_webhook_url: '', recruit_webhook_url: HOOK(2), notify_days: 1, notify_hour: 20 } as GroupRow,
  seriesNotify: {
    港: { webhook: HOOK(3), alsoBase: true, days: 3, hour: null },
    古城: { webhook: HOOK(1), alsoBase: true, days: null, hour: 9 },
  },
};

describe('送り先', () => {
  test('シリーズの専用チャンネルと、基本にも送るなら種類のチャンネル。同じ URL なら 1 つだけ', () => {
    const port = discordTargets(ctx, '港', 'recruit');
    expect(port.map((t) => [t.url, t.label])).toEqual([[HOOK(3), 'シリーズ「港」のチャンネル'], [HOOK(2), '募集のチャンネル']]);
    expect(discordTargets(ctx, '古城', '').map((t) => t.url)).toEqual([HOOK(1)]);
    // 開催前の知らせのチャンネルが無ければ基本へ
    expect(discordTargets(ctx, '', 'remind')).toEqual([{ url: HOOK(1), label: '基本のチャンネル', series: '' }]);
    expect(unionTargets([port, discordTargets(ctx, '', 'recruit'), discordTargets(ctx, '', '')]).map((t) => t.url)).toEqual([HOOK(3), HOOK(2), HOOK(1)]);
  });

  test('送信記録の対象には、シリーズと種類のチャンネルだけ添える', () => {
    const [series, recruit] = discordTargets(ctx, '港', 'recruit');
    expect(targetNote(series)).toBe('（シリーズ「港」のチャンネル）');
    expect(targetNote(recruit)).toBe('（募集のチャンネル）');
    expect(targetNote(discordTargets(ctx, '', '')[0])).toBe('');
    expect(targetNote(undefined)).toBe('');
  });
});

describe('Webhook URL', () => {
  test('Discord の Webhook の形だけを受け付ける', () => {
    for (const ok of [HOOK(1), 'https://ptb.discord.com/api/v10/webhooks/123456789012345678/a-b_c', 'https://canary.discordapp.com/api/webhooks/123456789012345678/x']) {
      expect(isDiscordWebhook(ok), ok).toBe(true);
    }
    for (const ng of ['http://discord.com/api/webhooks/123456789012345678/x', 'https://example.com/api/webhooks/123456789012345678/x', 'https://discord.com/api/webhooks/1234/x']) {
      expect(isDiscordWebhook(ng), ng).toBe(false);
    }
  });

  test('画面には伏せた形で渡す。短い URL は末尾も見せない', () => {
    expect(maskUrl(HOOK(1))).toBe(HOOK(1).slice(0, 40) + '…' + 'ken1');
    const short = 'https://discord.com/api/webhooks/1234/secret-tok';   // 48 文字
    expect(maskUrl(short)).toBe('https://discord.com/api/webhoo…');
    expect(maskUrl('')).toBe('');
  });
});

describe('開催前の知らせの日時', () => {
  const s = (o: Partial<Session>) => ({ series: '', date: null, ...o }) as Session;

  test('シリーズに値があればそれ、無ければ基本の値。開催日の無い卓には送る日が無い', () => {
    expect([notifyDaysOf(ctx, s({ series: '港' })), notifyHourOf(ctx, s({ series: '港' }))]).toEqual([3, 20]);
    expect([notifyDaysOf(ctx, s({ series: '古城' })), notifyHourOf(ctx, s({ series: '古城' }))]).toEqual([1, 9]);
    expect([notifyDaysOf(ctx, s({ series: '迷宮' })), notifyHourOf(ctx, s({}))]).toEqual([1, 20]);
    expect(notifyYmdOf(ctx, s({ series: '港', date: '2026-10-17' }))).toBe('2026-10-14');
    expect(notifyYmdOf(ctx, s({ series: '港' }))).toBe('');
  });

  test('日時の言い方と、開催日まで何日あるかの言い方', () => {
    expect([notifyWhenText(0, 12), notifyWhenText(1, 20), notifyWhenText(3, 9)]).toEqual(['当日の 12 時台', '前日の 20 時台', '3 日前の 9 時台']);
    expect([-1, 0, 1, 2, 5].map(aheadText)).toEqual(['今日', '今日', '明日', 'あさって', '5 日後']);
  });
});
