// Vite のプラグイン: 入口の HTML を、組み立てたページに差し替える。
//
// 入口（index.html など）は Vite に「ここにページがある」と知らせる印で、中身は開くたびに pages の関数で作り直す。
// 関数には開いた URL が渡るので、?page=tutorial のような URL の違いでページを変えられる。
// 組み立ての材料（src/ やモック）は Vite のモジュールの関係に入らないので、変わったらここで画面を再読み込みさせる
import path from 'node:path';

/**
 * pages: { 'index.html': ({ url }) => HTML の文字列 }（キーは Vite の root からのパス）
 * links: 開発サーバーを立てたときに並べて出す [名前, パス]
 * watch: 変わったら開いている画面を再読み込みするパス（root からのパス。フォルダなら中のファイルすべて）
 */
export default function gasPages({ pages, links = [], watch = [] }) {
  let root = process.cwd();
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');
  const watched = (file) => watch.some((w) => { const r = rel(file); return r === w || r.startsWith(w + '/'); });
  return {
    name: 'gas-pages',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const build = pages[rel(ctx.filename)];
        return build ? build({ url: new URL(ctx.originalUrl || ctx.path, 'http://localhost') }) : html;
      },
    },
    configureServer(server) {
      server.watcher.add(watch.map((w) => path.join(root, w)));
      server.watcher.on('change', (file) => {
        if (watched(file)) server.ws.send({ type: 'full-reload', path: '*' });
      });
      server.httpServer?.once('listening', () => setTimeout(() => {
        const base = server.resolvedUrls?.local?.[0];
        if (!base || !links.length) return;
        server.config.logger.info('\n' + links.map(([name, p]) => '  ' + name + ': ' + new URL(p, base).href).join('\n') + '\n');
      }, 0));
    },
  };
}
