// 卓の状態と、知らせの決まり（GAS 版 Config.js）
/**
 * 卓の状態。募集 → 調整中 → 開催 → 終了 と進み、中止は別。
 *   募集   … 参加者を集めている。開催日の代わりに、開きたい期間を持つ。参加希望・興味ありを付けられる
 *   調整中 … 参加者は決まり、開催日を選んでいる。候補の期間を持つ。募集のときの参加希望の人は、このときに参加者へ移る
 *   開催   … 開催日が決まった
 *   終了   … 開催日が過ぎた（自動で変わる）
 */
export const STATUS = { RECRUIT: '募集', ADJUSTING: '調整中', HELD: '開催', DONE: '終了', CANCELED: '中止' } as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];
export const STATUS_LIST: Status[] = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD, STATUS.DONE, STATUS.CANCELED];
/** 稼働中。一覧と「卓予定」に出る */
export const ACTIVE: Status[] = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD];
/** 開催日が要る。予定表に「参」「GM」が付く */
export const DATED: Status[] = [STATUS.HELD];
/** この状態になったら、参加希望の人を参加者に移す */
export const PROMOTE: Status[] = [STATUS.ADJUSTING, STATUS.HELD];

export const MARKS = ['△', '×'];          // 予定の印。空欄は参加できる
export const POLL_MARKS = ['◯', '×'];
export const POLL_MAX_DATES = 20;
export const AVAIL_NOTE_MAX = 200;
export const DAY_NOTE_MAX = 500;
export const ASK_MESSAGE_MAX = 500;
export const NOTIFY_DAYS_MAX = 30;
/** 開始直前の知らせ: 開始を過ぎてから送らなくなるまでの猶予（分） */
export const SOON_LATE_MIN = 15;
