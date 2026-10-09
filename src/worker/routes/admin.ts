// 運営者のAPI（/api/admin/*）。運営者（OPERATOR_IDS）だけが使える。読むものはGET、変えるものはPOST（JSON）。
// 変えた操作は、JSON 1行の記録としてlogに出す（Cloudflareのobservabilityで後から追える）
import { Hono } from 'hono';
import type { AdminResult } from '../../shared/admin';
import type { AppEnv } from '../app';
import { appOrigin } from '../auth/origin';
import { isOperator, parseOperatorIds, requireOperator } from '../auth/operator';
import type { Viewer } from '../auth/session';
import { changeGuild, deleteUser, groupDetail, listGroups, listUsers, logoutUser, overview, setBan, setGroupAdmin } from '../domain/admin';
import { readForm, str } from '../domain/form';
import { setCommands } from '../discord/commands';
import { setButtons } from '../discord/interactions';
import { deleteGroupById } from '../domain/groups';
import { readLegal, saveLegal } from '../domain/legal';
import { setNoticeOn, testNotice } from '../domain/operator-notice';
import { setRegistrationOpen } from '../domain/registration';
import { startUpdate, updateStatus } from '../domain/update';
import { googleDeps } from '../google/config';
import { updateDeps } from '../update/config';
import { APP_VERSION } from '../version';

export const adminRoutes = new Hono<AppEnv>();

/** 運営者の操作の記録 */
function audit(op: Viewer, action: string, target: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ audit: 'operator', by: op.id, action, target, ...detail }));
}
const done = (message: string): AdminResult => ({ ok: true, message });

adminRoutes.use('/api/admin/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

adminRoutes.get('/api/admin/overview', async (c) => {
  await requireOperator(c);
  return c.json(await overview(c.env.DB, { operators: parseOperatorIds(c.env.OPERATOR_IDS).length, botToken: !!c.env.DISCORD_BOT_TOKEN }));
});

adminRoutes.post('/api/admin/registration', async (c) => {
  const op = await requireOperator(c);
  const open = (await readForm(c.req)).open === true;
  await setRegistrationOpen(c.env.DB, open);
  audit(op, 'setRegistration', open ? 'open' : 'closed');
  return c.json(done(open ? '新規登録を受け付けます。' : '新規登録の受付を止めました。もう使っている人と運営者は、そのまま使えます。'));
});

adminRoutes.post('/api/admin/discord-buttons', async (c) => {
  const op = await requireOperator(c);
  const on = (await readForm(c.req)).on === true;
  const message = await setButtons(c.env, on, appOrigin(c.env, c.req.url));
  audit(op, 'setDiscordButtons', on ? 'on' : 'off');
  return c.json(done(message));
});

adminRoutes.post('/api/admin/operator-notice', async (c) => {
  const op = await requireOperator(c);
  const on = (await readForm(c.req)).on === true;
  const message = await setNoticeOn(c.env.DB, on);
  audit(op, 'setOperatorNotice', on ? 'on' : 'off');
  return c.json(done(message));
});

adminRoutes.post('/api/admin/operator-notice/test', async (c) => {
  const op = await requireOperator(c);
  const message = await testNotice(c.env, op.id, new Date());
  audit(op, 'testOperatorNotice', op.id);
  return c.json(done(message));
});

adminRoutes.post('/api/admin/discord-commands', async (c) => {
  const op = await requireOperator(c);
  const on = (await readForm(c.req)).on === true;
  const message = await setCommands(c.env, on, appOrigin(c.env, c.req.url));
  audit(op, 'setDiscordCommands', on ? 'on' : 'off');
  return c.json(done(message));
});

adminRoutes.get('/api/admin/legal', async (c) => {
  await requireOperator(c);
  return c.json(await readLegal(c.env.DB));
});

adminRoutes.post('/api/admin/legal', async (c) => {
  const op = await requireOperator(c);
  const form = await readForm(c.req);
  const { changed } = await saveLegal(c.env.DB, form, new Date());
  audit(op, 'setLegal', 'legal', { operator: form.operator ?? null, contact: form.contact ?? null, changed });
  return c.json(done('利用規約とプライバシーポリシーの設定を保存しました。'));
});

adminRoutes.get('/api/admin/update', async (c) => {
  await requireOperator(c);
  return c.json(await updateStatus(c.env.DB, updateDeps(c.env), new Date(), c.req.query('refresh') === '1'));
});

adminRoutes.post('/api/admin/update', async (c) => {
  const op = await requireOperator(c);
  const version = await startUpdate(c.env.DB, updateDeps(c.env));
  audit(op, 'update', 'v' + version, { from: 'v' + APP_VERSION });
  return c.json(done('v' + version + 'への更新を始めました。GitHubのActionsが取り込んで公開します（数分かかります）。'));
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
  const form = await readForm(c.req);
  const r = await setGroupAdmin(c.env.DB, c.req.param('id'), form);
  audit(op, 'setGroupAdmin', c.req.param('id'), { memberId: form.memberId ?? null, discordId: form.discordId ?? null, admin: form.admin === true });
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/groups/:id/guild', async (c) => {
  const op = await requireOperator(c);
  const form = await readForm(c.req);
  const r = await changeGuild(c.env.DB, c.req.param('id'), form);
  audit(op, 'changeGuild', c.req.param('id'), { guildId: str(form.guildId) });
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/groups/:id/delete', async (c) => {
  const op = await requireOperator(c);
  const { title } = await deleteGroupById(c.env.DB, c.req.param('id'), str((await readForm(c.req)).confirm));
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

adminRoutes.post('/api/admin/users/:id/delete', async (c) => {
  const op = await requireOperator(c);
  const url = new URL(c.req.url);
  const r = await deleteUser(c.env.DB, c.req.param('id'), (id) => isOperator(c.env, id, url), await googleDeps(c.env, appOrigin(c.env, c.req.url)));
  audit(op, 'deleteUser', c.req.param('id'));
  return c.json(done(r.message));
});

adminRoutes.post('/api/admin/users/:id/ban', async (c) => {
  const op = await requireOperator(c);
  const form = await readForm(c.req);
  const url = new URL(c.req.url);
  const r = await setBan(c.env.DB, c.req.param('id'), form, (id) => isOperator(c.env, id, url));
  audit(op, form.banned === true ? 'ban' : 'unban', c.req.param('id'), { reason: str(form.reason) });
  return c.json(done(r.message));
});
