// 動いている卓予定の版（いちばん近い版のタグ vX.Y.Z）。組み立てのときに vite.config.ts（define）が入れる
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
