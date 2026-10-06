// 動いている卓予定の版（いちばん近い版のタグvX.Y.Z）。組み立てのときにvite.config.ts（define）が入れる
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
