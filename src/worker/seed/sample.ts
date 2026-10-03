// サンプルデータ（GAS 版のデモと同じ顔ぶれ）。開発用ログインとテストが使う。
// 画面と同じ関数を、メンバーとして呼んで作る。日付は今日から数えるので、いつ作っても今の月の画面になる
import type { Actor } from '../auth/guard';
import { DEV_USERS } from '../auth/dev-users';
import { SAMPLE_WEBHOOK } from '../discord/send';
import { setAvailability, setAvailabilityBulk, setAvailNote, setDayNote } from '../domain/availability';
import { loadGroup } from '../domain/load';
import { setPollVote, startPoll } from '../domain/polls';
import { saveSession, setInterest } from '../domain/sessions';
import { addDays, fmtDateTime, jst } from '../lib/jst';

const NOTES: Record<string, string> = { ひより: 'GM が多め', こまち: '平日は 21 時から', ミナト: 'TRPG は始めたばかり' };

export async function seedSample(db: D1Database, groupId: string, appUrl: string, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    // ひよりはグループを作った人（管理者の名簿に載る）
    ...DEV_USERS.map((u) =>
      db.prepare('INSERT INTO members (group_id, name, discord_id, note, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (group_id, name) DO NOTHING')
        .bind(groupId, u.name, u.id, NOTES[u.name] ?? '', u.manager ? 1 : 0, at),
    ),
    db.prepare('UPDATE groups SET webhook_url = ?2, remind_enabled = 1, remind_set_by = ?3 WHERE id = ?1').bind(groupId, SAMPLE_WEBHOOK, 'ひより / ' + fmtDateTime(now)),
  ]);
  const ids = new Map(
    (await db.prepare('SELECT id, name FROM members WHERE group_id = ?').bind(groupId).all<{ id: number; name: string }>()).results.map((m) => [m.name, m.id]),
  );
  /** その人として読み込む（サンプルづくりではほかの人のぶんも入れるので、管理者として扱う） */
  const as = (name: string) => {
    const actor: Actor = { memberId: ids.get(name)!, name, isAdmin: true, userId: '' };
    return loadGroup(db, groupId, actor, appUrl, now);
  };
  const io = { reload: () => as('ひより'), data: async () => ({}), sleep: async () => {} };
  const today = jst(now).ymd;
  const T = (n: number) => addDays(today, n);
  const p = jst(now);
  const nmY = p.month === 12 ? p.year + 1 : p.year, nmM = (p.month % 12) + 1;
  const nextFrom = nmY + '-' + String(nmM).padStart(2, '0') + '-01';
  const nextMid = nextFrom.slice(0, 8) + '15';
  const nextTo = addDays(nmM === 12 ? nmY + 1 + '-01-01' : nmY + '-' + String(nmM + 1).padStart(2, '0') + '-01', -1);
  const S = async (o: Record<string, unknown>, by = 'ひより') =>
    (await saveSession(await as(by), { extra: '', members: [], start: '', end: '', place: '', memo: '', series: '', ...o })) as { id: string };

  // キャンペーン（シリーズ）
  await S({ name: '鉄鳴界の夜明け #1', series: '鉄鳴界の夜明け', gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], date: T(-6), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: 'キャンペーン第 1 回。キャラクター作成から' });
  await S({ name: '鉄鳴界の夜明け #2', series: '鉄鳴界の夜明け', seriesEnd: T(40), gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], dates: [T(2), T(9), T(16)], date: T(2), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: '前回の続きから' });
  // 単発
  await S({ name: '今夜の短編', gm: 'ユズ', members: ['ひより', 'ミナト'], date: T(0), start: '21:00', end: '23:00', status: '開催', place: 'Discord ボイス', memo: '2 時間で終わる短いシナリオ' });
  const port = await S({ name: '星降る港の依頼', gm: 'ミナト', members: ['ソラ', 'レン'], date: T(1), start: '20:30', end: '23:00', status: '開催', place: 'Discord ボイス', memo: 'ミナトさんの初 GM' });
  await S({ name: '連れて帰る', gm: 'ソラ', members: ['ひより', 'ミナト', 'ユズ'], date: T(5), start: '14:00', end: '18:00', status: '開催', place: 'ユドナリウムアックス', memo: '初めての人も歓迎' });
  await S({ name: '灰色の図書館', gm: 'レン', members: ['こまち', 'ユズ', 'ひより'], date: T(12), start: '21:00', end: '23:30', status: '開催', place: 'Discord ボイス', memo: '' });
  // 募集
  const castle = await S({ name: '雪原の古城', gm: 'こまち', status: '募集', windowFrom: nextFrom, windowTo: nextMid, memo: '3〜4 人で。ボイスあり' });
  await setInterest(await as('ソラ'), { id: castle.id, name: 'ソラ', level: 'want' });
  await setInterest(await as('レン'), { id: castle.id, name: 'レン', level: 'interest' });
  await setInterest(await as('ユズ'), { id: castle.id, name: 'ユズ', level: 'interest' });
  const camp = await S({ name: '新キャンペーン顔合わせ', gm: 'ひより', status: '募集', windowFrom: nextMid, windowTo: nextTo, memo: '長いキャンペーンの相談会。見学だけでも' });
  await setInterest(await as('ミナト'), { id: camp.id, name: 'ミナト', level: 'want' });
  await setInterest(await as('こまち'), { id: camp.id, name: 'こまち', level: 'interest' });
  // 日程調整
  const maze = await S({ name: '迷宮の底へ', gm: 'レン', members: ['ひより', 'ソラ', 'こまち'], status: '調整中', windowFrom: T(18), windowTo: T(32), memo: '候補の期間のどこかで 1 回' }, 'レン');
  await startPoll(await as('レン'), { id: maze.id, dates: [T(19), T(21), T(24), T(26)], start: '20:00', end: '23:00' });
  for (const [name, n, vote] of [['ひより', 19, '◯'], ['ひより', 21, '×'], ['ひより', 24, '◯'], ['ソラ', 19, '×'], ['ソラ', 24, '◯'], ['ソラ', 26, '◯']] as const) {
    await setPollVote(await as(name), { id: maze.id, ymd: T(n), name, vote }, io);
  }
  // メンバーの予定（都合の悪い日だけ）
  for (const [name, wds, mark] of [['ソラ', [2], '×'], ['こまち', [3], '△'], ['レン', [4], '×'], ['ミナト', [0], '△']] as const) {
    await setAvailabilityBulk(await as(name), { name, from: T(0), to: T(59), weekdays: wds, mark, keep: true });
  }
  await setAvailability(await as('ひより'), { name: 'ひより', ymd: T(7), mark: '×' });
  await setAvailability(await as('ユズ'), { name: 'ユズ', ymd: T(10), mark: '△' });
  await setAvailNote(await as('ソラ'), { name: 'ソラ', ymd: T(8), text: '21 時からなら参加できます' });
  await setDayNote(await as('ソラ'), { ymd: T(5), text: 'ユドナリウムの部屋は前日に作ります' });
  // Discord に送った跡（送ったことにするだけ）。案内は今日が開催前の知らせの日なので、開催前の知らせ済みにもなる
  await db.batch([
    db.prepare("INSERT INTO notify_log (group_id, at, kind, target, result) VALUES (?1, ?2, '案内', '星降る港の依頼', 'OK (204)'), (?1, ?2, '参加確認', '雪原の古城（募集のチャンネル）', 'OK (204)')").bind(groupId, at),
    db.prepare('UPDATE sessions SET notified_at = ?3 WHERE group_id = ?1 AND seq = ?2').bind(groupId, Number(port.id.slice(1)), at),
    db.prepare('UPDATE sessions SET asked_at = ?3 WHERE group_id = ?1 AND seq = ?2').bind(groupId, Number(castle.id.slice(1)), at),
  ]);
}
