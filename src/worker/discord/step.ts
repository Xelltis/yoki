// 画面からDiscordへ1回だけ送る（GAS版sendDiscordStep）。待ちと送り直しは画面が回す。
// form: { kind, attempt, to（送り先の番号）, id, verb, name, series, status, names, ids, label, channel, message }
// 送り先が2か所あるとき（シリーズのチャンネルと基本のチャンネル）は、画面がtoを0, 1と進めて1か所ずつ送る
import { ASK_MESSAGE_MAX, DATED, STATUS } from '../domain/constants';
import { type Form, list, str } from '../domain/form';
import { findSession } from '../domain/model';
import { notifyYmdOf } from '../domain/notify';
import type { Ctx, Session } from '../domain/types';
import { adminError, badRequest } from '../lib/errors';
import { stampText } from '../lib/jst';
import { isGmOf } from '../domain/prep';
import { announcePayload, askPayload, bulkPayload, changePayload, mentionsOf, type Payload, pollPayload, pollReadyPayload, prepPayload, decidedPayload, testPayload } from './payloads';
import { discordAttempt } from './send';
import { discordTargets, type Kind, kindBase, sessionTargets, type Target, targetNote, unionTargets } from './targets';

/** 画面から受け取った文（消した卓の名前・まとめての見出し）。1行にして長さを切り、@ のあとに見えない文字をはさんでメンションにしない */
export function plainText(s: string, max = 100): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max).replace(/@/g, '@\u200b');
}

/** まとめての知らせに載せる卓の数 */
const BULK_NAMES_MAX = 50;

