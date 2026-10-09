// グループの設定（管理画面の「知らせ」と「このグループ」。GAS版Settings.js）。知らせの設定・グループの名前・シリーズごとの知らせ
import { getChannel, isChannelId, listChannels, listRoles } from '../discord/channel';
import { EVENT_ERROR } from '../discord/events';
import { botCanCreateEvents } from '../discord/member';
import { badRequest } from '../lib/errors';
import { fmtDateTime } from '../lib/jst';
import { NOTIFY_DAYS_MAX } from './constants';
import { type Form, str } from './form';
import { notifyWhenText } from './notify';
import type { Ctx } from './types';

/** 画面から来た「何日前」と「時刻」を読む。空ならundefined。範囲の外は弾く */
function parseNotifyDays(v: unknown): number | undefined {
  if (v === undefined || v === null || str(v) === '') return undefined;
  const d = Number(str(v));
  if (!Number.isInteger(d) || d < 0 || d > NOTIFY_DAYS_MAX) throw badRequest('何日前かは0〜' + NOTIFY_DAYS_MAX + 'の整数です（0は当日、1は前日）。');
  return d;
}
function parseNotifyHour(v: unknown): number | undefined {
  if (v === undefined || v === null || str(v) === '') return undefined;
  const h = Number(str(v));
  if (!Number.isInteger(h) || h < 0 || h > 23) throw badRequest('時刻は0〜23です。');
  return h;
}
function intIn(v: unknown, min: number, max: number, message: string): number | undefined {
  if (v === undefined || str(v) === '') return undefined;
  const n = parseInt(str(v), 10);
  if (Number.isNaN(n) || n < min || n > max) throw badRequest(message);
  return n;
}
const onOff = (b: unknown) => (b ? 'ON' : 'OFF');

const KIND = { remind: { col: 'remind_channel_id', label: '開催前の知らせのチャンネル' }, recruit: { col: 'recruit_channel_id', label: '募集のチャンネル' } } as const;

/**
 * 送り先にするチャンネルを確かめ、名前を返す。このグループのDiscordサーバーのチャンネルで、Botが見られるものだけを受ける
 * （Botはほかのサーバーにもいるので、そのチャンネルに送らせないため）
 */
async function checkChannel(ctx: Ctx, channelId: string): Promise<string> {
  if (!isChannelId(channelId)) throw badRequest('チャンネルのIDが正しくありません。');
  if (!ctx.bot.token) throw badRequest('YokiのBotが設定されていないので、チャンネルを確かめられません。運営者に知らせてください。');
  const ch = await getChannel(ctx.bot.token, channelId);
  if (!ch) throw badRequest('Botがそのチャンネルを見られません。サーバーにBotを招き、チャンネルの権限を確かめてください。');
  if (ch.guildId !== ctx.group.guild_id) throw badRequest('このグループのDiscordサーバーのチャンネルではありません。');
  return ch.name;
}

/**
 * 設定を書く。送られた項目だけを変える。
 * form: { channelId（'' なら外す）, kindChannel: { kind, channelId（'' なら基本へ） }, remind, days, hour, notifyOnSave, urge, soon, soonMinutes, autoFinish, dayParts, threads, calMonths, availDays,
 *   discordEvents（卓をDiscordのイベントにも出す。入れるときは、Botがイベントを作れるかを確かめる） }
 */
