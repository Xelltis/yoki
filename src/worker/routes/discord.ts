// Discordのボタンとスラッシュコマンド（Interactions）の受け口。DiscordがここへPOSTする（Discordアプリの「Interactions Endpoint URL」）。
// 署名を確かめてから受ける。確かめの要求（PING）には、そのまま返す。ボタンとコマンドには、3秒以内に「考え中」（本人にだけ見える）を返し、
// 書き込みや読み込みは返事のあと（waitUntil）で行って、返事を書き直す
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { appOrigin } from '../auth/origin';
import { realSleep } from '../discord/send';
import { type CommandInteraction, handleCommand } from '../discord/commands';
import { buttonsState, type ComponentInteraction, editReply, handleComponent, INTERACTIONS_PATH, verifySignature } from '../discord/interactions';

export const discordRoutes = new Hono<AppEnv>();

/** 返事の種類（Discordの決まり）。PONGは確かめへの返事、DEFERREDは「考え中」（あとで書き直す）、MESSAGEはすぐに返す文 */
const PONG = 1, MESSAGE = 4, DEFERRED = 5;
/** 本人にだけ見える返事 */
const EPHEMERAL = 64;

discordRoutes.post(INTERACTIONS_PATH, async (c) => {
  const body = await c.req.text();
  const { on, commands, verifyKey } = await buttonsState(c.env.DB);
  const ok = !!verifyKey && (await verifySignature(verifyKey, c.req.header('X-Signature-Ed25519') ?? '', c.req.header('X-Signature-Timestamp') ?? '', body));
  if (!ok) return c.text('invalid request signature', 401);
  const base = appOrigin(c.env, c.req.url);
  const it = JSON.parse(body) as ComponentInteraction & CommandInteraction & { type: number };
  if (it.type === 1) return c.json({ type: PONG });
  // 3はボタンと選ぶ欄、2はスラッシュコマンド。止めているものには、そう返す
  const work = it.type === 3 && on ? () => handleComponent(c.env, it, base, new Date(), realSleep)
    : it.type === 2 && commands ? () => handleCommand(c.env, it, base, new Date())
      : null;
  if (!work) return c.json({ type: MESSAGE, data: { content: 'いまはDiscordから操作できません。Yokiの画面から操作してください。', flags: EPHEMERAL } });
  c.executionCtx.waitUntil(
    work()
      .catch((e: unknown) => { console.error(e); return 'うまくいきませんでした。Yokiの画面から操作してください。'; })
      .then((content) => editReply(it, content)),
  );
  return c.json({ type: DEFERRED, data: { flags: EPHEMERAL } });
});
