// 画面とサーバーの約束（POST /api/g/:groupId/:fn）。画面（src/client）とサーバー（src/worker）の両方から読む。
// ブラウザの型もWorkersの型も使わない（どちらからも読めるように）
import type { AvailParts, BookedParts } from './parts';

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

/** 行けなくなったときの、GMへの一言の長さの上限 */
export const ABSENCE_NOTE_MAX = 200;

/** 募集の定員の上限（シナリオのPLの人数の上限と同じ） */
export const CAPACITY_MAX = 20;

/**
 * 自分あてのDMの知らせの種類と、その説明（本人が選ぶ。どのグループにも効く）。
 * 自分がGMか参加者の卓の知らせを、チャンネルに加えてBotのDMでも受け取る
 */
export const DM_KINDS = {
  remind: '自分の卓の開催前の知らせと、開始直前の知らせ',
  poll: '日程調整（締め切りの前日の催促、GMには回答がそろった・締め切りが過ぎた知らせ、日程が決まった知らせ）',
  sheet: 'キャラシの締め切りの前日の催促',
  wait: 'キャンセル待ちからの繰り上げ',
} as const;
export type DmKind = keyof typeof DM_KINDS;

/** シナリオに書ける長さと、グループごとの数の上限（画面は入力欄に、サーバーは受け取るときに使う）。playersはPLの人数の上限 */
export const SCENARIO_MAX = { count: 200, name: 100, system: 50, hours: 20, url: 500, memo: 500, players: 20 } as const;

/** 通過の印。played は遊んだ（PL）、gm はGMをした・GMできる（中身を知っている）。どちらも、PLとしては遊べない */
export type ScenarioMark = 'played' | 'gm';

/** 画面から呼べる関数の名前。getConsoleDataは画面のデータを読む。ほかはサーバーのroutes/rpc.tsの一覧と同じ */
export const RPC_FUNCS = [
  'getConsoleData', 'sendDiscordStep', 'setDayNote', 'setInterest', 'bulkUpdateSessions', 'setAvailability', 'setAvailabilityBulk', 'setAvailNote',
  'saveSession', 'deleteSession', 'saveMember', 'deleteMember', 'saveConsoleSettings', 'saveSeriesNotify', 'renameGroup', 'startPoll', 'setPollVote',
  'setPollVoteAll', 'setPollVoteFromAvail', 'cancelPoll', 'decidePoll', 'setAdmin', 'deleteGroup', 'getDiscordChannels', 'saveCalendarFeed', 'deleteCalendarFeed',
  'saveGoogleSettings', 'syncGoogleNow', 'unlinkGoogle', 'unlinkGoogleLogin', 'saveScenario', 'deleteScenario', 'setScenarioMark',
  'savePrep', 'saveSlotSecret', 'assignSlots', 'setSlotHope', 'submitSheet', 'setAbsence', 'setShareBusy', 'getSessionHistory', 'saveRecord', 'setPcRecord', 'exportGroup', 'promoteWaiter', 'setDmNotices', 'testDm',
] as const;
export type RpcName = (typeof RPC_FUNCS)[number];

/** 画面のデータの卓 */
export type ConsoleSession = {
  /** S001の形 */
  id: string;
  name: string;
  gm: string;
  /** 共同GM（サブGM・KP補佐）。GMと同じことができる（src/shared/gm.ts） */
  coGms: string[];
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
  /** 日程調整の回答{ 'YYYY-MM-DD': { 名前: '◯' | '△' | '×' } }。△ は調整すれば行ける */
  votes: Record<string, Record<string, string>>;
  /** 日程調整の回答の締め切り（YYYY-MM-DD）。決めていなければ空。過ぎても答えられる */
  pollDue: string;
  /** 遊ぶシナリオ（ConsoleScenarioのid）。無ければ空 */
  scenarioId: string;
  /** 卓の準備（HO・キャラシ） */
  prep: ConsolePrep;
  /** 募集の定員（参加希望を受ける人数。GMは数えない）。決めていなければ0 */
  capacity: number;
  /** 募集の締め切り（参加希望・興味ありを受ける最後の日。YYYY-MM-DD）。決めていなければ空 */
  recruitDue: string;
  /** 行けなくなった参加者（開催の卓）。noteはGMへの一言、atは伝えた日時 */
  absent: { name: string; note: string; at: string }[];
  /** 卓の記録（ログのURL・振り返り） */
  record: ConsoleRecord;
};

/** 卓の準備（HOの枠と、出したキャラシ） */
export type ConsolePrep = {
  /** キャラシの締め切り（YYYY-MM-DD）。無ければ空 */
  sheetDue: string;
  /** HOの枠（posの順） */
  slots: ConsoleSlot[];
  /**
   * 出したキャラシ{ 名前: { url, pc（キャラクターの名前）, at（出した日時）, outcome（終わった卓での結果。生還・ロストなど） } }。
   * 終わった卓では、キャラシを出していない人もPCの名前と結果だけを書ける（urlは空）
   */
  sheets: Record<string, { url: string; pc: string; at: string; outcome: string }>;
};

/** 卓の記録（終わった卓）。logUrlはログ（リプレイ）のURL、recapは振り返り */
export type ConsoleRecord = { logUrl: string; recap: string };