export async function saveConsoleSettings(ctx: Ctx, form: Form) {
  const g = ctx.group;
  const set: Record<string, string | number> = {};
  const changes: string[] = [];
  // チャンネルは、今と違うときだけ確かめて変える（同じIDを送り直しても、Discordに聞かず、変更に数えない）
  const channelId = form.channelId === undefined ? g.channel_id : str(form.channelId);
  if (channelId !== g.channel_id) {
    set.channel_id = channelId;
    changes.push(channelId ? '基本のチャンネルを「#' + (await checkChannel(ctx, channelId)) + '」に' : '基本のチャンネルを外す');
  }
  if (form.kindChannel && typeof form.kindChannel === 'object') {
    const kc = form.kindChannel as Form;
    const kind = KIND[str(kc.kind) as keyof typeof KIND];
    if (!kind) throw badRequest('知らせの種類が不正です: ' + str(kc.kind));
    const id = str(kc.channelId);
    if (id !== g[kind.col]) {
      set[kind.col] = id;
      changes.push(id ? kind.label + 'を「#' + (await checkChannel(ctx, id)) + '」に' : kind.label + 'を外して基本へ');
    }
  }
  const nd = parseNotifyDays(form.days), nh = parseNotifyHour(form.hour);
  const days = nd ?? g.notify_days, hour = nh ?? g.notify_hour;
  if (days !== g.notify_days || hour !== g.notify_hour) {
    set.notify_days = days;
    set.notify_hour = hour;
    changes.push('開催前の知らせを' + notifyWhenText(days, hour) + 'に');
  }
  let remindMessage = '';
  if (form.remind !== undefined) {
    // 開催前の知らせを自動で送る（GAS版の「自動通知を設定」。cronはいつも動いていて、ここで有効・無効を切り替える）
    set.remind_enabled = form.remind ? 1 : 0;
    set.remind_set_by = form.remind ? ctx.actor.name + ' / ' + fmtDateTime(ctx.now) : '';
    remindMessage = form.remind
      ? '開催前の知らせを有効にしました。開催日の' + notifyWhenText(days, hour) + 'に送ります（シリーズで変えた卓はその日時）。'
      : '開催前の知らせを止めました。';
  }
  if (form.notifyOnSave !== undefined) { set.notify_on_save = form.notifyOnSave ? 1 : 0; changes.push('登録時の通知を' + onOff(form.notifyOnSave)); }
  if (form.urge !== undefined) { set.urge = form.urge ? 1 : 0; changes.push('期間前の催促を' + onOff(form.urge)); }
  const soonMinutes = intIn(form.soonMinutes, 5, 720, '開始の何分前かは5〜720です。');
  if (soonMinutes !== undefined) { set.soon_minutes = soonMinutes; changes.push('開始直前の知らせを' + soonMinutes + '分前に'); }
  if (form.soon !== undefined) { set.soon = form.soon ? 1 : 0; changes.push('開始直前の知らせを' + onOff(form.soon)); }
  if (form.autoFinish !== undefined) { set.auto_finish = form.autoFinish ? 1 : 0; changes.push('過ぎた卓の自動終了を' + onOff(form.autoFinish)); }
  if (form.threads !== undefined) { set.threads = form.threads ? 1 : 0; changes.push('卓ごとのスレッドを' + onOff(form.threads)); }
  if (form.dayParts !== undefined) { set.day_parts = form.dayParts ? 1 : 0; changes.push('予定の昼と夜を分けるのを' + onOff(form.dayParts)); }
  const calMonths = intIn(form.calMonths, 1, 12, 'カレンダーの表示月数は1〜12です。');
  if (calMonths !== undefined) { set.cal_months = calMonths; changes.push('表示月数を' + calMonths + 'に'); }
  const availDays = intIn(form.availDays, 7, 366, 'メンバーの予定の日数は7〜366です。');
  if (availDays !== undefined) { set.avail_days = availDays; changes.push('予定の日数を' + availDays + 'に'); }

  if (form.adminRole !== undefined) {
    const id = str(form.adminRole);
    if (!id) {
      set.admin_role = ''; set.admin_role_name = '';
      changes.push('管理者のロールを外す');
    } else {
      // 名前はBotで読む（画面から送られた名前は使わない）
      if (!ctx.bot.token) throw badRequest('YokiのBotのトークンが無いので、ロールを読めません。');
      const roles = await listRoles(ctx.bot.token, g.guild_id);
      if (roles === null) throw badRequest('Botがサーバーにいないので、ロールを読めません。「知らせ」の区分からBotを招いてください。');
      const role = roles.find((r) => r.id === id);
      if (!role) throw badRequest('そのロールはサーバーにありません。ロールを読み直して選んでください。');
      set.admin_role = id; set.admin_role_name = role.name;
      changes.push('管理者のロールを「' + role.name + '」に');
    }
  }

  if (form.discordEvents !== undefined) {
    if (form.discordEvents) {
      if (!ctx.bot.token) throw badRequest(EVENT_ERROR.noBot);
      if (!isChannelId(g.guild_id)) throw badRequest(EVENT_ERROR.badGuild);
      const can = await botCanCreateEvents(ctx.bot.token, g.guild_id);
      if (can === false) throw badRequest(EVENT_ERROR.forbidden);
      if (can === null) throw badRequest('Botの権限を確かめられませんでした。時間をおいてもう一度入れてください。');
    }
    // 入れたら作り、切ったらまだ始まっていないイベントを消す（どちらも見回りが拾う）
    set.discord_events = form.discordEvents ? 1 : 0;
    set.events_pending = 1;
    set.events_error = '';
    changes.push('Discordのイベントに出すのを' + onOff(form.discordEvents));
  }

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
  if (name.length > 80) throw badRequest('名前は80文字までです。');
  await ctx.db.prepare('UPDATE groups SET title = ? WHERE id = ?').bind(name, ctx.group.id).run();
  return { ok: true, message: '名前を「' + name + '」にしました。' };
}

