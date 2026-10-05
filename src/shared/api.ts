// 画面とサーバーの約束（POST /api/g/:groupId/:fn）。画面（src/client）とサーバー（src/worker）の両方から読む。
// ブラウザの型も Workers の型も使わない（どちらからも読めるように）

/**
 * 卓の状態。募集 → 調整中 → 開催 → 終了 と進み、中止は別。
 *   募集   … 参加者を集めている。開催日の代わりに、開きたい期間を持つ。参加希望・興味ありを付けられる
 *   調整中 … 参加者は決まり、開催日を選んでいる。候補の期間を持つ。募集のときの参加希望の人は、このときに参加者へ移る
 *   開催   … 開催日が決まった
 *   終了   … 開催日が過ぎた（自動で変わる）
 */
export const STATUS = { RECRUIT: '募集', ADJUSTING: '調整中', HELD: '開催', DONE: '終了', CANCELED: '中止' } as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

/** 画面から呼べる関数の名前。getConsoleData は画面のデータを読む。ほかはサーバーの routes/rpc.ts の一覧と同じ */
export const RPC_FUNCS = [
  'getConsoleData', 'sendDiscordStep', 'setDayNote', 'setInterest', 'bulkUpdateSessions', 'setAvailability', 'setAvailabilityBulk', 'setAvailNote',
  'saveSession', 'deleteSession', 'saveMember', 'deleteMember', 'saveConsoleSettings', 'saveSeriesNotify', 'renameGroup', 'startPoll', 'setPollVote',
  'setPollVoteAll', 'cancelPoll', 'decidePoll', 'setAdmin', 'deleteGroup', 'getDiscordChannels', 'saveCalendarFeed', 'deleteCalendarFeed',
  'saveGoogleSettings', 'syncGoogleNow', 'unlinkGoogle', 'unlinkGoogleLogin',
] as const;
export type RpcName = (typeof RPC_FUNCS)[number];

/** 画面のデータの卓 */
export type ConsoleSession = {
  /** S001 の形 */
  id: string;
  name: string;
  gm: string;
  members: string[];
  /** 開催日（YYYY-MM-DD）。募集・調整中は空 */
  date: string;
  start: string;
  end: string;
  status: Status;
  place: string;
  memo: string;
  /** 開催前の知らせを送った日時（2026/09/15（火） 21:23 の形）。送っていなければ空 */
  notified: string;
  editor: string;
  want: string[];
  interest: string[];
  /** 興味ありの人に聞いた日時 */
  asked: string;
  series: string;
  seriesEnd: string;
  /** 期間（募集の開きたい期間・調整中の候補の期間）。2026/10/03〜2026/10/17 の形 */
  window: string;
  windowFrom: string;
  windowTo: string;
  /** 10/3（金）〜10/17（金） の形 */
  windowLabel: string;
  windowKey: string;
  /** 日程調整の候補日 */
  candidates: string[];
  /** 日程調整の回答 { 'YYYY-MM-DD': { 名前: '◯' | '×' } } */
  votes: Record<string, Record<string, string>>;
};

export type ConsoleMember = {
  name: string;
  discordId: string;
  note: string;
  hasDiscord: boolean;
  /** Discord のユーザー ID が 17〜20 桁の数字か（空も可） */
  idOk: boolean;
  /** Discord でログインしたことがある */
  linked: boolean;
  admin: boolean;
};

/** シリーズごとの知らせ。channelId が空なら、基本のチャンネルへ送る */
export type SeriesNotifyView = { series: string; channelId: string; alsoBase: boolean; days: number | null; hour: number | null };

