// 送り先の選び方・開催前の知らせの日時。データを読まずに、作った値を渡して確かめる
import { describe, expect, test } from 'vitest';
import { discordTargets, kindBase, sessionKind, sessionTargets, targetNote, unionTargets } from '../../src/worker/discord/targets';
import { aheadText, notifyDaysOf, notifyHourOf, notifyWhenText, notifyYmdOf } from '../../src/worker/domain/notify';
import type { GroupRow, Session } from '../../src/worker/domain/types';

const CH = (n: number) => '12345678901234567' + n;
const group = (o: Partial<GroupRow>) => ({ channel_id: '', remind_channel_id: '', recruit_channel_id: '', notify_days: 1, notify_hour: 20, ...o }) as GroupRow;

// 基本のチャンネルと募集のチャンネルがある。開催前の知らせは基本の値で前日の20時台
const ctx = {
  group: group({ channel_id: CH(1), recruit_channel_id: CH(2) }),
  seriesNotify: {
    港: { channelId: CH(3), alsoBase: true, days: 3, hour: null },
    古城: { channelId: CH(1), alsoBase: true, days: null, hour: 9 },
    砂漠: { channelId: CH(4), alsoBase: false, days: null, hour: null },
    // 日時だけ変えたシリーズ（専用のチャンネルは無い）
    孤島: { channelId: '', alsoBase: false, days: 2, hour: null },
  },
};
const s = (o: Partial<Session>) => ({ series: '', date: null, status: '開催', ...o }) as Session;

describe('送り先', () => {
  test('シリーズの専用チャンネルと、基本にも送るなら種類のチャンネル。同じチャンネルなら1つだけ', () => {
    const port = discordTargets(ctx, '港', 'recruit');
    expect(port.map((t) => [t.channelId, t.label])).toEqual([[CH(3), 'シリーズ「港」のチャンネル'], [CH(2), '募集のチャンネル']]);
    expect(discordTargets(ctx, '古城', '').map((t) => t.channelId)).toEqual([CH(1)]);
    // 開催前の知らせのチャンネルが無ければ基本へ
    expect(discordTargets(ctx, '', 'remind')).toEqual([{ channelId: CH(1), label: '基本のチャンネル', series: '' }]);
    expect(unionTargets([port, discordTargets(ctx, '', 'recruit'), discordTargets(ctx, '', '')]).map((t) => t.channelId)).toEqual([CH(3), CH(2), CH(1)]);
  });

  test('基本に送らないシリーズは専用のチャンネルだけ。専用のチャンネルが無いシリーズと知らないシリーズは、種類か基本のチャンネルへ', () => {
    expect(discordTargets(ctx, '砂漠', 'recruit').map((t) => t.channelId)).toEqual([CH(4)]);
    expect(discordTargets(ctx, '孤島', '').map((t) => t.label)).toEqual(['基本のチャンネル']);
    expect(discordTargets(ctx, '迷宮', 'recruit').map((t) => t.label)).toEqual(['募集のチャンネル']);
  });

  test('種類ごとのチャンネルがあればそこ。無ければ基本、基本も無ければ送り先なし', () => {
    const own = { group: group({ channel_id: CH(1), remind_channel_id: CH(5) }), seriesNotify: {} };
    expect(kindBase(own, 'remind')).toEqual({ channelId: CH(5), label: '開催前の知らせのチャンネル', series: '', kind: 'remind' });
    expect(kindBase(own, 'recruit')).toEqual({ channelId: CH(1), label: '基本のチャンネル', series: '' });
    expect(kindBase(own, '')!.channelId).toBe(CH(1));
    const none = { group: group({}), seriesNotify: { 港: { channelId: CH(3), alsoBase: true, days: null, hour: null } } };
    expect(kindBase(none, 'remind')).toBeNull();
    expect(discordTargets(none, '', '')).toEqual([]);
    // 基本にも送るシリーズでも、基本のチャンネルが無ければ専用のチャンネルだけ
    expect(discordTargets(none, '港', '').map((t) => t.channelId)).toEqual([CH(3)]);
  });

  test('卓の送り先は、状態が募集なら募集のチャンネル。種類を渡せばそれに従う', () => {
    expect([sessionKind(s({ status: '募集' })), sessionKind(s({}))]).toEqual(['recruit', '']);
    expect(sessionTargets(ctx, s({ status: '募集' }))[0]!.channelId).toBe(CH(2));
    expect(sessionTargets(ctx, s({}))[0]!.channelId).toBe(CH(1));
    expect(sessionTargets(ctx, s({ status: '募集' }), '')[0]!.channelId).toBe(CH(1));
    expect(sessionTargets(ctx, s({}), 'recruit')[0]!.channelId).toBe(CH(2));
    expect(sessionTargets(ctx, s({ series: '港' })).map((t) => t.channelId)).toEqual([CH(3), CH(1)]);
  });

  test('送信記録の対象には、シリーズと種類のチャンネルだけ添える', () => {
    const [series, recruit] = discordTargets(ctx, '港', 'recruit');
    expect(targetNote(series)).toBe('（シリーズ「港」のチャンネル）');
    expect(targetNote(recruit)).toBe('（募集のチャンネル）');
    expect(targetNote(discordTargets(ctx, '', '')[0])).toBe('');
    expect(targetNote(undefined)).toBe('');
  });
});

describe('開催前の知らせの日時', () => {
  test('シリーズに値があればそれ、無ければ基本の値。開催日の無い卓には送る日が無い', () => {
    expect([notifyDaysOf(ctx, s({ series: '港' })), notifyHourOf(ctx, s({ series: '港' }))]).toEqual([3, 20]);
    expect([notifyDaysOf(ctx, s({ series: '古城' })), notifyHourOf(ctx, s({ series: '古城' }))]).toEqual([1, 9]);
    expect([notifyDaysOf(ctx, s({ series: '迷宮' })), notifyHourOf(ctx, s({}))]).toEqual([1, 20]);
    expect(notifyYmdOf(ctx, s({ series: '港', date: '2026-10-17' }))).toBe('2026-10-14');
    expect(notifyYmdOf(ctx, s({ series: '港' }))).toBe('');
  });

  test('日時の言い方と、開催日まで何日あるかの言い方', () => {
    expect([notifyWhenText(0, 12), notifyWhenText(1, 20), notifyWhenText(3, 9)]).toEqual(['当日の12時台', '前日の20時台', '3日前の9時台']);
    expect([-1, 0, 1, 2, 5].map(aheadText)).toEqual(['今日', '今日', '明日', 'あさって', '5日後']);
  });
});
