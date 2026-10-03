// 運営者の API（/api/admin/*）。運営者（OPERATOR_IDS）だけが使える。読むものは GET、変えるものは POST（JSON）。
// 変えた操作は、JSON 1 行の記録として log に出す（Cloudflare の observability で後から追える）
import { Hono } from 'hono';
import type { AdminResult } from '../../shared/admin';
import type { AppEnv } from '../app';
import { isOperator, requireOperator } from '../auth/operator';
import type { Viewer } from '../auth/session';
import { changeGuild, groupDetail, listGroups, listUsers, logoutUser, overview, setBan, setGroupAdmin } from '../domain/admin';
import type { Form } from '../domain/form';
import { str } from '../domain/form';
import { deleteGroupById } from '../domain/groups';

export const adminRoutes = new Hono<AppEnv>();

/** 運営者の操作の記録 */
function audit(op: Viewer, action: string, target: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ audit: 'operator', by: op.id, action, target, ...detail }));
}
const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => ({}))) ?? {}) as Form;
const done = (message: string): AdminResult => ({ ok: true, message });

adminRoutes.use('/api/admin/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

adminRoutes.get('/api/admin/overview', async (c) => {
  await requireOperator(c);
  return c.json(await overview(c.env.DB));
});

adminRoutes.get('/api/admin/groups', async (c) => {
  await requireOperator(c);
  return c.json(await listGroups(c.env.DB));
});

adminRoutes.get('/api/admin/groups/:id', async (c) => {
  await requireOperator(c);
  return c.json(await groupDetail(c.env.DB, c.req.param('id')));
});

adminRoutes.post('/api/admin/groups/:id/admins', async (c) => {
  const op = await requireOperator(c);
  const form = await body(c);
  const r = await setGroupAdmin(c.env.DB, c.req.param('id'), form);
  audit(op, 'setGroupAdmin', c.req.param('id'), { memberId: form.memberId ?? null, discordId: form.discordId ?? null, admin: form.admin === true });
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/groups/:id/guild', async (c) => {
  const op = await requireOperator(c);
  const form = await body(c);
  const r = await changeGuild(c.env.DB, c.req.param('id'), form);
  audit(op, 'changeGuild', c.req.param('id'), { guildId: str(form.guildId), clearWebhooks: form.clearWebhooks === true });
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/groups/:id/delete', async (c) => {
  const op = await requireOperator(c);
  const { title } = await deleteGroupById(c.env.DB, c.req.param('id'), str((await body(c)).confirm));
  audit(op, 'deleteGroup', c.req.param('id'), { title });
  return c.json(done('グループ「' + title + '」を消しました。'));
});

adminRoutes.get('/api/admin/users', async (c) => {
  await requireOperator(c);
  const url = new URL(c.req.url);
  return c.json(await listUsers(c.env.DB, (id) => isOperator(c.env, id, url)));
});

adminRoutes.post('/api/admin/users/:id/logout', async (c) => {
  const op = await requireOperator(c);
  const r = await logoutUser(c.env.DB, c.req.param('id'));
  audit(op, 'logoutUser', c.req.param('id'));
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/users/:id/ban', async (c) => {
  const op = await requireOperator(c);
  const form = await body(c);
  const url = new URL(c.req.url);
  const r = await setBan(c.env.DB, c.req.param('id'), form, (id) => isOperator(c.env, id, url));
  audit(op, form.banned === true ? 'ban' : 'unban', c.req.param('id'), { reason: str(form.reason) });
  return c.json(done(r.message));
});
