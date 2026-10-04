// 画面から来る form の読み方と、権限の確かめ方
import { adminError } from '../lib/errors';
import type { Ctx } from './types';

export type Form = Record<string, unknown>;

/** 送られた JSON を form として読む。壊れているか、オブジェクトでなければ（null・数・配列）空の form にする */
export async function readForm(req: { json: () => Promise<unknown> }): Promise<Form> {
  const v = await req.json().catch(() => null);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Form) : {};
}

export const str = (v: unknown) => String(v ?? '').trim();
export const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** 自分のぶんなら誰でも。ほかの人の代わりに入れるのは管理者だけ（GAS 版 requireSelfOrAdmin_） */
export function requireSelfOrAdmin(ctx: Ctx, name: unknown): void {
  if (str(name) !== ctx.actor.name && !ctx.actor.isAdmin) throw adminError('ほかの人の代わりに入れること');
}
