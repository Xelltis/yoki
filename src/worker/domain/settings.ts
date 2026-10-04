// グループの設定（管理画面の「知らせ」と「この卓予定」。GAS 版 Settings.js）。知らせの設定・グループの名前・シリーズごとの知らせ
import { isDiscordWebhook, WEBHOOK_FORMAT_ERROR } from '../discord/webhook';
import { badRequest } from '../lib/errors';
import { fmtDateTime } from '../lib/jst';
import { NOTIFY_DAYS_MAX } from './constants';
import { type Form, str } from './form';
import { notifyWhenText } from './notify';
import type { Ctx } from './types';

/** 画面から来た「何日前」と「時刻」を読む。空なら undefined。範囲の外は弾く */
function parseNotifyDays(v: unknown): number | undefined {
  if (v === undefined || v === null || str(v) === '') return undefined;
  const d = Number(str(v));
  if (!Number.isInteger(d) || d < 0 || d > NOTIFY_DAYS_MAX) throw badRequest('何日前かは 0〜' + NOTIFY_DAYS_MAX + ' の整数です（0 は当日、1 は前日）。');
  return d;
}
function parseNotifyHour(v: unknown): number | undefined {
  if (v === undefined || v === null || str(v) === '') return undefined;
  const h = Number(str(v));
  if (!Number.isInteger(h) || h < 0 || h > 23) throw badRequest('時刻は 0〜23 です。');
  return h;
}
function intIn(v: unknown, min: number, max: number, message: string): number | undefined {
  if (v === undefined || str(v) === '') return undefined;
  const n = parseInt(str(v), 10);
  if (Number.isNaN(n) || n < min || n > max) throw badRequest(message);
  return n;
}
const onOff = (b: unknown) => (b ? 'ON' : 'OFF');

const KIND = { remind: { col: 'remind_webhook_url', label: '開催前の知らせのチャンネル' }, recruit: { col: 'recruit_webhook_url', label: '募集のチャンネル' } } as const;

/**
 * 設定を書く。送られた項目だけを変える。
 * form: { webhook, clearWebhook, kindWebhook: { kind, url, clear }, remind, days, hour, notifyOnSave, urge, soon, soonMinutes, autoFinish, calMonths, availDays }
 */
export async function saveConsoleSettings(ctx: Ctx, form: Form) {
  const g = ctx.group;
  const set: Record<string, string | number> = {};
  const changes: string[] = [];
  if (form.webhook !== undefined) {
    const w = str(form.webhook);
    if (w) {
      if (!isDiscordWebhook(w)) throw badRequest(WEBHOOK_FORMAT_ERROR);
      set.webhook_url = w;
      changes.push('Webhook URL');
    } else if (form.clearWebhook) {
      set.webhook_url = '';
      changes.push('Webhook URL を空に');
    }
  }
  if (form.kindWebhook && typeof form.kindWebhook === 'object') {
    const kw = form.kindWebhook as Form;
    const kind = KIND[str(kw.kind) as keyof typeof KIND];
    if (!kind) throw badRequest('知らせの種類が不正です: ' + str(kw.kind));
    const w = str(kw.url);
    if (w) {
      if (!isDiscordWebhook(w)) throw badRequest(WEBHOOK_FORMAT_ERROR);
      set[kind.col] = w;
      changes.push(kind.label + 'の Webhook URL');
    } else if (kw.clear) {
      set[kind.col] = '';
      changes.push(kind.label + 'を外して基本へ');
    }
  }
  const nd = parseNotifyDays(form.days), nh = parseNotifyHour(form.hour);
  const days = nd ?? g.notify_days, hour = nh ?? g.notify_hour;
  if (days !== g.notify_days || hour !== g.notify_hour) {
    set.notify_days = days;
    set.notify_hour = hour;
    changes.push('開催前の知らせ ' + notifyWhenText(days, hour));
  }
  let remindMessage = '';
  if (form.remind !== undefined) {
    // 開催前の知らせを自動で送る（GAS 版の「自動通知を設定」。cron はいつも動いていて、ここで有効・無効を切り替える）
    set.remind_enabled = form.remind ? 1 : 0;
    set.remind_set_by = form.remind ? ctx.actor.name + ' / ' + fmtDateTime(ctx.now) : '';
    remindMessage = form.remind
      ? '開催前の知らせを有効にしました。開催日の' + notifyWhenText(days, hour) + 'に送ります（シリーズで変えた卓はその日時）。'
      : '開催前の知らせを止めました。';
  }
  if (form.notifyOnSave !== undefined) { set.notify_on_save = form.notifyOnSave ? 1 : 0; changes.push('登録時の通知 ' + onOff(form.notifyOnSave)); }
  if (form.urge !== undefined) { set.urge = form.urge ? 1 : 0; changes.push('期間前の催促 ' + onOff(form.urge)); }
  const soonMinutes = intIn(form.soonMinutes, 5, 720, '開始の何分前かは 5〜720 です。');
  if (soonMinutes !== undefined) { set.soon_minutes = soonMinutes; changes.push('開始の ' + soonMinutes + ' 分前'); }
  if (form.soon !== undefined) { set.soon = form.soon ? 1 : 0; changes.push('開始直前の知らせ ' + onOff(form.soon)); }
  if (form.autoFinish !== undefined) { set.auto_finish = form.autoFinish ? 1 : 0; changes.push('過ぎた卓の自動終了 ' + onOff(form.autoFinish)); }
  const calMonths = intIn(form.calMonths, 1, 12, 'カレンダーの表示月数は 1〜12 です。');
  if (calMonths !== undefined) { set.cal_months = calMonths; changes.push('表示月数 ' + calMonths); }
  const availDays = intIn(form.availDays, 7, 366, 'メンバーの予定の日数は 7〜366 です。');
  if (availDays !== undefined) { set.avail_days = availDays; changes.push('予定の日数 ' + availDays); }

  const cols = Object.keys(set);
  if (cols.length) {
    await ctx.db.prepare('UPDATE groups SET ' + cols.map((c, i) => c + ' = ?' + (i + 2)).join(', ') + ' WHERE id = ?1').bind(g.id, ...cols.map((c) => set[c])).run();
  }
  const message = remindMessage || (changes.length ? '保存しました: ' + changes.join('、') : '変更はありません。');
  return { ok: true, message };
}

