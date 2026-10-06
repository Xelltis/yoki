// アプリとサイトのアイコン（ファビコン・ホーム画面のアイコン・上の帯のロゴ）を、元の絵brand/yoki.pngから書き出す。
//   npm run icons
// 元の絵を変えたら回して、出したファイルをコミットする。縮めるのはブラウザ（Playwrightのchromium）のcanvas。
// 出すもの
//   favicon.ico             16・32・48px（透明）                      アプリ・サイト
//   icon-192.png            ホーム画面と上の帯のロゴ（透明）          アプリ・サイト
//   icon-512.png            manifest（透明）                          アプリ
//   icon-maskable-512.png   Androidのアイコン（青で塗り、形を切り抜かれても欠けないように絵を小さく置く）  アプリ
//   apple-touch-icon.png    iPhoneのホーム画面（180px、青で塗る。角はiPhoneが丸める）  アプリ・サイト
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const master = path.join(root, 'brand/yoki.png');
const APP = path.join(root, 'src/client/public');
const SITE = path.join(root, 'website/public');
/** 塗りの青（元の絵の地の色） */
const BLUE = '#2D2AFE';
/** maskableの絵の大きさ（全体に対して）。Androidは真ん中の80% の円の外を切ることがある */
const MASKABLE_SCALE = 0.72;

/** 出すPNG: 名前・大きさ・塗るか・絵の大きさ・置く先 */
const PNGS = [
  { name: 'icon-192.png', size: 192, to: [APP, SITE] },
  { name: 'icon-512.png', size: 512, to: [APP] },
  { name: 'icon-maskable-512.png', size: 512, fill: true, scale: MASKABLE_SCALE, to: [APP] },
  { name: 'apple-touch-icon.png', size: 180, fill: true, to: [APP, SITE] },
];
const ICO_SIZES = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage();
const src = 'data:image/png;base64,' + fs.readFileSync(master).toString('base64');
const shots = await page.evaluate(async ({ src, pngs, icoSizes, blue }) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  // 透明な外側を除いた範囲を、正方形にそろえて切り出す
  const full = canvas(img.width, img.height);
  const fx = full.getContext('2d');
  fx.drawImage(img, 0, 0);
  const a = fx.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (a[(y * img.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
  }
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const sq = canvas(side, side);
  sq.getContext('2d').drawImage(full, x0, y0, x1 - x0 + 1, y1 - y0 + 1, (side - (x1 - x0 + 1)) / 2, (side - (y1 - y0 + 1)) / 2, x1 - x0 + 1, y1 - y0 + 1);
  // 半分ずつ縮めて、ぼけと荒れを抑える
  const shrink = (from, size) => {
    let cur = from;
    while (cur.width / 2 >= size) {
      const next = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
      const nx = next.getContext('2d');
      nx.imageSmoothingQuality = 'high';
      nx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }
    const out = canvas(size, size);
    const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(cur, 0, 0, size, size);
    return out;
  };
  const render = ({ size, fill, scale = 1 }) => {
    const out = canvas(size, size);
    const ox = out.getContext('2d');
    if (fill) { ox.fillStyle = blue; ox.fillRect(0, 0, size, size); }
    const s = Math.round(size * scale);
    ox.drawImage(shrink(sq, s), (size - s) / 2, (size - s) / 2);
    return out.toDataURL('image/png').split(',')[1];
  };
  return {
    pngs: pngs.map((p) => render(p)),
    ico: icoSizes.map((size) => render({ size })),
    box: [x0, y0, x1, y1],
  };
}, { src, pngs: PNGS.map(({ size, fill, scale }) => ({ size, fill, scale })), icoSizes: ICO_SIZES, blue: BLUE });
await browser.close();

/** PNGを詰めたICO（Windowsのアイコン）。頭6バイト、1枚ごとに16バイト、そのあとにPNGを並べる */
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

const write = (dir, name, buf) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  console.log(path.relative(root, file), Math.round(buf.length / 102.4) / 10, 'KB');
};
PNGS.forEach((p, i) => { for (const dir of p.to) write(dir, p.name, Buffer.from(shots.pngs[i], 'base64')); });
const favicon = ico(ICO_SIZES.map((size, i) => ({ size, png: Buffer.from(shots.ico[i], 'base64') })));
for (const dir of [APP, SITE]) write(dir, 'favicon.ico', favicon);
console.log('絵の範囲（元の画像の中）:', shots.box.join(', '));
