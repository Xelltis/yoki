// 開発サーバー（vite.config.js の設定）をこの場で立て、使い終わったら止める。スクリーンショットや画像の書き出しが使う
import { createServer } from 'vite';
import { ROOT } from './gas-project.js';

/** 開発サーバーを立てて fn(サーバーの URL) を回す。終わったら（失敗しても）止める */
export async function withDevServer(fn) {
  const server = await createServer({ root: ROOT, logLevel: 'warn' });
  await server.listen();
  try {
    return await fn(server.resolvedUrls.local[0]);
  } finally {
    await server.close();
  }
}