/** グループの名前を変える。form: { name } */
export async function renameGroup(ctx: Ctx, form: Form) {
  const name = str(form.name);
  if (!name) throw badRequest('名前を入れてください。');
  if (name.length > 80) throw badRequest('名前は 80 文字までです。');
  await ctx.db.prepare('UPDATE groups SET title = ? WHERE id = ?').bind(name, ctx.group.id).run();
  return { ok: true, message: '名前を「' + name + '」にしました。' };
}

/**
 * シリーズごとの知らせ。form: { series, webhook, clearWebhook, alsoBase, days, hour（'' なら基本の値）, remove }
 * webhook は変えるときだけ送る（空なら今の値を残す。clearWebhook で空にする）
 */
export async function saveSeriesNotify(ctx: Ctx, form: Form) {
  const series = str(form.series);
  if (!series) throw badRequest('シリーズを選んでください。');
  const cur = ctx.seriesNotify[series];
  const db = ctx.db;
  if (form.remove) {
    await db.prepare('DELETE FROM series_notify WHERE group_id = ? AND series = ?').bind(ctx.group.id, series).run();
    return { ok: true, message: '「' + series + '」の通知の設定を消しました。基本のチャンネルと基本の時刻で送ります。' };
  }
  let webhook = cur?.webhook ?? '';
  const w = str(form.webhook);
  if (w) {
    if (!isDiscordWebhook(w)) throw badRequest(WEBHOOK_FORMAT_ERROR);
    webhook = w;
  } else if (form.clearWebhook) {
    webhook = '';
  }
  let days = cur?.days ?? null;
  if (form.days !== undefined && form.days !== null) days = parseNotifyDays(form.days) ?? null;
  let hour = cur?.hour ?? null;
  if (form.hour !== undefined && form.hour !== null) hour = parseNotifyHour(form.hour) ?? null;
  const alsoBase = form.alsoBase === undefined ? (cur ? cur.alsoBase : true) : !!form.alsoBase;
  await db
    .prepare(
      `INSERT INTO series_notify (group_id, series, webhook_url, also_base, days, hour, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (group_id, series) DO UPDATE SET webhook_url = excluded.webhook_url, also_base = excluded.also_base, days = excluded.days,
         hour = excluded.hour, updated_at = excluded.updated_at`,
    )
    .bind(ctx.group.id, series, webhook, alsoBase ? 1 : 0, days, hour, ctx.now.toISOString())
    .run();
  const g = ctx.group;
  const parts = [
    webhook ? '専用のチャンネルへ' + (alsoBase ? '（基本のチャンネルにも）' : '') : '基本のチャンネルへ',
    days === null && hour === null
      ? '基本と同じ日時（開催日の' + notifyWhenText(g.notify_days, g.notify_hour) + '）に'
      : '開催日の' + notifyWhenText(days ?? g.notify_days, hour ?? g.notify_hour) + 'に',
  ];
  return { ok: true, message: '「' + series + '」の通知を保存しました: ' + parts.join('、') + '送ります。' };
}
