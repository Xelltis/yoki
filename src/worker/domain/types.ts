// 読み込んだグループのデータ（GAS版のctxに当たる）
import type { Actor } from '../auth/guard';
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
};

export type Member = { id: number; name: string; discordId: string; note: string; isAdmin: boolean; userId: string | null };

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
};

export type SeriesNotify = { channelId: string; alsoBase: boolean; days: number | null; hour: number | null };

export type LogRow = { at: string; kind: string; target: string; result: string };

export type Ctx = {
  db: D1Database;
  group: GroupRow;
  members: Member[];
  memberByName: Map<string, Member>;
  sessions: Session[];
  /** { 'YYYY-MM-DD': { 名前: '△' | '×' } }（今日からavail_days日分） */
  avail: Record<string, Record<string, string>>;
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  dayNotes: Record<string, { text: string; by: string; at: string }>;
  /** 卓（rowId）ごとの回答{ 'YYYY-MM-DD': { 名前: '◯' | '×' } } */
  votes: Map<number, Record<string, Record<string, string>>>;
  seriesNotify: Record<string, SeriesNotify>;
  log: LogRow[];
  now: Date;
  /** 今日（日本時間） */
  today: string;
  actor: Actor;
  /** このグループの画面のURL（Discordの文に使う） */
  appUrl: string;
  /** 知らせを送るBot（卓予定のDiscordアプリ）。tokenが空なら送れない。clientIdはBotを招くURLに使う */
  bot: Bot;
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
