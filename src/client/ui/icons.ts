// React の画面で使うアイコン（Google Fonts の Material Symbols Rounded）の名前。使う名前だけを読み込むので、使うときはここに足す（アルファベット順）。
// index.html の %ICON_NAMES% は、開発サーバーと組み立てのときにこの一覧に置き換わる（vite.config.ts）。<Icon name> の名前は型で確かめる
export const ICON_NAMES = [
  'add', 'arrow_back', 'arrow_forward', 'block', 'calendar_month', 'campaign', 'check', 'chevron_left', 'chevron_right', 'close',
  'dark_mode', 'date_range', 'delete', 'edit', 'edit_calendar', 'event', 'event_available', 'expand_more', 'flag', 'gavel',
  'group', 'help', 'history', 'how_to_vote', 'light_mode', 'login', 'logout', 'menu_book', 'monitor_heart', 'notifications',
  'open_in_new', 'person', 'person_add', 'play_circle', 'refresh', 'settings', 'shield', 'sticky_note_2', 'swap_horiz',
  'task_alt', 'today', 'undo', 'warning',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
