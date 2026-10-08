// 送り先の選び方（GAS版discordTargets_・kindBase_・sessionTargets_）。
// シリーズに専用のチャンネルがあればそこへ（「基本のチャンネルにも送る」なら基本にも）。
// 無ければ知らせの種類のチャンネル（remind: 開催前の知らせ・開始直前、recruit: 募集）、それも無ければ基本のチャンネル
import { STATUS } from '../domain/constants';
import type { Ctx, Session } from '../domain/types';

export type Kind = 'remind' | 'recruit' | '';
/** 送り先。channelIdはDiscordのチャンネルのID。labelは送信記録と画面に出す名前。threadは卓のスレッド（channelIdはスレッドのID） */
export type Target = { channelId: string; label: string; series: string; kind?: Kind; thread?: boolean };

const KIND_LABEL: Record<'remind' | 'recruit', string> = { remind: '開催前の知らせのチャンネル', recruit: '募集のチャンネル' };

export function kindBase(ctx: Pick<Ctx, 'group'>, kind: Kind): Target | null {
  const own = kind === 'remind' ? ctx.group.remind_channel_id : kind === 'recruit' ? ctx.group.recruit_channel_id : '';
  if (own && kind) return { channelId: own, label: KIND_LABEL[kind], series: '', kind };
  return ctx.group.channel_id ? { channelId: ctx.group.channel_id, label: '基本のチャンネル', series: '' } : null;
}

export function discordTargets(ctx: Pick<Ctx, 'group' | 'seriesNotify'>, series: string, kind: Kind): Target[] {
  const base = kindBase(ctx, kind);
  const sn = series ? ctx.seriesNotify[series] : undefined;
  if (sn && sn.channelId) {
    const out: Target[] = [{ channelId: sn.channelId, label: 'シリーズ「' + series + '」のチャンネル', series }];
    if (sn.alsoBase && base && base.channelId !== sn.channelId) out.push(base);
    return out;
  }
  return base ? [base] : [];
}

/** 卓の知らせの種類。状態が「募集」の卓は募集、それ以外は基本 */
export function sessionKind(s: Pick<Session, 'status'>): Kind {
  return s.status === STATUS.RECRUIT ? 'recruit' : '';
}

export function sessionTargets(ctx: Pick<Ctx, 'group' | 'seriesNotify'>, s: Session, kind?: Kind): Target[] {
  return discordTargets(ctx, s.series, kind === undefined ? sessionKind(s) : kind);
}

/** いくつかの卓の送り先を合わせる（同じチャンネルは1つに） */
export function unionTargets(lists: Target[][]): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of lists.flat()) if (!seen.has(t.channelId)) { seen.add(t.channelId); out.push(t); }
  return out;
}

/** 送信記録の「対象」に添える送り先。基本のチャンネルなら何も付けない */
export function targetNote(t: Target | undefined): string {
  return t && t.thread ? '（卓のスレッド）' : t && t.series ? '（シリーズ「' + t.series + '」のチャンネル）' : t && t.kind ? '（' + t.label + '）' : '';
}
