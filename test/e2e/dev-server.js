// 開発サーバー（vite.config.tsの設定）をこの場で立て、使い終わったら止める。e2e（smoke.js）と、サイトのスクリーンショット（website/tools/screenshots.js）が使う
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 開発サーバーを立ててfn(サーバーのURL) を回す。終わったら（失敗しても）止める */
export async function withDevServer(fn) {
  const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });
  await server.listen();
  try {
    return await fn(server.resolvedUrls.local[0]);
  } finally {
    await server.close();
  }
}

/** 開発用ログインで、サンプルのグループに入る（pageはPlaywrightのページ） */
export async function devLogin(page, base, as = 'ひより') {
  await page.goto(base);
  await page.selectOption('#devAs', as);
  await Promise.all([page.waitForURL('**/g/sample/'), page.click('#devForm button')]);
  await page.waitForFunction('window.yoki && yoki.D && yoki.D.sessions && yoki.D.sessions.length > 0', null, { timeout: 30000 });
}
