// 画面に渡す一式（GAS版consoleData_）。形はsrc/shared/api.tsのConsoleData（画面と共有する）。日時の書き方はGAS版のまま。
// 外したもの: url（シート）・hasPassword・adminSet。足したもの: me・group・members[].linked / admin・settings.remind
import { type ConsoleData, type ConsolePrep, type ConsoleScenario, DM_KINDS, type DmKind } from '../../shared/api';
import { botInviteUrl, CREATE_EVENTS, THREAD_PERMISSIONS } from '../discord/channel';
import { addDays, fmtDateTime, stampText } from '../lib/jst';
import { STATUS_LIST } from './constants';
import { bookedMap, bookedPartsMap, windowInfo } from './model';
import type { Ctx, Session } from './types';

export function consoleData(ctx: Ctx): ConsoleData {
  const g = ctx.group;
  const self = ctx.members.find((m) => m.id === ctx.actor.memberId);
  const availDays: string[] = [];
  for (let i = 0; i < g.avail_days; i++) availDays.push(addDays(ctx.today, i));
  const notes: ConsoleData['notes'] = {};
  for (const [k, n] of Object.entries(ctx.dayNotes)) notes[k] = { text: n.text, by: n.by, at: stampText(n.at), to: n.to };
  const availNotes: Record<string, Record<string, { text: string; at: string }>> = {};
  for (const [k, byName] of Object.entries(ctx.availNotes)) {
    availNotes[k] = {};
    for (const [name, n] of Object.entries(byName)) availNotes[k]![name] = { text: n.text, at: stampText(n.at) };
  }
  const setter = g.remind_enabled ? g.remind_set_by || '有効' : '';
  return {
    title: g.title,
    me: {
      name: ctx.actor.name, isAdmin: ctx.actor.isAdmin, shareBusy: !!self?.shareBusy,
      dm: { kinds: (self?.dmKinds ?? '').split(',').filter((k): k is DmKind => k in DM_KINDS), error: self?.dmError ?? '' },
    },
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
        candidates: s.candidates, votes: ctx.votes.get(s.rowId) ?? {}, pollDue: s.pollDue ?? '',
        scenarioId: s.scenarioId === null ? '' : String(s.scenarioId),
        prep: prepView(ctx, s),
        capacity: s.capacity ?? 0, recruitDue: s.recruitDue ?? '',
        absent: s.absent.map((a) => ({ name: a.name, note: a.note, at: stampText(a.at) })),
        record: { logUrl: s.logUrl, recap: s.recap },
      };
    }),
    avail: ctx.avail,
    availParts: ctx.availParts,
    notes,
    availNotes,
    log: ctx.log.map((l) => ({ at: stampText(l.at), kind: l.kind, target: l.target, result: l.result })),
    booked: bookedMap(ctx.sessions, ctx.members),
    bookedParts: bookedPartsMap(ctx.sessions, ctx.members),
    availDays,
    channelSet: !!g.channel_id,
    remindChannelSet: !!g.remind_channel_id,
    recruitChannelSet: !!g.recruit_channel_id,
    bot: {
      ready: !!ctx.bot.token, inviteUrl: botInviteUrl(ctx.bot.clientId, g.guild_id), eventsInviteUrl: botInviteUrl(ctx.bot.clientId, g.guild_id, CREATE_EVENTS),
      threadsInviteUrl: botInviteUrl(ctx.bot.clientId, g.guild_id, THREAD_PERMISSIONS),
    },
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
      dayParts: g.day_parts === 1,
      calMonths: g.cal_months,
      availDays: g.avail_days,
      setter,
      discordEvents: g.discord_events === 1,
      threads: g.threads === 1,
      eventsError: g.events_error,
    },
    seriesNotify: Object.keys(ctx.seriesNotify)
      .sort()
      .map((k) => {
        const sn = ctx.seriesNotify[k]!;
        return { series: k, channelId: sn.channelId, alsoBase: sn.alsoBase, days: sn.days, hour: sn.hour };
      }),
    calendar: calendarView(ctx),
    availGoogle: ctx.availGoogle,
    googleLogin: { ready: ctx.googleReady, email: ctx.googleLoginEmail },
    scenarios: scenarioViews(ctx),
  };
}

/**
 * 卓の準備。人は名前で出す。秘匿HOは読み込みで絞ってある（GMと割り当てた本人の分だけ）。
 * 希望は、GM・管理者・本人の分だけを出す（ほかのPLの希望は見せない）
 */
function prepView(ctx: Ctx, s: Session): ConsolePrep {
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  const seesAllHopes = ctx.actor.isAdmin || (!!s.gm && s.gm === ctx.actor.name);
  const sheets: ConsolePrep['sheets'] = {};
  // キャラシと希望の行はメンバーが消えたら一緒に消え、割り当てはnullになるので、名前はいつもある
  for (const sh of s.sheets) sheets[nameOf.get(sh.memberId)!] = { url: sh.url, pc: sh.pc, at: stampText(sh.at), outcome: sh.outcome };
  return {
    sheetDue: s.sheetDue ?? '',
    slots: s.slots.map((sl) => {
      const hopes: Record<string, number> = {};
      for (const h of sl.hopes) if (seesAllHopes || h.memberId === ctx.actor.memberId) hopes[nameOf.get(h.memberId)!] = h.rank;
      return { pos: sl.pos, label: sl.label, summary: sl.summary, assigned: sl.memberId === null ? '' : nameOf.get(sl.memberId)!, secret: sl.secret, hasSecret: sl.hasSecret, hopes };
    }),
    sheets,
  };
}

/** シナリオと通過の印。メンバーは名前で出す（画面は名前で人を見分ける） */
function scenarioViews(ctx: Ctx): ConsoleScenario[] {
  const nameOf = new Map(ctx.members.map((m) => [m.id, m.name]));
  return ctx.scenarios.map((s) => {
    const marks: ConsoleScenario['marks'] = {};
    // 印の行はメンバーが消えたら一緒に消えるので、名前はいつもある
    for (const m of ctx.scenarioMarks) if (m.scenarioId === s.id) marks[nameOf.get(m.memberId)!] = m.kind;
    return {
      id: String(s.id), name: s.name, system: s.system, playersMin: s.playersMin, playersMax: s.playersMax, hours: s.hours, url: s.url, memo: s.memo,
      // 登録した人がメンバーでなくなると、createdByはnullになる（外部キー）
      createdBy: s.createdBy === null ? '' : nameOf.get(s.createdBy)!, marks,
    };
  });
}

/** カレンダーとの連携の様子。購読URLは、グループの画面と同じアドレスで作る */
function calendarView(ctx: Ctx): ConsoleData['calendar'] {
  const g = ctx.google;
  return {
    feed: ctx.feed ? { url: new URL(ctx.appUrl).origin + '/cal/' + ctx.feed.token + '.ics', scope: ctx.feed.scope } : null,
    googleReady: ctx.googleReady,
    google: g
      ? {
          email: g.email,
          write: g.write_events === 1,
          read: g.read_busy === 1,
          from: g.busy_from,
          to: g.busy_to,
          syncedAt: stampText(g.synced_at),
          busyAt: stampText(g.busy_at),
          error: g.error,
        }
      : null,
  };
}