export async function sendDiscordStep(ctx: Ctx, form: Form, io: { data: () => Promise<unknown> }) {
  const me = ctx.actor.name;
  const kind = str(form.kind);
  let payload: Payload;
  let label: string;
  let target: string;
  let s: Session | null = null;
  let targets: Target[];
  const need = (check: (x: Session) => string | null) => {
    s = findSession(ctx, form.id);
    const why = check(s);
    if (why) throw badRequest(why);
    return s;
  };
  const series = str(form.series);
  const channel = str(form.channel);

  switch (kind) {
    case 'test': {
      label = '接続テスト';
      target = '-';
      if (series) {
        // シリーズを指定したときは、そのシリーズのチャンネルだけ
        const sn = ctx.seriesNotify[series];
        if (!sn || !sn.channelId) throw badRequest('シリーズ「' + series + '」には専用のチャンネルがありません。');
        targets = [{ channelId: sn.channelId, label: 'シリーズ「' + series + '」のチャンネル', series }];
        payload = testPayload(ctx.group.title, 'シリーズ「' + series + '」');
      } else if (channel === 'remind' || channel === 'recruit') {
        const t = kindBase(ctx, channel);
        if (!t || t.kind !== channel) throw badRequest((channel === 'remind' ? '開催前の知らせのチャンネル' : '募集のチャンネル') + 'が決まっていません。');
        targets = [t];
        payload = testPayload(ctx.group.title, t.label);
      } else {
        targets = discordTargets(ctx, '', '');
        payload = testPayload(ctx.group.title);
      }
      break;
    }
    case 'change': {
      const x = need(() => null);
      const verb = str(form.verb) === '変更' ? '変更' : '登録';
      payload = changePayload(ctx, x, verb, me);
      label = verb + '通知';
      target = x.name;
      targets = sessionTargets(ctx, x);
      break;
    }
    case 'delete': {
      // 卓を消せるのは管理者だけ。消した卓はもう無いので、名前は画面から受け取る（メンションにならない形にする）
      if (!ctx.actor.isAdmin) throw adminError('卓の削除の知らせ');
      const nm = plainText(str(form.name));
      if (!nm) throw badRequest('消した卓の名前がありません。');
      payload = changePayload(ctx, { name: nm } as Session, '削除', me);
      label = '削除通知';
      target = nm;
      targets = discordTargets(ctx, series, str(form.status) === STATUS.RECRUIT ? 'recruit' : '');
      break;
    }
    case 'announce': {
      const x = need(() => null);
      payload = announcePayload(ctx, x, me);
      label = '案内';
      target = x.name;
      targets = sessionTargets(ctx, x);
      break;
    }
    case 'ask': {
      const message = str(form.message);
      const x = need((y) =>
        y.status !== STATUS.RECRUIT ? '「' + y.name + '」は募集中ではありません（' + y.status + '）。'
        : !y.interest.length ? '「' + y.name + '」に興味ありの人がいません。'
        : message.length > ASK_MESSAGE_MAX ? '添える一言は' + ASK_MESSAGE_MAX + '文字までです。'
        : null);
      payload = askPayload(ctx, x, me, message);
      label = '参加確認';
      target = x.name;
      targets = sessionTargets(ctx, x, 'recruit');
      break;
    }
    case 'poll':
    case 'pollReady': {
      const x = need((y) => (y.status !== STATUS.ADJUSTING || !y.candidates.length ? '「' + y.name + '」は日程調整をしていません。' : null));
      payload = kind === 'poll' ? pollPayload(ctx, x, me) : pollReadyPayload(ctx, x);
      label = kind === 'poll' ? '日程調整' : '回答そろい';
      target = x.name;
      targets = sessionTargets(ctx, x);
      break;
    }
    case 'prep': {
      // 準備の知らせ（HOの割り当てとキャラシの締め切り）。秘匿HOは載せない。送れるのはGMと管理者
      const x = need((y) => (!y.slots.length && !y.sheetDue ? '「' + y.name + '」には、HOもキャラシの締め切りもありません。' : null));
      if (!isGmOf(ctx, x) && !ctx.actor.isAdmin) throw adminError('GMのほかが準備の知らせを送ること');
      payload = prepPayload(ctx, x, me);
      label = '準備の知らせ';
      target = x.name;
      targets = sessionTargets(ctx, x);
      break;
    }
    case 'decided': {
      const x = need((y) => (!y.date ? '「' + y.name + '」の開催日がまだ決まっていません。' : null));
      payload = decidedPayload(ctx, x);
      label = '日程決定';
      target = x.name;
      targets = sessionTargets(ctx, x);
      break;
    }
    case 'bulk': {
      const ids = list(form.ids);
      const picked = ctx.sessions.filter((x) => ids.includes(x.id));
      // 管理者でない人が送れるのは、複数日をまとめて登録したときだけ。名前は画面から受け取らず、卓から引く。
      // 管理者は「卓をまとめて変える」（消した卓を含む）からも送るので、画面の名前と見出しを使う（メンションにならない形にする）
      const admin = ctx.actor.isAdmin;
      const names = (admin ? list(form.names).map((n) => plainText(n)).filter(Boolean) : picked.map((x) => x.name)).slice(0, BULK_NAMES_MAX);
      if (!names.length) throw badRequest('対象の卓がありません。');
      const what = admin ? plainText(str(form.label), 60) || '変更' : '登録';
      // 複数日をまとめて登録したときは、その回のGMと参加者をメンションする
      const mentions = what === '登録' && picked.length ? mentionsOf(ctx, picked) : '';
      payload = bulkPayload(what, me, names, mentions);
      label = '一括変更';
      target = names.join('、');
      // 送り先は、対象の卓それぞれの送り先を合わせたもの（卓が分からなければ、シリーズか基本のチャンネル）
      targets = picked.length ? unionTargets(picked.map((x) => sessionTargets(ctx, x))) : discordTargets(ctx, series, '' as Kind);
      break;
    }
    default:
      throw badRequest('送る種類が不正です: ' + kind);
  }
  if (!targets.length) throw badRequest('送り先のチャンネルが決まっていません。管理画面の「知らせ」でチャンネルを選んでから送ってください。');
  const to = Math.min(Math.max(Math.trunc(Number(form.to)) || 0, 0), targets.length - 1);
  const t = targets[to]!;
  const r = await discordAttempt({ db: ctx.db, groupId: ctx.group.id, token: ctx.bot.token }, payload, label, target + targetNote(t), Number(form.attempt) || 1, t.channelId);
  const out: Record<string, unknown> = { ...r, to, targetCount: targets.length, targetLabel: t.label };
  const sent = s as Session | null;
  if (r.ok && kind === 'ask' && sent) {
    // 送った日時を卓に控える。カードに「確認文を送りました」と出す
    await ctx.db.prepare('UPDATE sessions SET asked_at = ? WHERE id = ?').bind(ctx.now.toISOString(), sent.rowId).run();
    out.asked = stampText(ctx.now.toISOString());
    out.data = await io.data();
  }
  if (r.ok && kind === 'announce' && sent && DATED.includes(sent.status) && notifyYmdOf(ctx, sent) === ctx.today) {
    // 今日が開催前の知らせの日なら、案内を開催前の知らせの代わりにする
    await ctx.db.prepare('UPDATE sessions SET notified_at = ? WHERE id = ?').bind(ctx.now.toISOString(), sent.rowId).run();
    out.notified = true;
    out.data = await io.data();
  }
  return out;
}