/**
 * シリーズごとの知らせ。form: { series, channelId, alsoBase, days, hour（'' なら基本の値）, remove }
 * channelIdは変えるときだけ送る（送らなければ今のまま。'' なら外して基本のチャンネルへ）
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
  let channelId = cur?.channelId ?? '';
  if (form.channelId !== undefined) {
    channelId = str(form.channelId);
    // 今と同じチャンネルなら確かめ直さない
    if (channelId && channelId !== cur?.channelId) await checkChannel(ctx, channelId);
  }
  let days = cur?.days ?? null;
  if (form.days !== undefined && form.days !== null) days = parseNotifyDays(form.days) ?? null;
  let hour = cur?.hour ?? null;
  if (form.hour !== undefined && form.hour !== null) hour = parseNotifyHour(form.hour) ?? null;
  const alsoBase = form.alsoBase === undefined ? (cur ? cur.alsoBase : true) : !!form.alsoBase;
  await db
    .prepare(
      `INSERT INTO series_notify (group_id, series, channel_id, also_base, days, hour, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (group_id, series) DO UPDATE SET channel_id = excluded.channel_id, also_base = excluded.also_base, days = excluded.days,
         hour = excluded.hour, updated_at = excluded.updated_at`,
    )
    .bind(ctx.group.id, series, channelId, alsoBase ? 1 : 0, days, hour, ctx.now.toISOString())
    .run();
  const g = ctx.group;
  const parts = [
    channelId ? '専用のチャンネルへ' + (alsoBase ? '（基本のチャンネルにも）' : '') : '基本のチャンネルへ',
    days === null && hour === null
      ? '基本と同じ日時（開催日の' + notifyWhenText(g.notify_days, g.notify_hour) + '）に'
      : '開催日の' + notifyWhenText(days ?? g.notify_days, hour ?? g.notify_hour) + 'に',
  ];
  return { ok: true, message: '「' + series + '」の通知を保存しました: ' + parts.join('、') + '送ります。' };
}

/**
 * 送り先に選べるチャンネルの一覧（管理画面の「知らせ」が読む）。BotがこのグループのサーバーにいなければinGuild: false、
 * Botが設定されていなければ（運営者の設定）botReady: false
 */
/** サーバーのロールの一覧（管理者を決めるロールを選ぶため。管理者だけ）。Botがいなければ、そう返す */
export async function getDiscordRoles(ctx: Ctx) {
  if (!ctx.bot.token) return { ok: true, botReady: false, inGuild: false, roles: [] };
  const roles = await listRoles(ctx.bot.token, ctx.group.guild_id);
  return { ok: true, botReady: true, inGuild: roles !== null, roles: roles ?? [] };
}

export async function getDiscordChannels(ctx: Ctx) {
  if (!ctx.bot.token) return { ok: true, botReady: false, inGuild: false, channels: [], canEvents: null };
  const channels = await listChannels(ctx.bot.token, ctx.group.guild_id);
  // Botがイベントを作れるか（イベントに出すグループだけ確かめる。Discordへの呼び出しを増やさないため）
  const canEvents = channels !== null && ctx.group.discord_events === 1 ? await botCanCreateEvents(ctx.bot.token, ctx.group.guild_id) : null;
  return { ok: true, botReady: true, inGuild: channels !== null, channels: channels ?? [], canEvents };
}
