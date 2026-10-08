// 画面とサーバーの約束（POST /api/g/:groupId/:fn）。画面（src/client）とサーバー（src/worker）の両方から読む。
// ブラウザの型もWorkersの型も使わない（どちらからも読めるように）

/**
 * 卓の状態。募集 → 調整中 → 開催 → 終了 と進み、中止は別。
 *   募集   … 参加者を集めている。開催日の代わりに、開きたい期間を持つ。参加希望・興味ありを付けられる
 *   調整中 … 参加者は決まり、開催日を選んでいる。候補の期間を持つ。募集のときの参加希望の人は、このときに参加者へ移る
 *   開催   … 開催日が決まった
 *   終了   … 開催日が過ぎた（自動で変わる）
 */
export const STATUS = { RECRUIT: '募集', ADJUSTING: '調整中', HELD: '開催', DONE: '終了', CANCELED: '中止' } as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

/** 複数の開催日をまとめて登録するときの日数の上限（画面は保存の前に、サーバーは受け取るときに確かめる） */
export const SESSION_DATES_MAX = 20;

/** 日付メモを期間で書くときの、いちばん長い日数（始まりの日を含む） */
export const DAY_NOTE_SPAN_MAX = 92;

/** シナリオに書ける長さと、グループごとの数の上限（画面は入力欄に、サーバーは受け取るときに使う）。playersはPLの人数の上限 */
export const SCENARIO_MAX = { count: 200, name: 100, system: 50, hours: 20, url: 500, memo: 500, players: 20 } as const;

/** 通過の印。played は遊んだ（PL）、gm はGMをした・GMできる（中身を知っている）。どちらも、PLとしては遊べない */
export type ScenarioMark = 'played' | 'gm';

/** 画面から呼べる関数の名前。getConsoleDataは画面のデータを読む。ほかはサーバーのroutes/rpc.tsの一覧と同じ */
export const RPC_FUNCS = [
  'getConsoleData', 'sendDiscordStep', 'setDayNote', 'setInterest', 'bulkUpdateSessions', 'setAvailability', 'setAvailabilityBulk', 'setAvailNote',
  'saveSession', 'deleteSession', 'saveMember', 'deleteMember', 'saveConsoleSettings', 'saveSeriesNotify', 'renameGroup', 'startPoll', 'setPollVote',
  'setPollVoteAll', 'cancelPoll', 'decidePoll', 'setAdmin', 'deleteGroup', 'getDiscordChannels', 'saveCalendarFeed', 'deleteCalendarFeed',
  'saveGoogleSettings', 'syncGoogleNow', 'unlinkGoogle', 'unlinkGoogleLogin', 'saveScenario', 'deleteScenario', 'setScenarioMark',
  'savePrep', 'saveSlotSecret', 'assignSlots', 'setSlotHope', 'submitSheet',
] as const;
export type RpcName = (typeof RPC_FUNCS)[number];

/** 画面のデータの卓 */
export type ConsoleSession = {
  /** S001の形 */
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
  /** 開催前の知らせを送った日時（2026/09/15（火）21:23の形）。送っていなければ空 */
  notified: string;
  editor: string;
  want: string[];
  interest: string[];
  /** 興味ありの人に聞いた日時 */
  asked: string;
  series: string;
  seriesEnd: string;
  /** 期間（募集の開きたい期間・調整中の候補の期間）。2026/10/03〜2026/10/17の形 */
  window: string;
  windowFrom: string;
  windowTo: string;
  /** 10/3（金）〜10/17（金） の形 */
  windowLabel: string;
  windowKey: string;
  /** 日程調整の候補日 */
  candidates: string[];
  /** 日程調整の回答{ 'YYYY-MM-DD': { 名前: '◯' | '×' } } */
  votes: Record<string, Record<string, string>>;
  /** 遊ぶシナリオ（ConsoleScenarioのid）。無ければ空 */
  scenarioId: string;
  /** 卓の準備（HO・キャラシ） */
  prep: ConsolePrep;
};

