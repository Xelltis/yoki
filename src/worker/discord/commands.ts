// Discordのスラッシュコマンド（/yoki）。運営者が運営の管理画面で入れると、受け口を入れてから、Botのトークンでコマンドを登録する（setCommands）。
// 受け口はボタンと同じ（routes/discord.ts）。返事は本人にだけ見せ、読むだけ（書き込みはしない）。
//   /yoki agenda（予定）: このサーバーのグループで、あなたの番（日程調整・キャラシ）と、これからの卓
//   /yoki free（空き）[日付]: このサーバーのグループの、その日のメンバーの予定（全員空きか）
// 使えるのは、このサーバーのグループのメンバー（ログインしたことがあるか、DiscordのIDを入れたメンバー）だけ
import { DISCORD_API } from '../auth/oauth';
import type { Actor } from '../auth/guard';
import { agendaOf } from '../domain/agenda';
import { STATUS } from '../domain/constants';
import { loadGroup } from '../domain/load';
import { bookedPartsMap } from '../domain/model';
import type { Ctx } from '../domain/types';
import type { Bindings } from '../env';
import { badRequest } from '../lib/errors';
import { addDays, fmtDateJa, jst, parseYmd, timeRange } from '../lib/jst';
import { bookedAt, markAt, type Part } from '../../shared/parts';
import type { AgendaItem } from '../../shared/api';
import { discordFetch } from './calls';
import { COMMANDS_KEY, ensureEndpoint, putMeta } from './interactions';

/** 登録するコマンド（Discordのapplication commands）。名前と説明は、日本語の画面では日本語で出る */
export const COMMANDS = [
  {
    name: 'yoki',
    type: 1,
    description: 'Yoki: TRPG session schedule',
    description_localizations: { ja: 'Yoki: TRPGの卓の予定' },
    // サーバーの中だけで使う
    contexts: [0],
    options: [
      {
        type: 1, name: 'agenda', name_localizations: { ja: '予定' },
        description: 'Your turns and upcoming sessions', description_localizations: { ja: 'あなたの番（日程調整・キャラシ）と、これからの卓' },
      },
      {
        type: 1, name: 'free', name_localizations: { ja: '空き' },
        description: "Members' availability on a day", description_localizations: { ja: 'その日のメンバーの予定（全員空きか）' },
        options: [{
          type: 3, name: 'day', name_localizations: { ja: '日付' }, required: false,
          description: 'Day (10/12 or 2026-10-12, today if omitted)', description_localizations: { ja: '日付（10/12 や 2026-10-12。省くと今日）' },
        }],
      },
    ],
  },
];

/** あなたの予定に出す行の数（Discordの文は2000文字まで） */
const AGENDA_LINES = 15;
/** 空きを見るグループの数（1グループの読み込みで14問い合わせを使うため） */
const FREE_GROUPS = 2;

/** スラッシュコマンドを使う・やめる（運営者）。使うときは受け口を入れてから登録し、やめるときは登録を消す（トークンが無ければ印だけ外す） */
export async function setCommands(env: Bindings, on: boolean, origin: string): Promise<string> {
  if (!on) {
    let note = '';
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_CLIENT_ID) {
      const res = await discordFetch(DISCORD_API + '/applications/' + env.DISCORD_CLIENT_ID + '/commands', {
        method: 'PUT', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json' }, body: '[]',
      });
      if (!res.ok) note = '（Discordからコマンドを消せませんでした。HTTP ' + res.status + '）';
    }
    await putMeta(env.DB, COMMANDS_KEY, '0');
    return 'スラッシュコマンドを止めました。' + note;
  }
  const { appId, headers } = await ensureEndpoint(env, origin, 'スラッシュコマンド');
  const res = await discordFetch(DISCORD_API + '/applications/' + appId + '/commands', { method: 'PUT', headers, body: JSON.stringify(COMMANDS) });
  if (!res.ok) throw badRequest('Discordがコマンドを受け付けませんでした（HTTP ' + res.status + '）。');
  await putMeta(env.DB, COMMANDS_KEY, '1');
  return 'スラッシュコマンド（/yoki）を使えるようにしました。Discordで「/yoki 予定」「/yoki 空き」と打つと、本人にだけ返事が出ます。';
}

