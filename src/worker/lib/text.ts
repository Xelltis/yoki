// 名前などの文字の扱い（GAS版Utils.jsのsplitNames_・uniq_ ほか）

/** 名前の区切りに使う文字。メンバーの名前には使えない */
export const NAME_SEPARATORS = /[、,，;；\n/／]+/;

/** 予約語（都合の対象の選択で使う） */
export const RESERVED_NAMES = ['全員', '（なし）'];

export function splitNames(v: unknown): string[] {
  return String(v ?? '')
    .split(NAME_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** http か https のアドレスか（シナリオやキャラシのURL。javascript: などを画面のリンクにしないため） */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function uniq<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/**
 * Discordの表示名から、メンバーの名前を作る。区切り文字と改行を抜き、空白をまとめ、40文字まで。
 * 予約語や空になったときはfallback（ユーザー名）を使う
 */
export function memberNameFrom(display: string | null | undefined, fallback: string): string {
  const clean = (s: string) => s.replace(new RegExp(NAME_SEPARATORS.source, 'g'), ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  for (const s of [display ?? '', fallback]) {
    const n = clean(s);
    if (n && !RESERVED_NAMES.includes(n)) return n;
  }
  return 'メンバー';
}
