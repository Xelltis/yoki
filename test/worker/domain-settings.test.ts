// グループの設定の細かいところ（送られた項目だけを変える・断る値・シリーズごとの知らせの残し方）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { fail, GUILD, ok, setupGroup } from './helpers';

/** チャンネルの ID。Discord での名前は「ch」と末尾の数字 */
const CH = (n: number) => '12345678901234567' + n;
/** チャンネルの ID の形でないとき */
const BAD_ID = 'チャンネルの ID が正しくありません。';

let G: Awaited<ReturnType<typeof setupGroup>>;
let fetchSpy: MockInstance<typeof fetch>;
beforeEach(async () => {
  G = await setupGroup();
  // Bot がチャンネルを読む（GET /channels/<id>）。どれも、このグループのサーバーのテキストチャンネル
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const id = /\/channels\/(\d+)$/.exec(String(input))?.[1];
    if (!id) return new Response('unexpected ' + String(input), { status: 599 });
    return Response.json({ id, name: 'ch' + id.slice(-1), type: 0, guild_id: GUILD });
  });
});
afterEach(() => vi.restoreAllMocks());
type Form = Record<string, unknown>;
const save = (form: Form) => ok(G.admin, G.id, 'saveConsoleSettings', form);
const saveError = async (form: Form) => (await fail(G.admin, G.id, 'saveConsoleSettings', form)).error;
/** グループの設定の列 */
const settingsRow = () =>
  env.DB.prepare(
    `SELECT channel_id, remind_channel_id, recruit_channel_id, notify_on_save, remind_enabled, remind_set_by, notify_days, notify_hour,
            urge, soon, soon_minutes, auto_finish, cal_months, avail_days FROM groups WHERE id = ?`,
  ).bind(G.id).first<Record<string, unknown>>();

