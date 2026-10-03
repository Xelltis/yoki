// 画面へ返すエラー。画面は message の頭の「AUTH:」でログインし直し、「ADMIN:」で「管理者だけ」と出し、「GONE:」でグループが無くなったと出す
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const notFound = (message: string) => new AppError(404, message);
export const authError = (message = 'ログインしてください。') => new AppError(401, 'AUTH: ' + message);
export const adminError = (what = 'この操作') => new AppError(403, 'ADMIN: ' + what + 'ができるのは管理者だけです。');
/** グループが無い（消された）。開いていた画面は控えを消して、入口へ案内する */
export const goneError = () => new AppError(404, 'GONE: このグループは見つかりません。消されたか、URL が違います。');