/** 卓の記録に書ける長さ */
export const RECORD_MAX = { url: 500, recap: 1000, outcome: 20 } as const;

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
  /**
   * ログインした本人。shareBusyは、ほかのグループの卓の日を、入っているグループの予定表に「他」として出すか（本人の設定。どのグループにも効く）。
   * dmは自分あてのDMの知らせ（受け取る種類と、最後に届かなかった理由。届けば空）
   */
  me: { name: string; isAdmin: boolean; shareBusy: boolean; dm: { kinds: DmKind[]; error: string } };
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
  /** メンバーの予定{ 'YYYY-MM-DD': { 名前: '△' | '×' } }。昼と夜に分けて入れた日は、まとめた印（src/shared/parts.tsのcombineMarks） */
  avail: Record<string, Record<string, string>>;
  /** 昼と夜に分けて入れた予定{ 'YYYY-MM-DD': { 名前: [昼, 夜] } }（分けて入れた日だけ） */
  availParts: AvailParts;
  /** 日付のメモ{ 始まりの日: { text, by, at, to } }。toは期間の終わり（1日だけのメモは空） */
  notes: Record<string, { text: string; by: string; at: string; to: string }>;
  /** 予定のメモ{ 'YYYY-MM-DD': { 名前: { text, at } } } */
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  log: { at: string; kind: string; target: string; result: string }[];
  /** 卓に入っている日{ 'YYYY-MM-DD': { 名前: '参' | 'GM' | '他' } }。「他」は、ほかのグループの卓（グループや卓の名前は出さない） */
  booked: Record<string, Record<string, string>>;
  /** 卓に入っている時間帯{ 'YYYY-MM-DD': { 名前: '昼' | '夜' | '' } }（'' は終日） */
  bookedParts: BookedParts;
  /** 予定表に出す日（今日から） */
  availDays: string[];
  /** 知らせのチャンネル（DiscordのチャンネルのID）が決まっているか。基本と、種類ごと */
  channelSet: boolean;
  remindChannelSet: boolean;
  recruitChannelSet: boolean;
  /**
   * 知らせを送るBot。ready: サーバーにBotのトークンがある（運営者の設定）。inviteUrl: このグループのサーバーにBotを招くURL。
   * eventsInviteUrl: 「イベントを作成」の権限も付けて招くURL（卓をDiscordのイベントに出すとき）。threadsInviteUrl: スレッドの権限も付けて招くURL（卓ごとのスレッド）
   */
  bot: { ready: boolean; inviteUrl: string; eventsInviteUrl: string; threadsInviteUrl: string };
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
    /** 予定の印を昼と夜に分ける */
    dayParts: boolean;
    calMonths: number;
    availDays: number;
    setter: string;
    /** 卓をDiscordのイベントにも出す */
    discordEvents: boolean;
    /** イベントの最後の失敗（うまくいけば空） */
    eventsError: string;
    /** 卓の知らせを、卓ごとのスレッドにまとめる */
    threads: boolean;
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

/** 卓の変更の履歴の1件（getSessionHistoryの返事のitems。新しい順）。atは「2026/10/09（金）21:16」の形 */
export type SessionHistoryItem = { at: string; by: string; action: string; detail: string };

/**
 * グループの書き出し（exportGroupの返事のexport。管理者だけ）。グループの中身を、手元に控えるためのJSON。
 * 秘匿HO・Discordのチャンネル・購読URL・Googleの情報は入れない
 */
export type GroupExport = {
  format: 'yoki-group-export';
  /** 書き出したYokiのバージョンと、書き出した日時（ISO） */
  version: string;
  exportedAt: string;
  group: { id: string; title: string; guildName: string };
  members: { name: string; discordId: string; note: string; admin: boolean }[];
  sessions: {
    id: string; name: string; status: string; date: string; start: string; end: string; place: string; memo: string; series: string; seriesEnd: string;
    windowFrom: string; windowTo: string; gm: string; coGms: string[]; members: string[]; want: string[]; interest: string[]; scenario: string;
    candidates: string[]; votes: Record<string, Record<string, string>>; pollDue: string; capacity: number; recruitDue: string; absent: { name: string; note: string }[];
    prep: { sheetDue: string; slots: { label: string; summary: string; assigned: string }[]; sheets: Record<string, { url: string; pc: string; outcome: string }> };
    record: ConsoleRecord;
    history: { at: string; by: string; action: string; detail: string }[];
  }[];
  /** 予定の印（残っている日すべて。partは '' が1日、'昼'・'夜' が時間帯） */
  availability: { date: string; name: string; part: string; mark: string }[];
  availNotes: { date: string; name: string; text: string }[];
  dayNotes: { date: string; to: string; text: string; by: string }[];
  scenarios: { name: string; system: string; playersMin: number | null; playersMax: number | null; hours: string; url: string; memo: string; marks: Record<string, ScenarioMark> }[];
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

/**
 * 自分の予定の一覧の1件（GET /api/me/agenda）。入っているグループをまたいで出す。
 *   session … これからの「開催」の卓（GMか参加者。行けなくなった卓は除く）。dateは開催日
 *   vote    … まだ答えていない候補日がある日程調整。dateは回答の締め切り（決めていなければ空）
 *   decide  … 全員の回答がそろった、GMとして開催日を選ぶ日程調整
 *   sheet   … まだ出していないキャラシ（参加者）。dateは締め切り
 */
export type AgendaItem = {
  kind: 'session' | 'vote' | 'decide' | 'sheet';
  groupId: string;
  groupTitle: string;
  /** 卓のID（S001） */
  id: string;
  name: string;
  date: string;
  start: string;
  end: string;
};
/** 自分の予定の一覧（GET /api/me/agenda）。あなたの番（vote・decide・sheet）が先、卓は開催日の順 */
export type AgendaResponse = { today: string; items: AgendaItem[] };

/** グループを作った返事（POST /api/groups）。失敗なら{ error } */
export type CreateGroupResult = { ok: true; id: string; url: string };
