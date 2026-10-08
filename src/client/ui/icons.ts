// 画面で使うアイコン。Material Symbols Rounded（Google。Apache License 2.0）の線の形を、unplugin-iconsが組み立てのときにSVGのReactの部品にする
// （vite.config.ts。画像やフォントは読まない）。使う名前だけをimportするので、使うときはここに足す（名前のアルファベット順）。
// <Icon name> の名前は型で確かめる。集まりのライセンスはtools/icons.tsのALLOWED_ICON_SETS（test/client/contract.test.jsが確かめる）
import type { ComponentType, SVGProps } from 'react';
import IAdd from '~icons/material-symbols/add-outline-rounded';
import IArrowBack from '~icons/material-symbols/arrow-back-outline-rounded';
import IArrowForward from '~icons/material-symbols/arrow-forward-outline-rounded';
import IAutoStories from '~icons/material-symbols/auto-stories-outline-rounded';
import IBlock from '~icons/material-symbols/block-outline-rounded';
import ICalendarMonth from '~icons/material-symbols/calendar-month-outline-rounded';
import ICampaign from '~icons/material-symbols/campaign-outline-rounded';
import ICheck from '~icons/material-symbols/check-outline-rounded';
import IChevronLeft from '~icons/material-symbols/chevron-left-outline-rounded';
import IChevronRight from '~icons/material-symbols/chevron-right-outline-rounded';
import IClose from '~icons/material-symbols/close-outline-rounded';
import IContentCopy from '~icons/material-symbols/content-copy-outline-rounded';
import IDarkMode from '~icons/material-symbols/dark-mode-outline-rounded';
import IDateRange from '~icons/material-symbols/date-range-outline-rounded';
import IDelete from '~icons/material-symbols/delete-outline-rounded';
import IDevices from '~icons/material-symbols/devices-outline-rounded';
import IEdit from '~icons/material-symbols/edit-outline-rounded';
import IEditCalendar from '~icons/material-symbols/edit-calendar-outline-rounded';
import IEvent from '~icons/material-symbols/event-outline-rounded';
import IEventAvailable from '~icons/material-symbols/event-available-outline-rounded';
import IExpandMore from '~icons/material-symbols/expand-more-rounded';
import IFlag from '~icons/material-symbols/flag-outline-rounded';
import IGavel from '~icons/material-symbols/gavel-outline-rounded';
import IGroup from '~icons/material-symbols/group-outline-rounded';
import IHelp from '~icons/material-symbols/help-outline-rounded';
import IHistory from '~icons/material-symbols/history-outline-rounded';
import IHowToVote from '~icons/material-symbols/how-to-vote-outline-rounded';
import ILightMode from '~icons/material-symbols/light-mode-outline-rounded';
import ILink from '~icons/material-symbols/link-outline-rounded';
import ILinkOff from '~icons/material-symbols/link-off-outline-rounded';
import ILogin from '~icons/material-symbols/login-outline-rounded';
import ILogout from '~icons/material-symbols/logout-outline-rounded';
import IMenuBook from '~icons/material-symbols/menu-book-outline-rounded';
import IMonitorHeart from '~icons/material-symbols/monitor-heart-outline-rounded';
import INotifications from '~icons/material-symbols/notifications-outline-rounded';
import IOpenInNew from '~icons/material-symbols/open-in-new-outline-rounded';
import IPerson from '~icons/material-symbols/person-outline-rounded';
import IPersonAdd from '~icons/material-symbols/person-add-outline-rounded';
import IPlayCircle from '~icons/material-symbols/play-circle-outline-rounded';
import IRefresh from '~icons/material-symbols/refresh-outline-rounded';
import ISettings from '~icons/material-symbols/settings-outline-rounded';
import IShield from '~icons/material-symbols/shield-outline-rounded';
import IStickyNote2 from '~icons/material-symbols/sticky-note-2-outline-rounded';
import ISwapHoriz from '~icons/material-symbols/swap-horiz-outline-rounded';
import ISync from '~icons/material-symbols/sync-outline-rounded';
import ITaskAlt from '~icons/material-symbols/task-alt-outline-rounded';
import IToday from '~icons/material-symbols/today-outline-rounded';
import IUndo from '~icons/material-symbols/undo-outline-rounded';
import IUpgrade from '~icons/material-symbols/upgrade-outline-rounded';
import IWarning from '~icons/material-symbols/warning-outline-rounded';
import IAutoStoriesFilled from '~icons/material-symbols/auto-stories-rounded';
import ICalendarMonthFilled from '~icons/material-symbols/calendar-month-rounded';
import ICampaignFilled from '~icons/material-symbols/campaign-rounded';
import IEventAvailableFilled from '~icons/material-symbols/event-available-rounded';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const ICONS = {
  add: IAdd,
  arrow_back: IArrowBack,
  arrow_forward: IArrowForward,
  auto_stories: IAutoStories,
  block: IBlock,
  calendar_month: ICalendarMonth,
  campaign: ICampaign,
  check: ICheck,
  chevron_left: IChevronLeft,
  chevron_right: IChevronRight,
  close: IClose,
  content_copy: IContentCopy,
  dark_mode: IDarkMode,
  date_range: IDateRange,
  delete: IDelete,
  devices: IDevices,
  edit: IEdit,
  edit_calendar: IEditCalendar,
  event: IEvent,
  event_available: IEventAvailable,
  expand_more: IExpandMore,
  flag: IFlag,
  gavel: IGavel,
  group: IGroup,
  help: IHelp,
  history: IHistory,
  how_to_vote: IHowToVote,
  light_mode: ILightMode,
  link: ILink,
  link_off: ILinkOff,
  login: ILogin,
  logout: ILogout,
  menu_book: IMenuBook,
  monitor_heart: IMonitorHeart,
  notifications: INotifications,
  open_in_new: IOpenInNew,
  person: IPerson,
  person_add: IPersonAdd,
  play_circle: IPlayCircle,
  refresh: IRefresh,
  settings: ISettings,
  shield: IShield,
  sticky_note_2: IStickyNote2,
  swap_horiz: ISwapHoriz,
  sync: ISync,
  task_alt: ITaskAlt,
  today: IToday,
  undo: IUndo,
  upgrade: IUpgrade,
  warning: IWarning,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICONS;

/** 塗りつぶした形（いま開いているタブなど、押してあることを示すとき）。無い名前は線の形のまま */
export const FILLED: Partial<Record<IconName, IconComponent>> = {
  auto_stories: IAutoStoriesFilled,
  calendar_month: ICalendarMonthFilled,
  campaign: ICampaignFilled,
  event_available: IEventAvailableFilled,
};
