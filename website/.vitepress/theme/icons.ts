// サイトで使うアイコン。Material Symbols Rounded（Google。Apache License 2.0）の線の形を、unplugin-iconsが組み立てのときにSVGのVueの部品にする
// （config.ts。画像やフォントは読まない）。本文と部品からは <Ms name="…" /> か <Ui icon="…"> で使う。使う名前だけをここに足す（名前のアルファベット順。テストが確かめる）
import type { FunctionalComponent, SVGAttributes } from 'vue';
import IAdd from '~icons/material-symbols/add-outline-rounded';
import IArrowBack from '~icons/material-symbols/arrow-back-outline-rounded';
import IBlock from '~icons/material-symbols/block-outline-rounded';
import ICalendarMonth from '~icons/material-symbols/calendar-month-outline-rounded';
import ICampaign from '~icons/material-symbols/campaign-outline-rounded';
import ICheck from '~icons/material-symbols/check-outline-rounded';
import ICheckCircle from '~icons/material-symbols/check-circle-outline-rounded';
import IDateRange from '~icons/material-symbols/date-range-outline-rounded';
import IEditCalendar from '~icons/material-symbols/edit-calendar-outline-rounded';
import IEvent from '~icons/material-symbols/event-outline-rounded';
import IEventAvailable from '~icons/material-symbols/event-available-outline-rounded';
import IFlag from '~icons/material-symbols/flag-outline-rounded';
import IGroup from '~icons/material-symbols/group-outline-rounded';
import IHelp from '~icons/material-symbols/help-outline-rounded';
import IHowToVote from '~icons/material-symbols/how-to-vote-outline-rounded';
import ILink from '~icons/material-symbols/link-outline-rounded';
import ILogin from '~icons/material-symbols/login-outline-rounded';
import ILogout from '~icons/material-symbols/logout-outline-rounded';
import INotifications from '~icons/material-symbols/notifications-outline-rounded';
import IPlayCircle from '~icons/material-symbols/play-circle-outline-rounded';
import IRefresh from '~icons/material-symbols/refresh-outline-rounded';
import IRestartAlt from '~icons/material-symbols/restart-alt-outline-rounded';
import IRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';
import ISettings from '~icons/material-symbols/settings-outline-rounded';
import IShield from '~icons/material-symbols/shield-outline-rounded';
import IStickyNote2 from '~icons/material-symbols/sticky-note-2-outline-rounded';
import ITaskAlt from '~icons/material-symbols/task-alt-outline-rounded';
import ITouchApp from '~icons/material-symbols/touch-app-outline-rounded';
import IVisibility from '~icons/material-symbols/visibility-outline-rounded';
import ICheckCircleFilled from '~icons/material-symbols/check-circle-rounded';

type IconComponent = FunctionalComponent<SVGAttributes>;

export const ICONS = {
  add: IAdd,
  arrow_back: IArrowBack,
  block: IBlock,
  calendar_month: ICalendarMonth,
  campaign: ICampaign,
  check: ICheck,
  check_circle: ICheckCircle,
  date_range: IDateRange,
  edit_calendar: IEditCalendar,
  event: IEvent,
  event_available: IEventAvailable,
  flag: IFlag,
  group: IGroup,
  help: IHelp,
  how_to_vote: IHowToVote,
  link: ILink,
  login: ILogin,
  logout: ILogout,
  notifications: INotifications,
  play_circle: IPlayCircle,
  refresh: IRefresh,
  restart_alt: IRestartAlt,
  rocket_launch: IRocketLaunch,
  settings: ISettings,
  shield: IShield,
  sticky_note_2: IStickyNote2,
  task_alt: ITaskAlt,
  touch_app: ITouchApp,
  visibility: IVisibility,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICONS;

/** 塗りつぶした形（<Ms name fill />）。無い名前は線の形のまま */
export const FILLED: Partial<Record<IconName, IconComponent>> = {
  check_circle: ICheckCircleFilled,
};