/** 卓の準備（HOの枠と、出したキャラシ） */
export type ConsolePrep = {
  /** キャラシの締め切り（YYYY-MM-DD）。無ければ空 */
  sheetDue: string;
  /** HOの枠（posの順） */
  slots: ConsoleSlot[];
  /** 出したキャラシ{ 名前: { url, pc（キャラクターの名前）, at（出した日時） } } */
  sheets: Record<string, { url: string; pc: string; at: string }>;
};

/** HOの枠 */
export type ConsoleSlot = {
  /** 卓の中の番号（消しても詰めない） */
  pos: number;
  /** HO1・探偵 など */
  label: string;
  /** 公開HO（全員に見せる） */
  summary: string;
  /** 割り当てた人の名前（無ければ空） */
  assigned: string;
  /** 秘匿HO。その卓のGMと、割り当てた本人にだけ入る。ほかの人にはnull */
  secret: string | null;
  /** 秘匿HOがあるか（中身を見られない人にも、あることだけを出す） */
  hasSecret: boolean;
  /** 希望{ 名前: 1 | 2 }（第1・第2希望）。GM・管理者・本人の分だけ入る */
  hopes: Record<string, number>;
};

/** 卓の準備に書ける長さと数の上限（画面は入力欄に、サーバーは受け取るときに使う） */
export const PREP_MAX = { slots: 12, label: 30, summary: 500, secret: 2000, url: 500, pc: 50 } as const;

/** 画面のデータのシナリオ */
export type ConsoleScenario = {
  id: string;
  name: string;
  /** 遊ぶシステム（クトゥルフ神話TRPGなど） */
  system: string;
  /** PLの人数（GMは数えない）。決めていなければnull */
  playersMin: number | null;
  playersMax: number | null;
  /** 遊ぶ時間の目安（「4時間」など） */
  hours: string;
  url: string;
  memo: string;
  /** 登録した人の名前（メンバーでなくなっていれば空） */
  createdBy: string;
  /**
   * 本人や管理者が付けた通過の印{ 名前: 'played' | 'gm' }。「終了」の卓から出す通過は入っていないので、
   * 通過を見るときは src/shared/scenario.ts の passesOf で合わせる
   */
  marks: Record<string, ScenarioMark>;
};

export type ConsoleMember = {
  name: string;
  discordId: string;
  note: string;
  hasDiscord: boolean;
  /** DiscordのユーザーIDが17〜20桁の数字か（空も可） */
  idOk: boolean;
  /** Discordでログインしたことがある */
  linked: boolean;
  admin: boolean;
};

/** シリーズごとの知らせ。channelIdが空なら、基本のチャンネルへ送る */
export type SeriesNotifyView = { series: string; channelId: string; alsoBase: boolean; days: number | null; hour: number | null };

/** 画面のデータ（getConsoleDataの返事。書き込みの返事のdataにも付く） */
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
  /** メンバーの予定{ 'YYYY-MM-DD': { 名前: '△' | '×' } } */
  avail: Record<string, Record<string, string>>;
  /** 日付のメモ{ 始まりの日: { text, by, at, to } }。toは期間の終わり（1日だけのメモは空） */
  notes: Record<string, { text: string; by: string; at: string; to: string }>;
  /** 予定のメモ{ 'YYYY-MM-DD': { 名前: { text, at } } } */
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  log: { at: string; kind: string; target: string; result: string }[];
  /** 卓に入っている日{ 'YYYY-MM-DD': { 名前: '参' | 'GM' } } */
  booked: Record<string, Record<string, string>>;
  /** 予定表に出す日（今日から） */
  availDays: string[];
  /** 知らせのチャンネル（DiscordのチャンネルのID）が決まっているか。基本と、種類ごと */
  channelSet: boolean;
  remindChannelSet: boolean;
  recruitChannelSet: boolean;
  /**
   * 知らせを送るBot。ready: サーバーにBotのトークンがある（運営者の設定）。inviteUrl: このグループのサーバーにBotを招くURL。
   * eventsInviteUrl: 「イベントを作成」の権限も付けて招くURL（卓をDiscordのイベントに出すとき）
   */
  bot: { ready: boolean; inviteUrl: string; eventsInviteUrl: string };
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
    /** 卓をDiscordのイベントにも出す */
    discordEvents: boolean;
    /** イベントの最後の失敗（うまくいけば空） */
    eventsError: string;
  };
  seriesNotify: SeriesNotifyView[];
  /** カレンダーとの連携（本人のぶん） */
  calendar: CalendarView;
  /** Googleカレンダーの予定から入れた印{ 'YYYY-MM-DD': [名前] }（本人が入れた印と見分けるため） */
  availGoogle: Record<string, string[]>;
  /** Googleでのログイン（本人のぶん）。readyは運営者がGoogleの値を設定しているか、emailは結びつけたGoogleアカウント（無ければ空） */
  googleLogin: { ready: boolean; email: string };
  /** グループのシナリオ（名前の順） */
  scenarios: ConsoleScenario[];
};