/** Discordから届くコマンドの中身（使うところだけ） */
export type CommandInteraction = {
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { name?: string; options?: { name: string; options?: { name: string; value?: unknown }[] }[] };
};

/**
 * 日付を読む。省くと今日。「明日」「あさって」、YYYY-MM-DD、M/D（M月D日）を読む（全角の数字も）。
 * 年の無い日は今年で、過ぎていれば来年にする。読めなければnull
 */
export function readDay(raw: string, today: string): string | null {
  const v = raw.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, '/');
  if (!v || v === '今日') return today;
  if (v === '明日') return addDays(today, 1);
  if (v === 'あさって' || v === '明後日') return addDays(today, 2);
  const full = parseYmd(v);
  if (full) return full;
  const m = /^(\d{1,2})[/月](\d{1,2})日?$/.exec(v);
  if (!m) return null;
  const at = (y: number) => parseYmd(y + '-' + m[1] + '-' + m[2]);
  const day = at(Number(today.slice(0, 4)));
  return day && day < today ? at(Number(today.slice(0, 4)) + 1) : day;
}

type GroupRow = { id: string; title: string; member_id: number; name: string; is_admin: number; user_id: string | null };

/** コマンドを処理し、本人にだけ見せる文を返す */
export async function handleCommand(env: Bindings, it: CommandInteraction, appBase: string, now: Date): Promise<string> {
  const sub = it.data?.options?.[0];
  if (it.data?.name !== 'yoki' || !sub) return 'このコマンドは使えません。';
  if (!it.guild_id) return 'Discordサーバーの中で使ってください。';
  const db = env.DB;
  const userId = it.member?.user?.id ?? it.user?.id ?? '';
  if (await db.prepare('SELECT 1 FROM users WHERE id = ? AND banned_at IS NOT NULL').bind(userId).first()) return 'このアカウントでは使えません。';
  // このサーバーのグループのうち、メンバーのもの（1グループに1行。ログインしたことのある行を先に）
  const rows = (await db
    .prepare(
      `SELECT g.id, g.title, m.id AS member_id, m.name, m.is_admin, m.user_id FROM groups g JOIN members m ON m.group_id = g.id
        WHERE g.guild_id = ?1 AND (m.user_id = ?2 OR m.discord_id = ?2) ORDER BY g.created_at, g.id, m.user_id IS NULL`,
    )
    .bind(it.guild_id, userId)
    .all<GroupRow>()).results;
  const groups = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
  if (!groups.length) return 'このサーバーのYokiのグループに、まだ入っていません。Yokiでグループを開いてから使ってください: ' + appBase + '/';
  if (sub.name === 'agenda') return agendaText(db, userId, groups, appBase, now);
  if (sub.name === 'free') {
    const raw = String(sub.options?.find((o) => o.name === 'day')?.value ?? '');
    const day = readDay(raw, jst(now).ymd);
    if (!day) return '日付が読めません: ' + raw + '（10/12 や 2026-10-12 の形で入れてください）';
    const texts: string[] = [];
    for (const g of groups.slice(0, FREE_GROUPS)) {
      const actor: Actor = { memberId: g.member_id, name: g.name, isAdmin: g.is_admin === 1, userId: g.user_id ?? '' };
      texts.push(dayText(await loadGroup(db, g.id, actor, appBase + '/g/' + g.id + '/', now), day, groups.length > 1));
    }
    if (groups.length > FREE_GROUPS) texts.push('ほかのグループは、Yokiで見てください: ' + appBase + '/');
    return texts.join('\n\n');
  }
  return 'このコマンドは使えません。';
}

