// 動いているYokiの版（package.jsonのversion）。組み立てのときにvite.config.ts（define）が入れる
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
