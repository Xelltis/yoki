// Worker の入口。fetch は Hono のアプリ、scheduled は 5 分おきの知らせの見回り（wrangler.jsonc の triggers.crons）
import { app } from './app';
import { patrol } from './domain/patrol';
import type { Bindings } from './env';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(patrol(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Bindings>;