/** 画面のデータ（getConsoleData の返事。書き込みの返事の data にも付く） */
export type ConsoleData = {
  title: string;
  /** ログインした本人 */
  me: { name: string; isAdmin: boolean };
  group: { id: string; guildName: string };
  isAdmin: boolean;
  admins: string[];
  appUrl: string;
  /** 今日（日本時間、YYYY-MM-DD） */
  today: string;
  loadedAt: string;
  members: ConsoleMember[];
  statuses: Status[];
  sessions: ConsoleSession[];
  /** メンバーの予定 { 'YYYY-MM-DD': { 名前: '△' | '×' } } */
  avail: Record<string, Record<string, string>>;
  /** 日付のメモ */
  notes: Record<string, { text: string; by: string; at: string }>;
  /** 予定のメモ { 'YYYY-MM-DD': { 名前: { text, at } } } */
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  log: { at: string; kind: string; target: string; result: string }[];
  /** 卓に入っている日 { 'YYYY-MM-DD': { 名前: '参' | 'GM' } } */
  booked: Record<string, Record<string, string>>;
  /** 予定表に出す日（今日から） */
  availDays: string[];
  /** 知らせのチャンネル（Discord のチャンネルの ID）が決まっているか。基本と、種類ごと */
  channelSet: boolean;
  remindChannelSet: boolean;
  recruitChannelSet: boolean;
  /** 知らせを送る Bot。ready: サーバーに Bot のトークンがある（運営者の設定）。inviteUrl: このグループのサーバーに Bot を招く URL */
  bot: { ready: boolean; inviteUrl: string };
  notifyDefault: boolean;
  /** 開催前の知らせを有効にした人（無効なら空） */
  notifySetter: string;
  settings: {
    channelId: string;
    remindChannelId: string;
    recruitChannelId: string;
    notifyHour: number;
    notifyDays: number;
    remind: boolean;
    urge: boolean;
    soon: boolean;
    soonMinutes: number;
    notifyOnSave: boolean;
    autoFinish: boolean;
    calMonths: number;
    availDays: number;
    setter: string;
  };
  seriesNotify: SeriesNotifyView[];
  /** カレンダーとの連携（本人のぶん） */
  calendar: CalendarView;
  /** Google カレンダーの予定から入れた印 { 'YYYY-MM-DD': [名前] }（本人が入れた印と見分けるため） */
  availGoogle: Record<string, string[]>;
  /** Google でのログイン（本人のぶん）。ready は運営者が Google の値を設定しているか、email は結びつけた Google アカウント（無ければ空） */
  googleLogin: { ready: boolean; email: string };
};

/** 購読 URL に載せる卓。mine は自分が GM か参加者として入っている卓、all はグループの卓すべて */
export type FeedScope = 'mine' | 'all';

/** カレンダーとの連携の様子（本人のぶん） */
export type CalendarView = {
  /** 購読 URL（このグループ。作っていなければ null） */
  feed: { url: string; scope: FeedScope } | null;
  /** Google 連携を使えるか（運営者が Google の値を設定している） */
  googleReady: boolean;
  /** Google 連携（していなければ null）。write: 卓を書き込む、read: 予定から印を入れる、from / to: 印を決める時間帯 */
  google: { email: string; write: boolean; read: boolean; from: string; to: string; syncedAt: string; busyAt: string; error: string } | null;
};

/** 送り先に選べる Discord のチャンネル（getDiscordChannels の返事）。category はカテゴリーの名前（無ければ空） */
export type DiscordChannel = { id: string; name: string; category: string };
export type DiscordChannelsResult = { ok: true; botReady: boolean; inGuild: boolean; channels: DiscordChannel[] };

/** 呼び出しの返事（書き込み）。message は画面の吹き出しに出す。ほかは呼び出しごとに付く */
export type RpcResult = {
  ok?: boolean;
  message: string;
  /** 最新の画面データ（付いていれば、画面は読み直さずに済む） */
  data?: ConsoleData;
  id?: string;
  ids?: string[];
  names?: string[];
  name?: string;
  label?: string;
  /** 日程調整の回答がそろった */
  ready?: boolean;
  /** サーバーが Discord に送れたか（false なら画面から送り直す） */
  notified?: boolean;
};

/** 届かなかった理由 */
export type DiscordReason = { kind: string; label: string; toolFault: boolean; text: string; advice: string };

/** Discord に 1 回送った返事（sendDiscordStep） */
export type DiscordStepResult = {
  ok: boolean;
  code: number;
  retryable: boolean;
  waitMs: number;
  result: string;
  raw: string;
  reason: DiscordReason | null;
  attempt: number;
  maxTries: number;
  /** 送り先の何番目か（0 から）と、送り先の数・名前 */
  to: number;
  targetCount: number;
  targetLabel: string;
  asked?: string;
  notified?: boolean;
  data?: ConsoleData;
};

/** 入口の画面が読む返事（GET /api/me） */
export type MeResponse = {
  /** Discord でログインできるか（Discord アプリの値が入っている） */
  discord: boolean;
  /** 開発用ログイン（開発サーバーで、手元から開いたときだけ） */
  dev: { users: string[] } | null;
  /** 新規登録を受け付けているか（止めていると、新しいグループの作成と初めての人のログインを断る。運営者は別） */
  registration: boolean;
  /** Google でもログインできるか（運営者が Google の値を設定している。初めてのときは Discord と結びつける） */
  google: boolean;
} & (
  | { loggedIn: false }
  | {
      loggedIn: true;
      user: { id: string; name: string; avatar: string | null };
      /** 運営者（/admin/ の管理画面に入れる） */
      operator: boolean;
      /** 入れるグループ */
      groups: { id: string; title: string; guildName: string; guildIcon: string | null }[];
      /** グループを作れる Discord サーバー（管理できるサーバー） */
      creatable: { guildId: string; name: string; icon: string | null }[];
      /** 入っているサーバーの控えが古い（読み直しを勧める） */
      stale: boolean;
    }
);

/** グループを作った返事（POST /api/groups）。失敗なら { error } */
export type CreateGroupResult = { ok: true; id: string; url: string };
