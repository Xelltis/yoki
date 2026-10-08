// 知らせに付けるボタンと選ぶ欄（Discordのmessage components）。押されたときの処理は interactions.ts
import { STATUS } from '../domain/constants';
import type { Ctx, Session } from '../domain/types';
import { fmtDateJa } from '../lib/jst';

/** metaの鍵。'1' なら知らせにボタンを付ける（運営者が運営の管理画面で入れる） */
export const BUTTONS_KEY = 'discord_buttons';

/** ボタンの操作。fill 予定表から答える・any どの日でもいい・days 行ける日を選ぶ（日程調整）、want 参加希望・interest 興味あり・none 取り消す（募集） */
export type ButtonAction = 'fill' | 'any' | 'days' | 'want' | 'interest' | 'none';
const ACTIONS: ButtonAction[] = ['fill', 'any', 'days', 'want', 'interest', 'none'];

/** ボタンのID（custom_id。100文字まで）。'yoki:グループ:卓の番号:操作' */
export function customId(groupId: string, seq: number, action: ButtonAction): string {
  return 'yoki:' + groupId + ':' + seq + ':' + action;
}

export function parseCustomId(v: unknown): { groupId: string; seq: number; action: ButtonAction } | null {
  const m = /^yoki:([A-Za-z0-9_-]{1,40}):(\d{1,9}):([a-z]+)$/.exec(String(v ?? ''));
  return m && (ACTIONS as string[]).includes(m[3]!) ? { groupId: m[1]!, seq: Number(m[2]), action: m[3] as ButtonAction } : null;
}

type Button = { type: 2; style: 1 | 2 | 5; label: string; custom_id?: string; url?: string };
type Select = { type: 3; custom_id: string; placeholder: string; min_values: number; max_values: number; options: { label: string; value: string }[] };
/** ボタンの行（1行に5つまで、1通に5行まで） */
export type Component = { type: 1; components: (Button | Select)[] };

type ButtonCtx = Pick<Ctx, 'group' | 'appUrl' | 'today'> & { buttons?: boolean };

const button = (label: string, id: string, primary = false): Button => ({ type: 2, style: primary ? 1 : 2, label, custom_id: id });
const link = (label: string, url: string): Button[] => (url ? [{ type: 2, style: 5, label, url }] : []);

/** 日程調整の知らせ: 予定表から答える・どの日でもいい・Yokiで答えると、行ける日を選ぶ欄（選ばなかった日は ×）。これからの候補日が無ければ付けない */
export function pollComponents(ctx: ButtonCtx, s: Session): Component[] | undefined {
  const future = s.candidates.filter((k) => k >= ctx.today);
  if (!ctx.buttons || !future.length) return undefined;
  const id = (a: ButtonAction) => customId(ctx.group.id, s.seq, a);
  return [
    { type: 1, components: [button('予定表から答える', id('fill'), true), button('どの日でもいい', id('any')), ...link('Yokiで答える', ctx.appUrl)] },
    {
      type: 1,
      components: [{
        type: 3, custom_id: id('days'), placeholder: '行ける日を選ぶ（選ばなかった日は ×）', min_values: 0, max_values: future.length,
        options: future.map((k) => ({ label: fmtDateJa(k), value: k })),
      }],
    },
  ];
}

/** 募集の知らせ: 参加希望・興味あり・取り消す・Yokiで見る。募集中の卓だけ */
export function recruitComponents(ctx: ButtonCtx, s: Session): Component[] | undefined {
  if (!ctx.buttons || s.status !== STATUS.RECRUIT) return undefined;
  const id = (a: ButtonAction) => customId(ctx.group.id, s.seq, a);
  return [{ type: 1, components: [button('参加希望', id('want'), true), button('興味あり', id('interest')), button('取り消す', id('none')), ...link('Yokiで見る', ctx.appUrl)] }];
}
