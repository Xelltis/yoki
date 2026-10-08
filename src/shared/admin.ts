// 運営者の管理画面（/admin/）とサーバーの約束（/api/admin/*）。画面とサーバーの両方から読む。
// ブラウザの型もWorkersの型も使わない（どちらからも読めるように）

/** 見回り（cron）の最後の回の結果（metaのpatrol）。failsは続けて失敗した回数（うまくいけば0。前の版の記録には無い） */
export type PatrolRecord = { at: string; ms: number; ok: boolean; error: string; fails?: number };

/** Botのトークンを最後に確かめた結果（metaのbot_check）。sinceは使えなくなった時刻（使えるあいだは空） */
export type BotCheck = { ok: boolean; at: string; since: string };

/** 運営者への最後の知らせ（DM）。sent・failedは届いた・届かなかった人の数、errorは届かなかった理由の1つ */
export type NoticeLast = { at: string; kind: string; sent: number; failed: number; error: string };

/** Discordへの送信の失敗（送信失敗・送らず）の記録 */
/** 送信の失敗。送った卓の名前（送信記録のtarget）は、グループの中身なので運営者には出さない */
export type AdminFailure = { at: string; groupId: string; groupTitle: string; kind: string; result: string };

/** 様子（GET /api/admin/overview） */
export type AdminOverview = {
  now: string;
  counts: {
    groups: number;
    users: number;
    bannedUsers: number;
    /** 有効なログイン（期限の切れていないもの） */
    logins: number;
    /** 動いている卓（募集・調整中・開催） */
    activeSessions: number;
  };
  patrol: {
    last: PatrolRecord | null;
    /** 最後にうまくいった見回りの時刻 */
    okAt: string;
    /** 毎時の仕事（開催前の知らせ・期間前の催促・過ぎた卓の自動終了）を最後に回した日本時間（YYYY-MM-DDTHH） */
    hourly: string;
    /** 毎日の片付けを最後にした日（日本時間のYYYY-MM-DD） */
    daily: string;
    /** 最後の見回りが15分より前（cronが止まっているかもしれない） */
    stale: boolean;
  };
  failures: { day: number; week: number; recent: AdminFailure[] };
  /** 新規登録を受け付けているか */
  registrationOpen: boolean;
  /** 日程調整と募集の知らせにボタンを付けて、Discordで答えられるようにしているか */
  discordButtons: boolean;
  /** 運営者への知らせ（BotからのDM） */
  notices: {
    on: boolean;
    /** 送る相手（OPERATOR_IDSの人数） */
    operators: number;
    /** Botのトークン。missingはsecretが無い、unknownはまだ確かめていない、badは使えない（sinceから） */
    bot: { state: 'ok' | 'bad' | 'missing' | 'unknown'; at: string; since: string };
    /** 最後に知らせた新しいバージョン（まだなら空） */
    version: string;
    last: NoticeLast | null;
  };
};

/** グループの一覧の1行（GET /api/admin/groups） */
export type AdminGroupRow = {
  id: string;
  title: string;
  guildId: string;
  guildName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  lastUsedAt: string;
  memberCount: number;
  /** Discordでログインしたことのあるメンバー */
  linkedCount: number;
  /** 管理者の印のあるメンバー（Discordサーバーの管理者は、印が無くても管理者） */
  adminCount: number;
  sessionCount: number;
  activeCount: number;
  /** 7日の送信の失敗 */
  failuresWeek: number;
};

export type AdminMember = {
  id: number;
  name: string;
  discordId: string;
  userId: string | null;
  userName: string;
  isAdmin: boolean;
  lastLoginAt: string;
};

/** グループの詳しい中身（GET /api/admin/groups/:id）。卓・予定は出さない */
export type AdminGroupDetail = AdminGroupRow & {
  /** 知らせの基本のチャンネルが決まっているか */
  channelSet: boolean;
  members: AdminMember[];
  /** そのDiscordサーバーを管理できる人（ログインしたことがある人だけ分かる）。印が無くても管理者 */
  guildManagers: { id: string; name: string }[];
};

/** 利用者の一覧の1行（GET /api/admin/users） */
export type AdminUserRow = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  createdAt: string;
  lastLoginAt: string;
  /** 有効なログインの数 */
  logins: number;
  groups: { id: string; title: string }[];
  /** 締め出した日時（締め出していなければ空） */
  bannedAt: string;
  bannedReason: string;
  /** 運営者（締め出せない） */
  operator: boolean;
};

/** 利用規約（/terms）とプライバシーポリシー（/privacy） */
export type LegalKind = 'terms' | 'privacy';
export const LEGAL_KINDS: readonly LegalKind[] = ['terms', 'privacy'];
export const LEGAL_TITLES: Record<LegalKind, string> = { terms: '利用規約', privacy: 'プライバシーポリシー' };
/** 運営者の名前・問い合わせ先・本文の長さの上限 */
export const LEGAL_MAX = { operator: 100, contact: 300, text: 20000 } as const;

/** 本文1つ。直していなければ既定の文（textとdefaultTextが同じ、customが偽） */
export type LegalDoc = {
  text: string;
  custom: boolean;
  /** 更新日（YYYY-MM-DD）。既定の文なら、既定の文を最後に直した日 */
  updatedAt: string;
  defaultText: string;
};

/** 利用規約とプライバシーポリシーの設定（GET /api/admin/legal）。POSTは{ operator?, contact?, terms?, privacy? }（省いたものは変えない） */
export type AdminLegal = { operator: string; contact: string; terms: LegalDoc; privacy: LegalDoc };

/** 更新のワークフローの実行（新しい順）。statusはqueued・in_progress・completedなど、conclusionはsuccess・failureなど（GitHubの値） */
export type AdminUpdateRun = { id: number; status: string; conclusion: string; createdAt: string; url: string };

/**
 * Yokiの版と更新（GET /api/admin/update。?refresh=1ならGitHubを読み直す）。POSTは最新の版への更新を始める（本文は要らない）。
 * 新しい版は、元のリポジトリのGitHubのReleaseから読む（1時間に1回まで）
 */
export type AdminUpdate = {
  /** 動いている版（例1.2.0） */
  current: string;
  /** 元のリポジトリ（owner/name） */
  upstream: string;
  /** 元のリポジトリの最新のRelease。まだ無い・読めなければnull。notesはReleaseの本文（Markdown） */
  latest: { version: string; name: string; url: string; publishedAt: string; notes: string } | null;
  /** 今の版より新しい版があるか */
  available: boolean;
  /** 今の版から最新の版までに、表（D1）の変更があるか。分からなければnull */
  migrations: boolean | null;
  /** 読めなかったときの理由（読めたら空） */
  error: string;
  /** GitHubを最後に読んだ時刻 */
  checkedAt: string;
  /** 公開しているリポジトリ（owner/name）。分からなければ空 */
  repo: string;
  /** 更新のワークフローのGitHubの画面（「Run workflow」で動かせる）。repoが分からなければ空 */
  workflowUrl: string;
  /** 管理画面のボタンで更新を始められるか（ワークフローを動かすトークンがある） */
  canDispatch: boolean;
  /** 更新のワークフローの最近の実行（トークンがあるときだけ） */
  runs: AdminUpdateRun[];
};

/** 変える操作の返事 */
export type AdminResult = { ok: true; message: string };
