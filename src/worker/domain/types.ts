// 読み込んだグループのデータ（GAS版のctxに当たる）
import type { Actor } from '../auth/guard';
import type { ScenarioMark } from '../../shared/api';
import type { AvailParts } from '../../shared/parts';
import type { Status } from './constants';

export type GroupRow = {
  id: string;
  guild_id: string;
  guild_name: string;
  title: string;
  next_session_seq: number;
  /** 知らせの送り先のDiscordのチャンネル（ID）。基本と、種類ごと（空なら基本へ） */
  channel_id: string;
  remind_channel_id: string;
  recruit_channel_id: string;
  notify_on_save: number;
  remind_enabled: number;
  remind_set_by: string;
  notify_days: number;
  notify_hour: number;
  urge: number;
  soon: number;
  soon_minutes: number;
  auto_finish: number;
  cal_months: number;
  avail_days: number;
  /** 卓をDiscordのイベントにも出す（1）。書き直しが要る印（1）と、最後の失敗（うまくいけば空） */
  discord_events: number;
  events_pending: number;
  events_error: string;
  /** 予定の印を昼と夜に分ける（1） */
  day_parts: number;
  /** 卓の知らせを、卓ごとのスレッドにまとめる（1） */
  threads: number;
};

/**
 * メンバー。otherは、同じ利用者がほかのグループで入っている、これからの「開催」の卓（日と開始時刻だけ。本人が出すと決めているときだけ）。
 * shareBusyは、その利用者がほかのグループの卓を出すと決めているか（ログインしていないメンバーはfalse）
 */
export type Member = { id: number; name: string; discordId: string; note: string; isAdmin: boolean; userId: string | null; other: { date: string; start: string }[]; shareBusy: boolean };

export type Role = 'gm' | 'member' | 'want' | 'interest';

export type Session = {
  rowId: number;
  /** 画面に見せるID（S001） */
  id: string;
  seq: number;
  name: string;
  gm: string;
  members: string[];
  want: string[];
  interest: string[];
  date: string | null;
  start: string;
  end: string;
  status: Status;
  place: string;
  memo: string;
  series: string;
  seriesEnd: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  candidates: string[];
  editor: string;
  updatedAt: string;
  notifiedAt: string | null;
  askedAt: string | null;
  urgedAt: string | null;
  soonAt: string | null;
  pollReadyAt: string | null;
  /** 遊ぶシナリオ（scenarios.id）。無ければnull */
  scenarioId: number | null;
  /** キャラシの締め切り（YYYY-MM-DD）と、締め切り前の催促を送った日時 */
  sheetDue: string | null;
  sheetUrgedAt: string | null;
  /** HOの枠（posの順） */
  slots: Slot[];
  /** 出したキャラシ */
  sheets: Sheet[];
  /** 募集の定員（GMは数えない）・締め切り（YYYY-MM-DD）と、締め切りの日の知らせを送った日時。決めていなければnull */
  capacity: number | null;
  recruitDue: string | null;
  dueUrgedAt: string | null;
  /** 行けなくなった参加者（名前・GMへの一言・伝えた日時） */
  absent: Absence[];
  /** 卓のスレッド（DiscordのチャンネルのID）と、スレッドを作ったチャンネルのID。無ければnull */
  threadId: string | null;
  threadParent: string | null;
};

/** 行けなくなった参加者 */
export type Absence = { name: string; note: string; at: string };

/**
 * HOの枠。secretは、読み込んだ人（Ctx.actor）がその卓のGMか、割り当てた本人のときだけ入る（読み込みのSQLで絞る）。ほかはnull。
 * hasSecretは、秘匿HOがあるか（中身は見せずに、あることだけを出す）
 */
export type Slot = {
  pos: number;
  label: string;
  summary: string;
  memberId: number | null;
  secret: string | null;
  hasSecret: boolean;
  hopes: { memberId: number; rank: number }[];
};

/** 出したキャラシ */
export type Sheet = { memberId: number; url: string; pc: string; at: string };

/** グループのシナリオ。createdByは登録したメンバー（members.id。メンバーでなくなればnull） */
export type Scenario = {
  id: number;
  name: string;
  system: string;
  playersMin: number | null;
  playersMax: number | null;
  hours: string;
  url: string;
  memo: string;
  createdBy: number | null;
  updatedAt: string;
};

/** 本人や管理者が付けた通過の印 */
export type ScenarioMarkRow = { scenarioId: number; memberId: number; kind: ScenarioMark };

export type SeriesNotify = { channelId: string; alsoBase: boolean; days: number | null; hour: number | null };

export type LogRow = { at: string; kind: string; target: string; result: string };

export type Ctx = {
  db: D1Database;
  group: GroupRow;
  members: Member[];
  memberByName: Map<string, Member>;
  sessions: Session[];
  /** { 'YYYY-MM-DD': { 名前: '△' | '×' } }（今日からavail_days日分）。昼と夜に分けて入れた日は、まとめた印（combineMarks） */
  avail: Record<string, Record<string, string>>;
  /** 昼と夜に分けて入れた印（分けて入れた日だけ） */
  availParts: AvailParts;
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  /** 日付メモ{ 始まりの日: { text, by, at, to } }。toは期間の終わり（1日だけなら空） */
  dayNotes: Record<string, { text: string; by: string; at: string; to: string }>;
  /** 卓（rowId）ごとの回答{ 'YYYY-MM-DD': { 名前: '◯' | '△' | '×' } } */
  votes: Map<number, Record<string, Record<string, string>>>;
  seriesNotify: Record<string, SeriesNotify>;
  log: LogRow[];
  now: Date;
  /** 今日（日本時間） */
  today: string;
  actor: Actor;
  /** このグループの画面のURL（Discordの文に使う） */
  appUrl: string;
  /** 知らせを送るBot（YokiのDiscordアプリ）。tokenが空なら送れない。clientIdはBotを招くURLに使う */
  bot: Bot;
  /** 知らせにボタンを付けるか（運営者が運営の管理画面で入れたYokiだけ。discord/buttons.ts） */
  buttons: boolean;
  /** 本人の購読URL（このグループ。作っていなければnull） */
  feed: { token: string; scope: FeedScope } | null;
  /** 本人のGoogle連携（していなければnull） */
  google: GoogleLinkRow | null;
  /** Google連携を使えるか（運営者がGoogleの値を設定している） */
  googleReady: boolean;
  /** 本人に結びつけた、ログインに使うGoogleアカウントのメール（無ければ空） */
  googleLoginEmail: string;
  /** Googleカレンダーの予定から入れた印{ 'YYYY-MM-DD': [名前] }（今日からavail_days日分） */
  availGoogle: Record<string, string[]>;
  /** グループのシナリオ（名前の順） */
  scenarios: Scenario[];
  /** 通過の印（本人や管理者が付けたもの。「終了」の卓から出す通過は含まない） */
  scenarioMarks: ScenarioMarkRow[];
};

export type Bot = { token: string; clientId?: string };

/** 購読URLに載せる卓。mineは自分がGMか参加者として入っている卓、allはグループの卓すべて */
export type FeedScope = 'mine' | 'all';

/** Google連携の行（refresh_tokenは読まない。画面に出さないため） */
export type GoogleLinkRow = {
  email: string;
  write_events: number;
  read_busy: number;
  busy_from: string;
  busy_to: string;
  synced_at: string | null;
  busy_at: string | null;
  error: string;
};
