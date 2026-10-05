// 読み込んだグループのデータ（GAS 版の ctx に当たる）
import type { Actor } from '../auth/guard';
import type { Status } from './constants';

export type GroupRow = {
  id: string;
  guild_id: string;
  guild_name: string;
  title: string;
  next_session_seq: number;
  /** 知らせの送り先の Discord のチャンネル（ID）。基本と、種類ごと（空なら基本へ） */
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
  /** 画面に見せる ID（S001） */
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
  /** { 'YYYY-MM-DD': { 名前: '△' | '×' } }（今日から avail_days 日分） */
  avail: Record<string, Record<string, string>>;
  availNotes: Record<string, Record<string, { text: string; at: string }>>;
  dayNotes: Record<string, { text: string; by: string; at: string }>;
  /** 卓（rowId）ごとの回答 { 'YYYY-MM-DD': { 名前: '◯' | '×' } } */
  votes: Map<number, Record<string, Record<string, string>>>;
  seriesNotify: Record<string, SeriesNotify>;
  log: LogRow[];
  now: Date;
  /** 今日（日本時間） */
  today: string;
  actor: Actor;
  /** このグループの画面の URL（Discord の文に使う） */
  appUrl: string;
  /** 知らせを送る Bot（卓予定の Discord アプリ）。token が空なら送れない。clientId は Bot を招く URL に使う */
  bot: Bot;
  /** 本人の購読 URL（このグループ。作っていなければ null） */
  feed: { token: string; scope: FeedScope } | null;
  /** 本人の Google 連携（していなければ null） */
  google: GoogleLinkRow | null;
  /** Google 連携を使えるか（運営者が Google の値を設定している） */
  googleReady: boolean;
  /** Google カレンダーの予定から入れた印 { 'YYYY-MM-DD': [名前] }（今日から avail_days 日分） */
  availGoogle: Record<string, string[]>;
};

export type Bot = { token: string; clientId: string };

/** 購読 URL に載せる卓。mine は自分が GM か参加者として入っている卓、all はグループの卓すべて */
export type FeedScope = 'mine' | 'all';

/** Google 連携の行（refresh_token は読まない。画面に出さないため） */
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