/** あなたの番と、これからの卓（入口の「あなたの予定」と同じ）。ログインしたことが無ければ、出せない */
async function agendaText(db: D1Database, userId: string, groups: GroupRow[], appBase: string, now: Date): Promise<string> {
  if (!groups.some((g) => g.user_id)) return 'Yokiに一度ログインすると、あなたの予定が出ます: ' + appBase + '/';
  const { items } = await agendaOf(db, userId, groups.map((g) => g.id), now);
  if (!items.length) return '📅 これからの卓と、あなたの番はありません。\n🔗 ' + appBase + '/';
  const where = (x: AgendaItem) => (groups.length > 1 ? '【' + x.groupTitle + '】' : '');
  const line = (x: AgendaItem) =>
    x.kind === 'vote' ? '🗳️ ' + where(x) + '日程調整に答えてください' + (x.date ? '（締め切り ' + fmtDateJa(x.date) + '）' : '') + ': ' + x.name
    : x.kind === 'decide' ? '🗳️ ' + where(x) + '回答がそろいました。開催日を選んでください: ' + x.name
      : x.kind === 'sheet' ? '📝 ' + where(x) + 'キャラシの締め切り ' + fmtDateJa(x.date) + ': ' + x.name
        : '📅 ' + where(x) + fmtDateJa(x.date) + ' ' + timeRange(x) + ' ' + x.name;
  const more = items.length - AGENDA_LINES;
  return ['あなたの予定', ...items.slice(0, AGENDA_LINES).map(line), ...(more > 0 ? ['ほか' + more + '件'] : []), '🔗 ' + appBase + '/'].join('\n');
}

/** その日のメンバーの予定。昼と夜に分けるグループは時間帯ごとに。予定表の範囲の外の日は、そう返す */
function dayText(ctx: Ctx, day: string, withTitle: boolean): string {
  const head = (withTitle ? '【' + ctx.group.title + '】' : '') + '📅 ' + fmtDateJa(day) + 'の予定';
  if (day < ctx.today || day >= addDays(ctx.today, ctx.group.avail_days)) {
    return head + '\n予定表の範囲（今日から' + ctx.group.avail_days + '日）の外の日です。';
  }
  const booked = bookedPartsMap(ctx.sessions, ctx.members);
  const lines = [head];
  for (const part of (ctx.group.day_parts ? ['昼', '夜'] : ['']) as (Part | '')[]) {
    const ok: string[] = [], soft: string[] = [], ng: string[] = [], busy: string[] = [];
    for (const m of ctx.members) {
      if (bookedAt(booked, day, m.name, part)) busy.push(m.name);
      else {
        const v = markAt(ctx.avail, ctx.availParts, day, m.name, part);
        (v === '×' ? ng : v === '△' ? soft : ok).push(m.name);
      }
    }
    const state = ng.length || busy.length ? '× か卓のある人がいます' : soft.length ? '△ の人がいます（ほかは空き）' : '全員空きです';
    lines.push((part ? '【' + part + '】' : '') + '→ ' + state);
    lines.push('空き: ' + (ok.join('、') || 'なし'));
    if (soft.length) lines.push('△: ' + soft.join('、'));
    if (ng.length) lines.push('×: ' + ng.join('、'));
    if (busy.length) lines.push('卓あり: ' + busy.join('、'));
  }
  const held = ctx.sessions.filter((s) => s.status === STATUS.HELD && s.date === day).map((s) => s.name + '（' + timeRange(s) + '）');
  if (held.length) lines.push('この日の卓: ' + held.join('、'));
  const notes = Object.entries(ctx.dayNotes).filter(([k, n]) => k <= day && day <= (n.to || k)).map(([, n]) => n.text);
  if (notes.length) lines.push('メモ: ' + notes.join('／'));
  lines.push('🔗 ' + ctx.appUrl);
  return lines.join('\n');
}
