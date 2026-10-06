// 2つのフォルダのスクリーンショットを、画素で見比べる（画面を作り直したときに、見た目が変わっていないかを確かめる）。
//   npm run compare-shots -- <前のフォルダ> <後のフォルダ>
// 同じ名前のPNGを比べ、違う画素の数を出す。違いがあれば、違うところを赤く描いた画像を <後のフォルダ>/diff/ に書き、1で終わる。
// 撮るのはnpm run screenshots -- --out <フォルダ>（読み込んだ時刻など、撮るたびに変わるものは写さない）。
// サンプルの日付は今日から数えるので、前と後は同じ日に撮る
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [before, after] = process.argv.slice(2).map((d) => path.resolve(d));
if (!before || !after) {
  console.error('使い方: npm run compare-shots -- <前のフォルダ> <後のフォルダ>');
  process.exit(2);
}
const diffDir = path.join(after, 'diff');
const pngs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const read = (f) => PNG.sync.read(fs.readFileSync(f));

let bad = 0;
for (const name of new Set([...pngs(before), ...pngs(after)])) {
  const fa = path.join(before, name), fb = path.join(after, name);
  if (!fs.existsSync(fa) || !fs.existsSync(fb)) { console.log('片方だけ  ', name); bad++; continue; }
  const a = read(fa), b = read(fb);
  if (a.width !== b.width || a.height !== b.height) { console.log('大きさ違い', name, `${a.width}x${a.height} → ${b.width}x${b.height}`); bad++; continue; }
  const diff = new PNG({ width: a.width, height: a.height });
  // thresholdは色の違いをどこまで同じとみるか（文字の縁のにじみを違いに数えないくらい）
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  if (!n) { console.log('同じ      ', name); continue; }
  fs.mkdirSync(diffDir, { recursive: true });
  fs.writeFileSync(path.join(diffDir, name), PNG.sync.write(diff));
  console.log('違う      ', name, n, '画素', '(' + ((n / (a.width * a.height)) * 100).toFixed(2) + '%)');
  bad++;
}
if (bad) console.log('違いを描いた画像:', path.relative(process.cwd(), diffDir));
process.exit(bad ? 1 : 0);
