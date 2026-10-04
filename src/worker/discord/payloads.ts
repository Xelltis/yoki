// Discord に送る文面（GAS 版 Discord.js・Polls.js の …Payload_）
import { STATUS } from '../domain/constants';
import { peopleOf, pollVoters, windowInfo } from '../domain/model';
import type { Ctx, Session } from '../domain/types';
import { fmtDateJa, timeRange } from '../lib/jst';

export type Embed = { title: string; description: string; color: number; footer: { text: string } };
export type Payload = { content: string; embeds?: Embed[] };

type PayloadCtx = Pick<Ctx, 'group' | 'memberByName' | 'appUrl' | 'votes' | 'today'>;

const label = (s: Session) => windowInfo(s.windowFrom, s.windowTo)?.label ?? '';

/** 「10/3（土） 20:00〜23:00」。募集中なら「10/3（土）〜10/17（土） に開催予定（募集中）」（GAS 版 whenText_） */
export function whenText(s: Session): string {
  if (s.date) return fmtDateJa(s.date) + ' ' + timeRange(s);
  if (s.status === STATUS.RECRUIT) return (label(s) ? label(s) + ' に開催予定' : '時期未定') + '（募集中）';
  if (s.status === STATUS.ADJUSTING) {
    if (s.candidates.length) return '候補日: ' + s.candidates.map(fmtDateJa).join('、') + '（日程調整中）';
    return (label(s) ? label(s) + ' のどこか' : '期間未定') + '（調整中）';
  }
  return '日程未定';
}

export function sessionEmbed(ctx: PayloadCtx, s: Session): Embed {
  const lines = ['GM: ' + (s.gm || '未定'), '日時: ' + whenText(s), '参加者: ' + (s.members.length ? s.members.join('、') : '未定')];
  if (s.status === STATUS.RECRUIT && s.want.length) lines.push('参加希望: ' + s.want.join('、'));
  if (s.place) lines.push('場所: ' + s.place);
  if (s.memo) lines.push('メモ: ' + s.memo);
  return {
    title: s.name + (s.status === STATUS.RECRUIT ? '（募集中）' : s.status === STATUS.ADJUSTING ? '（調整中）' : ''),
    description: lines.join('\n'),
    color: 0x4a86e8,
    footer: { text: ctx.group.title },
  };
}

const discordIdOf = (ctx: PayloadCtx, name: string) => ctx.memberByName.get(name)?.discordId ?? '';

/** GM と参加者のメンション（Discord ID のある人だけ。重ならないように） */
export function mentionsOf(ctx: PayloadCtx, sessions: Session[]): string {
  const ids = new Set<string>();
  for (const s of sessions) for (const n of peopleOf(s)) { const id = discordIdOf(ctx, n); if (id) ids.add('<@' + id + '>'); }
  return [...ids].join(' ');
}

/** 募集・調整の知らせに添える、卓予定への案内の行（GAS 版 recruitLink_） */
export function recruitLink(ctx: PayloadCtx, s: Session): string {
  const what = s.status === STATUS.RECRUIT ? '参加希望' : s.status === STATUS.ADJUSTING ? '日程調整' : '';
  return what && ctx.appUrl ? '\n🔗 ' + what + 'は卓予定の「募集・調整」タブから: ' + ctx.appUrl : '';
}

/** 登録・変更・削除。削除は本文だけ（卓はもう無い）。登録のときは GM と参加者をメンションする */
export function changePayload(ctx: PayloadCtx, s: Session, verb: '登録' | '変更' | '削除', editor: string): Payload {
  const icon = { 登録: '🆕', 変更: '✏️', 削除: '🗑️' }[verb];
  const mentions = verb === '登録' ? mentionsOf(ctx, [s]) : '';
  return {
    content: icon + ' 卓の予定が' + verb + 'されました' + (editor ? '（' + editor + '）' : '') +
      (verb === '削除' ? '：' + s.name : (mentions ? '\n' + mentions : '') + recruitLink(ctx, s)),
    embeds: verb === '削除' ? [] : [sessionEmbed(ctx, s)],
  };
}