describe('設定', () => {
  test('何も送らなければ、何も変えない。チャンネルを送らなければ、今のチャンネルを残す', async () => {
    await save({ channelId: CH(1), kindChannel: { kind: 'remind', channelId: CH(2) } });
    const before = await settingsRow();
    expect((await save({})).message).toBe('変更はありません。');
    // 種類ごとのチャンネルは、種類とチャンネルの組で来たときだけ見る
    expect((await save({ kindChannel: 'remind' })).message).toBe('変更はありません。');
    expect(await settingsRow()).toEqual(before);
    expect(before).toMatchObject({ channel_id: CH(1), remind_channel_id: CH(2), recruit_channel_id: '' });
  });

  test('基本のチャンネルは、確かめてからその名前で知らせる。ID の形でないものは断る。空にすると外す', async () => {
    // 前の Webhook の URL を貼っても受けない
    expect(await saveError({ channelId: 'https://discord.com/api/webhooks/123456789012345678/token' })).toBe(BAD_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
    let r = await save({ channelId: CH(1) });
    expect(r.message).toBe('保存しました: 基本のチャンネルを「#ch1」に');
    expect(r.data).toMatchObject({ channelSet: true, settings: { channelId: CH(1) } });
    r = await save({ channelId: '' });
    expect(r.message).toBe('保存しました: 基本のチャンネルを外す');
    expect(r.data.channelSet).toBe(false);
    expect((await settingsRow())!.channel_id).toBe('');
  });

  test('何日前は 0〜30 の整数だけ。今と同じ値なら変更に数えない', async () => {
    for (const days of ['31', '-1', '1.5', 'あした']) expect(await saveError({ days })).toBe('何日前かは 0〜30 の整数です（0 は当日、1 は前日）。');
    expect((await save({ days: '30' })).message).toBe('保存しました: 開催前の知らせ 30 日前の 20 時台');
    expect((await save({ days: '30', hour: '20' })).message).toBe('変更はありません。');
    expect((await settingsRow())!.notify_days).toBe(30);
  });

  test('時刻・開始の何分前・表示月数・予定の日数は、決まった範囲の中だけ', async () => {
    expect(await saveError({ hour: '24' })).toBe('時刻は 0〜23 です。');
    expect(await saveError({ soonMinutes: '721' })).toBe('開始の何分前かは 5〜720 です。');
    expect(await saveError({ calMonths: '13' })).toBe('カレンダーの表示月数は 1〜12 です。');
    expect(await saveError({ availDays: '6' })).toBe('メンバーの予定の日数は 7〜366 です。');
    expect(await saveError({ calMonths: 'たくさん' })).toBe('カレンダーの表示月数は 1〜12 です。');
    const r = await save({ hour: '0', soonMinutes: '5', calMonths: '12', availDays: '366' });
    expect(r.message).toBe('保存しました: 開催前の知らせ 前日の 0 時台、開始の 5 分前、表示月数 12、予定の日数 366');
    expect(await settingsRow()).toMatchObject({ notify_hour: 0, soon_minutes: 5, cal_months: 12, avail_days: 366 });
  });

  test('種類ごとのチャンネル: 知らない種類と ID の形でないものは断る。空にすると基本のチャンネルに戻る', async () => {
    expect(await saveError({ kindChannel: { kind: 'other', channelId: CH(1) } })).toBe('知らせの種類が不正です: other');
    expect(await saveError({ kindChannel: { kind: 'remind', channelId: '#開催前' } })).toBe(BAD_ID);
    let r = await save({ channelId: CH(1), kindChannel: { kind: 'recruit', channelId: CH(3) } });
    expect(r.message).toBe('保存しました: 基本のチャンネルを「#ch1」に、募集のチャンネルを「#ch3」に');
    r = await save({ kindChannel: { kind: 'remind', channelId: CH(2) } });
    expect(r.message).toBe('保存しました: 開催前の知らせのチャンネルを「#ch2」に');
    expect(r.data).toMatchObject({ remindChannelSet: true, recruitChannelSet: true, settings: { remindChannelId: CH(2), recruitChannelId: CH(3) } });
    r = await save({ kindChannel: { kind: 'remind', channelId: '' } });
    expect(r.message).toBe('保存しました: 開催前の知らせのチャンネルを外して基本へ');
    expect(r.data).toMatchObject({ channelSet: true, remindChannelSet: false, recruitChannelSet: true });
  });

  test('開催前の知らせを止めると、有効にした人の控えも消える', async () => {
    await save({ remind: true });
    const r = await save({ remind: false });
    expect(r.message).toBe('開催前の知らせを止めました。');
    expect(r.data.settings).toMatchObject({ remind: false, setter: '' });
    expect(await settingsRow()).toMatchObject({ remind_enabled: 0, remind_set_by: '' });
  });

  test('ON / OFF の項目は、送ったものだけ変わる', async () => {
    let r = await save({ notifyOnSave: false, urge: true, soon: false, autoFinish: true });
    expect(r.message).toBe('保存しました: 登録時の通知 OFF、期間前の催促 ON、開始直前の知らせ OFF、過ぎた卓の自動終了 ON');
    expect(r.data.settings).toMatchObject({ notifyOnSave: false, urge: true, soon: false, autoFinish: true });
    expect(r.data.notifyDefault).toBe(false);
    r = await save({ notifyOnSave: true });
    expect(r.message).toBe('保存しました: 登録時の通知 ON');
    expect(r.data.settings).toMatchObject({ notifyOnSave: true, urge: true, soon: false, autoFinish: true });
    r = await save({ urge: false, soon: true, autoFinish: false });
    expect(r.message).toBe('保存しました: 期間前の催促 OFF、開始直前の知らせ ON、過ぎた卓の自動終了 OFF');
    expect(r.data.settings).toMatchObject({ notifyOnSave: true, urge: false, soon: true, autoFinish: false });
  });

  test('グループの名前は空にできない。80 文字まで', async () => {
    expect((await fail(G.admin, G.id, 'renameGroup', { name: ' ' })).error).toBe('名前を入れてください。');
    expect((await fail(G.admin, G.id, 'renameGroup', { name: 'あ'.repeat(81) })).error).toBe('名前は 80 文字までです。');
    const r = await ok(G.admin, G.id, 'renameGroup', { name: 'あ'.repeat(80) });
    expect(r.data.title).toBe('あ'.repeat(80));
  });
});

describe('シリーズごとの知らせ', () => {
  const series = (form: Form) => ok(G.admin, G.id, 'saveSeriesNotify', form);

  test('シリーズが空と、ID の形でないチャンネルは断る', async () => {
    expect((await fail(G.admin, G.id, 'saveSeriesNotify', { series: ' ' })).error).toBe('シリーズを選んでください。');
    expect((await fail(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: '123' })).error).toBe(BAD_ID);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM series_notify').first('n')).toBe(0);
  });

  test('初めは基本のチャンネルにも送る。送らなかった項目は前の値を残し、空の日時は基本の値に戻す', async () => {
    let r = await series({ series: '港', channelId: CH(3) });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ（基本のチャンネルにも）、基本と同じ日時（開催日の前日の 20 時台）に送ります。');
    r = await series({ series: '港', alsoBase: false, days: '3', hour: '9' });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ、開催日の3 日前の 9 時台に送ります。');
    // チャンネルと「基本にも」は送らなければ今のまま（チャンネルを確かめ直しもしない）。何日前は空にすると基本の値
    r = await series({ series: '港', days: '' });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ、開催日の前日の 9 時台に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '港', channelId: CH(3), alsoBase: false, days: null, hour: 9 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // チャンネルを空にすると、基本のチャンネルへ
    r = await series({ series: '港', channelId: '', hour: '' });
    expect(r.message).toBe('「港」の通知を保存しました: 基本のチャンネルへ、基本と同じ日時（開催日の前日の 20 時台）に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '港', channelId: '', alsoBase: false, days: null, hour: null }]);
  });

  test('何日前だけ決めると、時刻は基本の値。消すと基本の送り先と日時に戻る', async () => {
    let r = await series({ series: '港', days: '0' });
    expect(r.message).toBe('「港」の通知を保存しました: 基本のチャンネルへ、開催日の当日の 20 時台に送ります。');
    r = await series({ series: '港', remove: true });
    expect(r.message).toBe('「港」の通知の設定を消しました。基本のチャンネルと基本の時刻で送ります。');
    expect(r.data.seriesNotify).toEqual([]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM series_notify').first('n')).toBe(0);
  });
});