/** 購読URLに載せる卓。mineは自分がGMか参加者として入っている卓、allはグループの卓すべて */
export type FeedScope = 'mine' | 'all';

/** カレンダーとの連携の様子（本人のぶん） */
export type CalendarView = {
  /** 購読URL（このグループ。作っていなければnull） */
  feed: { url: string; scope: FeedScope } | null;
  /** Google連携を使えるか（運営者がGoogleの値を設定している） */
  googleReady: boolean;
  /** Google連携（していなければnull）。write: 卓を書き込む、read: 予定から印を入れる、from / to: 印を決める時間帯 */
  google: { email: string; write: boolean; read: boolean; from: string; to: string; syncedAt: string; busyAt: string; error: string } | null;
};

/** 送り先に選べるDiscordのチャンネル（getDiscordChannelsの返事）。categoryはカテゴリーの名前（無ければ空） */
export type DiscordChannel = { id: string; name: string; category: string };
/** canEventsは、Botがイベントを作れるか（イベントに出すグループで、Botがサーバーにいるときだけ確かめる。ほかはnull） */
export type DiscordChannelsResult = { ok: true; botReady: boolean; inGuild: boolean; channels: DiscordChannel[]; canEvents: boolean | null };

/** 呼び出しの返事（書き込み）。messageは画面の吹き出しに出す。ほかは呼び出しごとに付く */
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
  /** サーバーがDiscordに送れたか（falseなら画面から送り直す） */
  notified?: boolean;
};

/** 届かなかった理由 */
export type DiscordReason = { kind: string; label: string; toolFault: boolean; text: string; advice: string };

/** Discordに1回送った返事（sendDiscordStep） */
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
  /** 送り先の何番目か（0から）と、送り先の数・名前 */
  to: number;
  targetCount: number;
  targetLabel: string;
  asked?: string;
  notified?: boolean;
  data?: ConsoleData;
};

/** 入口の画面が読む返事（GET /api/me） */
export type MeResponse = {
  /** Discordでログインできるか（Discordアプリの値が入っている） */
  discord: boolean;
  /** 開発用ログイン（開発サーバーで、手元から開いたときだけ） */
  dev: { users: string[] } | null;
  /** 新規登録を受け付けているか（止めていると、新しいグループの作成と初めての人のログインを断る。運営者は別） */
  registration: boolean;
  /** Googleでもログインできるか（運営者がGoogleの値を設定している。初めてのときはDiscordと結びつける） */
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
      /** グループを作れるDiscordサーバー（管理できるサーバー） */
      creatable: { guildId: string; name: string; icon: string | null }[];
      /** 入っているサーバーの控えが古い（読み直しを勧める） */
      stale: boolean;
    }
);

/** グループを作った返事（POST /api/groups）。失敗なら{ error } */
export type CreateGroupResult = { ok: true; id: string; url: string };
