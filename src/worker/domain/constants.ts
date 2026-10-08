// 卓の状態と、知らせの決まり（GAS版Config.js）
import { ABSENCE_NOTE_MAX, CAPACITY_MAX, DAY_NOTE_SPAN_MAX, SESSION_DATES_MAX, STATUS, type Status } from '../../shared/api';

// 卓の状態（の名前と順番）と、いくつかの上限（まとめて登録する日数・日付メモの期間・募集の定員・行けなくなったときの一言）は、画面と共有する（src/shared/api.ts）
export { ABSENCE_NOTE_MAX, CAPACITY_MAX, DAY_NOTE_SPAN_MAX, SESSION_DATES_MAX, STATUS, type Status };
export const STATUS_LIST: Status[] = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD, STATUS.DONE, STATUS.CANCELED];
/** 開催日が要る。予定表に「参」「GM」が付く */
export const DATED: Status[] = [STATUS.HELD];
/** この状態になったら、参加希望の人を参加者に移す */
export const PROMOTE: Status[] = [STATUS.ADJUSTING, STATUS.HELD];

export const MARKS = ['△', '×'];          // 予定の印。空欄は参加できる
/** 日程調整の回答。△ は調整すれば行ける */
export const POLL_MARKS = ['◯', '△', '×'];
export const POLL_MAX_DATES = 20;
export const AVAIL_NOTE_MAX = 200;
export const DAY_NOTE_MAX = 500;
export const ASK_MESSAGE_MAX = 500;
export const NOTIFY_DAYS_MAX = 30;
/** 開始直前の知らせ: 開始を過ぎてから送らなくなるまでの猶予（分） */
export const SOON_LATE_MIN = 15;