/** 卓 1 件の案内。参加者をメンションする */
export function announcePayload(ctx: PayloadCtx, s: Session, me: string): Payload {
  const mentions = mentionsOf(ctx, [s]);
  return {
    content: '📣 卓の案内: ' + s.name + '（' + whenText(s) + '）' + (me ? '　by ' + me : '') + (mentions ? '\n' + mentions : '') + recruitLink(ctx, s),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** 募集中の卓の「興味あり」の人に、参加できるかを聞く。GM の一言を挟める */
export function askPayload(ctx: PayloadCtx, s: Session, me: string, message: string): Payload {
  const withId: string[] = [], noId: string[] = [];
  for (const n of s.interest) { const id = discordIdOf(ctx, n); if (id) withId.push('<@' + id + '>'); else noId.push(n + ' さん'); }
  const lines = ['❓ 「' + s.name + '」（' + (label(s) ? label(s) + ' に開催予定' : '時期未定') + '）に参加できそうですか？ ' + withId.concat(noId).join(' ')];
  const msg = message.trim();
  if (msg) lines.push('💬 ' + msg + (me ? '（' + me + '）' : ''));
  lines.push('参加希望であれば、卓予定の「募集・調整」タブで「参加希望」を押してください。' + (me && !msg ? '　by ' + me : '') + (ctx.appUrl ? '\n' + ctx.appUrl : ''));
  return { content: lines.join('\n'), embeds: [sessionEmbed(ctx, s)] };
}

/** 日程調整の知らせ。GM と参加者を呼び、候補日と答え方を書く */
export function pollPayload(ctx: PayloadCtx, s: Session, me: string): Payload {
  const noId = peopleOf(s).filter((n) => !discordIdOf(ctx, n)).map((n) => n + ' さん');
  const call = [mentionsOf(ctx, [s])].concat(noId).filter(Boolean).join(' ');
  const lines = [
    '🗓️ 「' + s.name + '」の日程を決めます。' + call,
    '候補日: ' + s.candidates.map(fmtDateJa).join('、') + (s.start || s.end ? '　' + timeRange(s) : ''),
    '卓予定の「募集・調整」タブで、候補日ごとに ◯ か × を押してください。全員の回答がそろったら、GM が開催日を選びます。' + (me ? '　by ' + me : '') + (ctx.appUrl ? '\n' + ctx.appUrl : ''),
  ];
  return { content: lines.join('\n'), embeds: [sessionEmbed(ctx, s)] };
}

/** 日程調整の回答がそろった。GM だけを呼び、候補日ごとの ◯ の数を並べる */
export function pollReadyPayload(ctx: PayloadCtx, s: Session): Payload {
  const gmId = discordIdOf(ctx, s.gm);
  const call = gmId ? '<@' + gmId + '>' : s.gm ? s.gm + ' さん' : '';
  const votes = ctx.votes.get(s.rowId) ?? {};
  const voters = pollVoters(ctx, s);
  const days = s.candidates
    .filter((k) => k >= ctx.today)
    .map((k) => {
      const ok = voters.filter((n) => votes[k]?.[n] === '◯');
      return '・' + fmtDateJa(k) + '　◯ ' + ok.length + '/' + voters.length + (ok.length === voters.length ? '（全員 ◯）' : '');
    });
  return {
    content: ['📝 「' + s.name + '」の日程調整の回答がそろいました。' + call, days.join('\n'), '卓予定の「募集・調整」タブで、開催日を選んでください。' + (ctx.appUrl ? '\n' + ctx.appUrl : '')].join('\n'),
  };
}

/** 日程が決まった。卓予定の URL を添える。開催日のある卓だけに使う（step.ts と polls.ts が確かめてから呼ぶ） */
export function decidedPayload(ctx: PayloadCtx, s: Session): Payload {
  const mentions = mentionsOf(ctx, [s]);
  return {
    content: '✅ 「' + s.name + '」の日程が決まりました: ' + fmtDateJa(s.date!) + ' ' + timeRange(s) + (mentions ? '\n' + mentions : '') + (ctx.appUrl ? '\n🔗 卓予定: ' + ctx.appUrl : ''),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** まとめての変更・複数日の登録 */
export function bulkPayload(label: string, me: string, names: string[], mentions: string): Payload {
  return { content: '🔁 卓の予定を一括で' + label + (me ? '（' + me + '）' : '') + '\n' + names.map((n) => '・' + n).join('\n') + (mentions ? '\n' + mentions : '') };
}

export function testPayload(title: string, where = ''): Payload {
  return { content: '✅ 卓予定管理から接続テスト（' + title + (where ? ' / ' + where : '') + '）' };
}
