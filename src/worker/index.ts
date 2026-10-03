// Worker の入口。fetch は Hono のアプリ、scheduled は 5 分おきの知らせの見回り（wrangler.jsonc の triggers.crons）。見回りの様子は meta に残す
import { app } from './app';
import { runPatrol } from './domain/patrol';
import type { Bindings } from './env';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runPatrol(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Bindings>;
