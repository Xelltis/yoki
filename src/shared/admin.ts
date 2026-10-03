// 運営者の管理画面（/admin/）とサーバーの約束（/api/admin/*）。画面とサーバーの両方から読む。
// ブラウザの型も Workers の型も使わない（どちらからも読めるように）

/** 見回り（cron）の最後の回の結果（meta の patrol） */
export type PatrolRecord = { at: string; ms: number; ok: boolean; error: string };

/** Discord への送信の失敗（送信失敗・送らず）の記録 */
export type AdminFailure = { at: string; groupId: string; groupTitle: string; kind: string; target: string; result: string };

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
    /** 毎日の片付けを最後にした日（日本時間の YYYY-MM-DD） */
    daily: string;
    /** 最後の見回りが 15 分より前（cron が止まっているかもしれない） */
    stale: boolean;
  };
  failures: { day: number; week: number; recent: AdminFailure[] };
};

/** グループの一覧の 1 行（GET /api/admin/groups） */
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
  /** Discord でログインしたことのあるメンバー */
  linkedCount: number;
  /** 管理者の印のあるメンバー（Discord サーバーの管理者は、印が無くても管理者） */
  adminCount: number;
  sessionCount: number;
  activeCount: number;
  /** 7 日の送信の失敗 */
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

/** グループの詳しい中身（GET /api/admin/groups/:id）。卓・予定・Webhook の URL は出さない */
export type AdminGroupDetail = AdminGroupRow & {
  webhookSet: boolean;
  members: AdminMember[];
  /** その Discord サーバーを管理できる人（ログインしたことがある人だけ分かる）。印が無くても管理者 */
  guildManagers: { id: string; name: string }[];
};

/** 利用者の一覧の 1 行（GET /api/admin/users） */
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

/** 変える操作の返事 */
export type AdminResult = { ok: true; message: string };
