// Discordに送る文面（GAS版Discord.js・Polls.jsの …Payload_）
import { STATUS } from '../domain/constants';
import { peopleOf, pollVoters, windowInfo } from '../domain/model';
import type { Ctx, Session } from '../domain/types';
import { fmtDateJa, timeRange } from '../lib/jst';
import { splitWant } from '../../shared/waitlist';
import { type Component, pollComponents, recruitComponents } from './buttons';
import { gmsOf } from '../../shared/gm';

export type Embed = { title: string; description: string; color: number; footer: { text: string } };
export type Payload = { content: string; embeds?: Embed[]; components?: Component[] };

/** 文面を作るのに使う一式。buttonsは、知らせにボタンを付けるか（運営者が入れたYokiだけ） */
type PayloadCtx = Pick<Ctx, 'group' | 'memberByName' | 'appUrl' | 'votes' | 'today'> & { buttons?: boolean };

const label = (s: Session) => windowInfo(s.windowFrom, s.windowTo)?.label ?? '';

/** 「10/3（土）20:00〜23:00」。募集中なら「10/3（土）〜10/17（土） に開催予定（募集中）」（GAS版whenText_） */
export function whenText(s: Session): string {
  if (s.date) return fmtDateJa(s.date) + ' ' + timeRange(s);
  if (s.status === STATUS.RECRUIT) return (label(s) ? label(s) + 'に開催予定' : '時期未定') + '（募集中）';
  if (s.status === STATUS.ADJUSTING) {
    if (s.candidates.length) return '候補日: ' + s.candidates.map(fmtDateJa).join('、') + '（日程調整中）';
    return (label(s) ? label(s) + 'のどこか' : '期間未定') + '（調整中）';
  }
  return '日程未定';
}

