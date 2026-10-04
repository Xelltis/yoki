// グループの設定の細かいところ（送られた項目だけを変える・断る値・シリーズごとの知らせの残し方）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { WEBHOOK_FORMAT_ERROR } from '../../src/worker/discord/webhook';
import { fail, ok, setupGroup } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
beforeEach(async () => {
  G = await setupGroup();
});
type Form = Record<string, unknown>;
const HOOK = (n: number) => 'https://discord.com/api/webhooks/12345678901234567' + n + '/token' + n;
const save = (form: Form) => ok(G.admin, G.id, 'saveConsoleSettings', form);
const saveError = async (form: Form) => (await fail(G.admin, G.id, 'saveConsoleSettings', form)).error;
/** グループの設定の列 */
const settingsRow = () =>
  env.DB.prepare(
    `SELECT webhook_url, remind_webhook_url, recruit_webhook_url, notify_on_save, remind_enabled, remind_set_by, notify_days, notify_hour,
            urge, soon, soon_minutes, auto_finish, cal_months, avail_days FROM groups WHERE id = ?`,
  ).bind(G.id).first<Record<string, unknown>>();

describe('設定', () => {
  test('何も送らなければ、何も変えない。Webhook URL が空でも、空にする印が無ければ残す', async () => {
    await save({ webhook: HOOK(1) });
    const before = await settingsRow();
    expect((await save({})).message).toBe('変更はありません。');
    expect((await save({ webhook: '' })).message).toBe('変更はありません。');
    expect(await settingsRow()).toEqual(before);
    expect(before!.webhook_url).toBe(HOOK(1));
  });

  test('基本の Webhook URL は Discord の形だけ。空にする印を付ければ空にできる', async () => {
    expect(await saveError({ webhook: 'https://example.com/hook' })).toBe(WEBHOOK_FORMAT_ERROR);
    expect((await save({ webhook: HOOK(1) })).message).toBe('保存しました: Webhook URL');
    const r = await save({ webhook: '', clearWebhook: true });
    expect(r.message).toBe('保存しました: Webhook URL を空に');
    expect(r.data.webhookSet).toBe(false);
    expect((await settingsRow())!.webhook_url).toBe('');
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

  test('種類ごとのチャンネル: 知らない種類と Discord でない URL は断る。外すと基本のチャンネルに戻る', async () => {
    expect(await saveError({ kindWebhook: { kind: 'other', url: HOOK(1) } })).toBe('知らせの種類が不正です: other');
    expect(await saveError({ kindWebhook: { kind: 'remind', url: 'https://example.com/hook' } })).toBe(WEBHOOK_FORMAT_ERROR);
    let r = await save({ kindWebhook: { kind: 'remind', url: HOOK(2) } });
    expect(r.message).toBe('保存しました: 開催前の知らせのチャンネルの Webhook URL');
    expect(r.data.remindWebhookSet).toBe(true);
    // URL も外す印も無ければ、そのまま
    expect((await save({ kindWebhook: { kind: 'remind', url: '' } })).message).toBe('変更はありません。');
    expect((await settingsRow())!.remind_webhook_url).toBe(HOOK(2));
    r = await save({ kindWebhook: { kind: 'remind', clear: true } });
    expect(r.message).toBe('保存しました: 開催前の知らせのチャンネルを外して基本へ');
    expect(r.data.remindWebhookSet).toBe(false);
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

  test('シリーズが空と、Discord でない URL は断る', async () => {
    expect((await fail(G.admin, G.id, 'saveSeriesNotify', { series: ' ' })).error).toBe('シリーズを選んでください。');
    expect((await fail(G.admin, G.id, 'saveSeriesNotify', { series: '港', webhook: 'https://example.com/hook' })).error).toBe(WEBHOOK_FORMAT_ERROR);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM series_notify').first('n')).toBe(0);
  });

  test('初めは基本のチャンネルにも送る。送らなかった項目は前の値を残し、空の日時は基本の値に戻す', async () => {
    let r = await series({ series: '港', webhook: HOOK(3) });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ（基本のチャンネルにも）、基本と同じ日時（開催日の前日の 20 時台）に送ります。');
    r = await series({ series: '港', alsoBase: false, days: '3', hour: '9' });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ、開催日の3 日前の 9 時台に送ります。');
    // Webhook と「基本にも」は送らなければ今のまま。何日前は空にすると基本の値
    r = await series({ series: '港', days: '' });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ、開催日の前日の 9 時台に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '港', hasWebhook: true, webhookMasked: expect.any(String), alsoBase: false, days: null, hour: 9 }]);
    r = await series({ series: '港', clearWebhook: true, hour: '' });
    expect(r.message).toBe('「港」の通知を保存しました: 基本のチャンネルへ、基本と同じ日時（開催日の前日の 20 時台）に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '港', hasWebhook: false, webhookMasked: '', alsoBase: false, days: null, hour: null }]);
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
