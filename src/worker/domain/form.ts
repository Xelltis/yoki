// 画面から来るformの読み方と、権限の確かめ方
import { AppError } from '../lib/errors';
import type { Ctx } from './types';

export type Form = Record<string, unknown>;

/** 送られたJSONをformとして読む。壊れているか、オブジェクトでなければ（null・数・配列）空のformにする */
export async function readForm(req: { json: () => Promise<unknown> }): Promise<Form> {
  const v = await req.json().catch(() => null);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Form) : {};
}

export const str = (v: unknown) => String(v ?? '').trim();
export const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** 予定・参加希望・日程調整の回答は、本人のぶんだけ入れられる（管理者も、ほかの人の代わりには入れない）。本人の名前を返す */
export function requireSelf(ctx: Ctx, name: unknown): string {
  if (str(name) !== ctx.actor.name) throw new AppError(403, '入れられるのは自分のぶんだけです。');
  return ctx.actor.name;
}
