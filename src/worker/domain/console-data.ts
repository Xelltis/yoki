// 画面に渡す一式（GAS 版 consoleData_）。形は src/shared/api.ts の ConsoleData（画面と共有する）。日時の書き方は GAS 版のまま。
// 外したもの: url（シート）・hasPassword・adminSet。足したもの: me・group・members[].linked / admin・settings.remind
import type { ConsoleData } from '../../shared/api';
import { botInviteUrl } from '../discord/channel';
import { addDays, fmtDateTime, stampText } from '../lib/jst';
import { STATUS_LIST } from './constants';
import { bookedMap, windowInfo } from './model';
import type { Ctx } from './types';

export function consoleData(ctx: Ctx): ConsoleData {
  const g = ctx.group;
  const availDays: string[] = [];
  for (let i = 0; i < g.avail_days; i++) availDays.push(addDays(ctx.today, i));
  const notes: Record<string, { text: string; by: string; at: string }> = {};
  for (const [k, n] of Object.entries(ctx.dayNotes)) notes[k] = { text: n.text, by: n.by, at: stampText(n.at) };
  const availNotes: Record<string, Record<string, { text: string; at: string }>> = {};
  for (const [k, byName] of Object.entries(ctx.availNotes)) {
    availNotes[k] = {};
    for (const [name, n] of Object.entries(byName)) availNotes[k]![name] = { text: n.text, at: stampText(n.at) };
  }
  const setter = g.remind_enabled ? g.remind_set_by || '有効' : '';
  return {
    title: g.title,
    me: { name: ctx.actor.name, isAdmin: ctx.actor.isAdmin },
    group: { id: g.id, guildName: g.guild_name },
    isAdmin: ctx.actor.isAdmin,
    admins: ctx.members.filter((m) => m.isAdmin).map((m) => m.name),
    appUrl: ctx.appUrl,
    today: ctx.today,
    loadedAt: fmtDateTime(ctx.now),
    members: ctx.members.map((m) => ({
      name: m.name,
      discordId: m.discordId,
      note: m.note,
      hasDiscord: !!m.discordId,
      idOk: !m.discordId || /^\d{17,20}$/.test(m.discordId),
      linked: !!m.userId,
      admin: m.isAdmin,
    })),
    statuses: STATUS_LIST,
    sessions: ctx.sessions.map((s) => {
      const w = windowInfo(s.windowFrom, s.windowTo);
      return {
        id: s.id, name: s.name, gm: s.gm, members: s.members, date: s.date ?? '',
        start: s.start, end: s.end, status: s.status, place: s.place, memo: s.memo,
        notified: stampText(s.notifiedAt), editor: s.editor,
        want: s.want, interest: s.interest,
        asked: stampText(s.askedAt), series: s.series, seriesEnd: s.seriesEnd ?? '',
        window: w?.text ?? '', windowFrom: w?.from ?? '', windowTo: w?.to ?? '', windowLabel: w?.label ?? '', windowKey: w?.from ?? '',
        candidates: s.candidates, votes: ctx.votes.get(s.rowId) ?? {},
      };
    }),
    avail: ctx.avail,
    notes,
    availNotes,
    log: ctx.log.map((l) => ({ at: stampText(l.at), kind: l.kind, target: l.target, result: l.result })),
    booked: bookedMap(ctx.sessions),
    availDays,
    channelSet: !!g.channel_id,
    remindChannelSet: !!g.remind_channel_id,
    recruitChannelSet: !!g.recruit_channel_id,
    bot: { ready: !!ctx.bot.token, inviteUrl: botInviteUrl(ctx.bot.clientId, g.guild_id) },
    notifyDefault: g.notify_on_save === 1,
    notifySetter: setter,
    settings: {
      channelId: g.channel_id,
      remindChannelId: g.remind_channel_id,
      recruitChannelId: g.recruit_channel_id,
      notifyHour: g.notify_hour,
      notifyDays: g.notify_days,
      remind: g.remind_enabled === 1,
      urge: g.urge === 1,
      soon: g.soon === 1,
      soonMinutes: g.soon_minutes,
      notifyOnSave: g.notify_on_save === 1,
      autoFinish: g.auto_finish === 1,
      calMonths: g.cal_months,
      availDays: g.avail_days,
      setter,
    },
    seriesNotify: Object.keys(ctx.seriesNotify)
      .sort()
      .map((k) => {
        const sn = ctx.seriesNotify[k]!;
        return { series: k, channelId: sn.channelId, alsoBase: sn.alsoBase, days: sn.days, hour: sn.hour };
      }),
  };
}

