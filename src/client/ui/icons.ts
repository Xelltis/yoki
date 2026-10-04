// React の画面で使うアイコン（Google Fonts の Material Symbols Rounded）の名前。使う名前だけを読み込むので、使うときはここに足す（アルファベット順）。
// index.html の %ICON_NAMES% は、開発サーバーと組み立てのときにこの一覧に置き換わる（vite.config.ts）。<Icon name> の名前は型で確かめる
export const ICON_NAMES = ['add', 'arrow_forward', 'group', 'login', 'logout', 'menu_book', 'refresh', 'shield'] as const;

export type IconName = (typeof ICON_NAMES)[number];