export function sessionEmbed(ctx: PayloadCtx, s: Session): Embed {
  const lines = ['GM: ' + (gmsOf(s).join('、') || '未定'), '日時: ' + whenText(s), '参加者: ' + (s.members.length ? s.members.join('、') : '未定')];
  if (s.status === STATUS.RECRUIT && (s.want.length || s.capacity)) {
    const w = splitWant(s);
    lines.push('参加希望: ' + (w.want.join('、') || 'まだいません') + (s.capacity ? '（' + w.want.length + '/' + s.capacity + '人）' : ''));
    if (w.wait.length) lines.push('キャンセル待ち: ' + w.wait.join('、'));
  }
  if (s.status === STATUS.RECRUIT && s.recruitDue) lines.push('締め切り: ' + fmtDateJa(s.recruitDue));
  if (s.status === STATUS.HELD && s.absent.length) lines.push('行けなくなった: ' + s.absent.map((a) => a.name).join('、'));
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

/** GMと参加者のメンション（Discord IDのある人だけ。重ならないように） */
export function mentionsOf(ctx: PayloadCtx, sessions: Session[]): string {
  const ids = new Set<string>();
  for (const s of sessions) for (const n of peopleOf(s)) { const id = discordIdOf(ctx, n); if (id) ids.add('<@' + id + '>'); }
  return [...ids].join(' ');
}

/** 募集・調整の知らせに添える、Yokiへの案内の行（GAS版recruitLink_） */
export function recruitLink(ctx: PayloadCtx, s: Session): string {
  const what = s.status === STATUS.RECRUIT ? '参加希望' : s.status === STATUS.ADJUSTING ? '日程調整' : '';
  return what && ctx.appUrl ? '\n🔗 ' + what + 'はYokiの「募集・調整」タブから: ' + ctx.appUrl : '';
}

/** 登録・変更・削除。削除は本文だけ（卓はもう無い）。登録のときはGMと参加者をメンションする */
export function changePayload(ctx: PayloadCtx, s: Session, verb: '登録' | '変更' | '削除', editor: string): Payload {
  const icon = { 登録: '🆕', 変更: '✏️', 削除: '🗑️' }[verb];
  const mentions = verb === '登録' ? mentionsOf(ctx, [s]) : '';
  return {
    content: icon + ' 卓の予定が' + verb + 'されました' + (editor ? '（' + editor + '）' : '') +
      (verb === '削除' ? '：' + s.name : (mentions ? '\n' + mentions : '') + recruitLink(ctx, s)),
    embeds: verb === '削除' ? [] : [sessionEmbed(ctx, s)],
    components: verb === '削除' ? undefined : recruitComponents(ctx, s),
  };
}

/** 卓1件の案内。参加者をメンションする */
export function announcePayload(ctx: PayloadCtx, s: Session, me: string): Payload {
  const mentions = mentionsOf(ctx, [s]);
  return {
    content: '📣 卓の案内: ' + s.name + '（' + whenText(s) + '）' + (me ? '　by ' + me : '') + (mentions ? '\n' + mentions : '') + recruitLink(ctx, s),
    embeds: [sessionEmbed(ctx, s)],
    components: recruitComponents(ctx, s),
  };
}

/** 募集中の卓の「興味あり」の人に、参加できるかを聞く。GMの一言を挟める */
export function askPayload(ctx: PayloadCtx, s: Session, me: string, message: string): Payload {
  const withId: string[] = [], noId: string[] = [];
  for (const n of s.interest) { const id = discordIdOf(ctx, n); if (id) withId.push('<@' + id + '>'); else noId.push(n + 'さん'); }
  const lines = ['❓ 「' + s.name + '」（' + (label(s) ? label(s) + 'に開催予定' : '時期未定') + '）に参加できそうですか？ ' + withId.concat(noId).join(' ')];
  const msg = message.trim();
  if (msg) lines.push('💬 ' + msg + (me ? '（' + me + '）' : ''));
  lines.push('参加希望であれば、Yokiの「募集・調整」タブで「参加希望」を押してください。' + (me && !msg ? '　by ' + me : '') + (ctx.appUrl ? '\n' + ctx.appUrl : ''));
  return { content: lines.join('\n'), embeds: [sessionEmbed(ctx, s)], components: recruitComponents(ctx, s) };
}

/** 日程調整の知らせ。GMと参加者を呼び、候補日と答え方を書く */
export function pollPayload(ctx: PayloadCtx, s: Session, me: string): Payload {
  const noId = peopleOf(s).filter((n) => !discordIdOf(ctx, n)).map((n) => n + 'さん');
  const call = [mentionsOf(ctx, [s])].concat(noId).filter(Boolean).join(' ');
  const lines = [
    '🗓️ 「' + s.name + '」の日程を決めます。' + call,
    '候補日: ' + s.candidates.map(fmtDateJa).join('、') + (s.start || s.end ? '　' + timeRange(s) : '') + (s.pollDue ? '\n回答の締め切り: ' + fmtDateJa(s.pollDue) : ''),
    (ctx.buttons ? '下のボタンでも答えられます。' : '') +
      'Yokiの「募集・調整」タブで、候補日ごとに ◯・△（調整すれば行ける）・× を押してください。全員の回答がそろったら、GMが開催日を選びます。' + (me ? '　by ' + me : '') + (ctx.appUrl ? '\n' + ctx.appUrl : ''),
  ];
  return { content: lines.join('\n'), embeds: [sessionEmbed(ctx, s)], components: pollComponents(ctx, s) };
}

/** 人を呼ぶ文（DiscordのIDが無ければ名前） */
const callOf = (ctx: PayloadCtx, name: string) => { const id = discordIdOf(ctx, name); return id ? '<@' + id + '>' : name + 'さん'; };

/** GMと共同GMを呼ぶ文（GMがいなければ空） */
function gmCall(ctx: PayloadCtx, s: Session): string {
  return gmsOf(s).map((n) => callOf(ctx, n)).join(' ');
}

/** これからの候補日ごとの ◯ と △ の数（1日1行） */
function pollTally(ctx: PayloadCtx, s: Session): string {
  const votes = ctx.votes.get(s.rowId) ?? {};
  const voters = pollVoters(ctx, s);
  return s.candidates
    .filter((k) => k >= ctx.today)
    .map((k) => {
      const ok = voters.filter((n) => votes[k]?.[n] === '◯'), maybe = voters.filter((n) => votes[k]?.[n] === '△');
      return '・' + fmtDateJa(k) + '　◯ ' + ok.length + '/' + voters.length + (maybe.length ? '　△ ' + maybe.length : '') + (ok.length === voters.length ? '（全員 ◯）' : '');
    })
    .join('\n');
}

/** 日程調整の回答がそろった。GMだけを呼び、候補日ごとの ◯ と △ の数を並べる */
export function pollReadyPayload(ctx: PayloadCtx, s: Session): Payload {
  return {
    content: ['📝 「' + s.name + '」の日程調整の回答がそろいました。' + gmCall(ctx, s), pollTally(ctx, s), 'Yokiの「募集・調整」タブで、開催日を選んでください。' + (ctx.appUrl ? '\n' + ctx.appUrl : '')].join('\n'),
  };
}

/** 日程調整の締め切りが近い（明日か今日）。まだ答えていない人だけを呼ぶ。ボタンを使うグループでは、そのまま答えられる */
export function pollDuePayload(ctx: PayloadCtx, s: Session, pending: string[]): Payload {
  const call = pending.map((n) => callOf(ctx, n)).join(' ');
  const when = s.pollDue === ctx.today ? '今日' : '明日';
  return {
    content: [
      '⏰ 「' + s.name + '」の日程調整の締め切りは' + when + '（' + fmtDateJa(s.pollDue!) + '）です。まだ答えていない人: ' + call,
      '候補日: ' + s.candidates.filter((k) => k >= ctx.today).map(fmtDateJa).join('、'),
      (ctx.buttons ? '下のボタンでも答えられます。' : '') + 'Yokiの「募集・調整」タブで、候補日ごとに ◯・△・× を押してください。' + (ctx.appUrl ? '\n🔗 ' + ctx.appUrl : ''),
    ].join('\n'),
    components: pollComponents(ctx, s),
  };
}

/** 日程調整の締め切りが過ぎた。GMを呼び、候補日ごとの数と、まだ答えていない人を並べる */
export function pollClosedPayload(ctx: PayloadCtx, s: Session, pending: string[]): Payload {
  const tally = pollTally(ctx, s);
  return {
    content: [
      '⌛ 「' + s.name + '」の日程調整の締め切り（' + fmtDateJa(s.pollDue!) + '）が過ぎました。' + gmCall(ctx, s),
      ...(tally ? [tally] : ['これからの候補日がありません。']),
      ...(pending.length ? ['まだ答えていない人: ' + pending.join('、')] : []),
      'Yokiの「募集・調整」タブで、開催日を選ぶか、候補日を選び直してください。' + (ctx.appUrl ? '\n🔗 ' + ctx.appUrl : ''),
    ].join('\n'),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** 参加者が行けなくなった。GMを呼び、本人の一言を添える。開催日のある卓だけに使う（absence.tsが確かめてから呼ぶ） */
export function absencePayload(ctx: PayloadCtx, s: Session, name: string, note: string): Payload {
  const call = s.gm ? ' ' + gmCall(ctx, s) : '';
  return {
    content: '🙇 「' + s.name + '」（' + fmtDateJa(s.date!) + ' ' + timeRange(s) + '）に、' + name + 'が行けなくなりました。' + call +
      (note ? '\n💬 ' + note.replace(/\s+/g, ' ').replace(/@/g, '@\u200b') : '') +
      (s.want.length ? '\nキャンセル待ち: ' + s.want.join('、') + '（Yokiの「繰り上げる」で参加者にできます）' : '') +
      '\nYokiで「日を組み直す」か、参加者を見直してください。' + (ctx.appUrl ? '\n🔗 ' + ctx.appUrl : ''),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** 募集の締め切りの日。GMを呼び、集まった人数を書く */
export function recruitDuePayload(ctx: PayloadCtx, s: Session): Payload {
  const call = s.gm ? ' ' + gmCall(ctx, s) : '';
  const w = splitWant(s);
  const got = '参加希望: ' + (w.want.length ? w.want.join('、') : 'まだいません') + (s.capacity ? '（' + w.want.length + '/' + s.capacity + '人）' : '（' + w.want.length + '人）') +
    (w.wait.length ? '　キャンセル待ち: ' + w.wait.join('、') : '');
  return {
    content: '📮 「' + s.name + '」の募集は今日（' + fmtDateJa(s.recruitDue!) + '）で締め切りです。' + got + call +
      '\n集まったら、カードの「開催にする」か、「編集」で状態を「調整中」にして進めてください。' + (ctx.appUrl ? '\n🔗 ' + ctx.appUrl : ''),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/**
 * キャンセル待ちから繰り上がった。繰り上がった人を呼ぶ。
 * autoなら募集の卓に空きが出て自動で参加希望に、でなければGMか管理者が参加者にした
 */
export function waitPromotedPayload(ctx: PayloadCtx, s: Session, names: string[], auto: boolean): Payload {
  const call = names.map((n) => callOf(ctx, n)).join(' ');
  return {
    content: (auto ? '🎟️ 「' + s.name + '」に空きが出たので、キャンセル待ちから参加希望に繰り上がりました: ' : '🎟️ 「' + s.name + '」のキャンセル待ちから、参加者に繰り上がりました: ') +
      call + (ctx.appUrl ? '\n🔗 ' + ctx.appUrl : ''),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** 日程が決まった。YokiのURLを添える。開催日のある卓だけに使う（step.tsとpolls.tsが確かめてから呼ぶ） */
export function decidedPayload(ctx: PayloadCtx, s: Session): Payload {
  const mentions = mentionsOf(ctx, [s]);
  return {
    content: '✅ 「' + s.name + '」の日程が決まりました: ' + fmtDateJa(s.date!) + ' ' + timeRange(s) + (mentions ? '\n' + mentions : '') + (ctx.appUrl ? '\n🔗 Yoki: ' + ctx.appUrl : ''),
    embeds: [sessionEmbed(ctx, s)],
  };
}

/** まとめての変更・複数日の登録 */
export function bulkPayload(label: string, me: string, names: string[], mentions: string): Payload {
  return { content: '🔁 卓の予定を一括で' + label + (me ? '（' + me + '）' : '') + '\n' + names.map((n) => '・' + n).join('\n') + (mentions ? '\n' + mentions : '') };
}

export function testPayload(title: string, where = ''): Payload {
  return { content: '✅ Yokiから接続テスト（' + title + (where ? ' / ' + where : '') + '）' };
}

/** 公開HOを知らせに載せる長さ（Discordの1通は2000文字まで） */
const SUMMARY_IN_MESSAGE = 80;
const CONTENT_MAX = 1900;

/** メンバーのメンション（Discord IDが無ければ名前） */
function memberMention(ctx: PayloadCtx, id: number | null): string {
  if (id === null) return '未定';
  const m = [...ctx.memberByName.values()].find((x) => x.id === id);
  // 割り当てはメンバーが消えたらnullになるので、いつも見つかる
  return m!.discordId ? '<@' + m!.discordId + '>' : m!.name;
}

/**
 * 卓の準備の知らせ（HOの割り当てと、キャラシの締め切り）。秘匿HOの中身は載せず、あることだけを書く（本人はYokiで読む）。
 * 割り当てたPLをメンションする
 */
export function prepPayload(ctx: PayloadCtx, s: Session, editor: string): Payload {
  const lines = s.slots.map((sl) => {
    const summary = sl.summary.length > SUMMARY_IN_MESSAGE ? sl.summary.slice(0, SUMMARY_IN_MESSAGE) + '…' : sl.summary;
    return '・' + sl.label + (summary ? '（' + summary + '）' : '') + ' → ' + memberMention(ctx, sl.memberId) + (sl.hasSecret ? ' 🔒秘匿HOあり' : '');
  });
  const secret = s.slots.some((x) => x.hasSecret) && ctx.appUrl ? '\n🔒 秘匿HOは、Yokiの卓の「準備」で、割り当てられた本人だけが読めます: ' + ctx.appUrl : '';
  // 送るのは画面からで、送った人（editor）はいつもいる
  const content = '🎭 「' + s.name + '」の準備（' + editor + '）'
    + (lines.length ? '\n' + lines.join('\n') : '')
    + (s.sheetDue ? '\n📝 キャラシの締め切り: ' + fmtDateJa(s.sheetDue) : '') + secret;
  return { content: content.slice(0, CONTENT_MAX), embeds: [sessionEmbed(ctx, s)] };
}

/** キャラシの締め切りの催促。まだ出していないPLをメンションする */
export function sheetUrgePayload(ctx: PayloadCtx, s: Session, missing: number[]): Payload {
  const when = s.sheetDue === ctx.today ? '今日' : '明日';
  const link = ctx.appUrl ? '\n🔗 キャラシはYokiの卓の「準備」から出せます: ' + ctx.appUrl : '';
  return {
    content: '📝 「' + s.name + '」のキャラシの締め切りは' + when + '（' + fmtDateJa(s.sheetDue!) + '）です。まだ出していない人: ' + missing.map((id) => memberMention(ctx, id)).join(' ') + link,
    embeds: [sessionEmbed(ctx, s)],
  };
}
