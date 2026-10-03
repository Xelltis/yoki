// 画面から来る form の読み方と、権限の確かめ方
import { adminError } from '../lib/errors';
import type { Ctx } from './types';

export type Form = Record<string, unknown>;

export const str = (v: unknown) => String(v ?? '').trim();
export const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** 自分のぶんなら誰でも。ほかの人の代わりに入れるのは管理者だけ（GAS 版 requireSelfOrAdmin_） */
export function requireSelfOrAdmin(ctx: Ctx, name: unknown): void {
  if (str(name) !== ctx.actor.name && !ctx.actor.isAdmin) throw adminError('ほかの人の代わりに入れること');
}
