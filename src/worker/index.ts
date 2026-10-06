// Workerの入口。fetchはHonoのアプリ、scheduledは5分おきの知らせの見回り（wrangler.jsoncのtriggers.crons）。見回りの様子はmetaに残す
import { app } from './app';
import { runPatrol } from './domain/patrol';
import type { Bindings } from './env';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runPatrol(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Bindings>;
