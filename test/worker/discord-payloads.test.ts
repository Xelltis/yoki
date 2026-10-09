// Discordに送る文面。データを読まずに、作った卓をそのまま渡して文を確かめる
import { describe, expect, test } from 'vitest';
import {
  absencePayload, announcePayload, askPayload, bulkPayload, changePayload, decidedPayload, mentionsOf, pollPayload, pollClosedPayload, pollDuePayload, pollReadyPayload, recruitDuePayload, recruitLink, sessionEmbed, testPayload, whenText,
} from '../../src/worker/discord/payloads';
import type { Ctx, GroupRow, Member, Session } from '../../src/worker/domain/types';

const URL_ = 'https://yoki.test/g/grp/';
const TODAY = '2026-10-10';   // 土曜

// ひよりとソラはDiscord IDあり、こまちは無し。名簿に無い名前（ゲスト）も卓に入れられる
const MEMBERS: Member[] = [
  { id: 1, name: 'ひより', discordId: '400000000000000010', note: '', isAdmin: true, userId: null, other: [], shareBusy: false, dmKinds: '', dmError: '', weekly: '' },
  { id: 2, name: 'ソラ', discordId: '400000000000000011', note: '', isAdmin: false, userId: null, other: [], shareBusy: false, dmKinds: '', dmError: '', weekly: '' },
  { id: 3, name: 'こまち', discordId: '', note: '', isAdmin: false, userId: null, other: [], shareBusy: false, dmKinds: '', dmError: '', weekly: '' },
];

function ctxOf(o: { appUrl?: string; votes?: Ctx['votes'] } = {}) {
  return {
    group: { title: 'テストの卓' } as GroupRow,
    memberByName: new Map(MEMBERS.map((m) => [m.name, m])),
    appUrl: o.appUrl ?? URL_,
    votes: o.votes ?? new Map(),
    today: TODAY,
  };
}

function session(o: Partial<Session> = {}): Session {
  return {
    rowId: 1, id: 'S001', seq: 1, name: '港', gm: '', coGms: [], members: [], want: [], interest: [], watch: [], date: null, start: '', end: '', status: '開催',
    place: '', memo: '', series: '', seriesEnd: null, windowFrom: null, windowTo: null, candidates: [], editor: '', updatedAt: '',
    notifiedAt: null, askedAt: null, urgedAt: null, soonAt: null, pollReadyAt: null, pollDue: null, pollUrgedAt: null, pollClosedAt: null, scenarioId: null, sheetDue: null, sheetUrgedAt: null, slots: [], sheets: [], capacity: null, recruitDue: null, dueUrgedAt: null, absent: [], threadId: null, threadParent: null, logUrl: '', recap: '', ...o,
  };
}

describe('日時と卓の埋め込み', () => {
  test('日時は、開催日・募集の期間・調整の候補日と期間の順に見る', () => {
    expect(whenText(session({ date: '2026-10-17', start: '20:00', end: '23:00' }))).toBe('10/17（土） 20:00〜23:00');
    expect(whenText(session({ status: '募集', windowFrom: '2026-10-17', windowTo: '2026-10-12' }))).toBe('10/12（月）〜10/17（土）に開催予定（募集中）');
    expect(whenText(session({ status: '募集' }))).toBe('時期未定（募集中）');
    expect(whenText(session({ status: '調整中', candidates: ['2026-10-12', '2026-10-13'] }))).toBe('候補日: 10/12（月）、10/13（火）（日程調整中）');
    expect(whenText(session({ status: '調整中', windowFrom: '2026-10-12', windowTo: '2026-10-17' }))).toBe('10/12（月）〜10/17（土）のどこか（調整中）');
    expect(whenText(session({ status: '調整中' }))).toBe('期間未定（調整中）');
    expect(whenText(session({ status: '終了' }))).toBe('日程未定');
  });

  test('埋め込みには、GM・日時・参加者と、あれば参加希望・場所・メモを書く', () => {
    const e = sessionEmbed(ctxOf(), session({ status: '募集', want: ['ソラ', 'こまち'], place: 'ボイスチャンネル', memo: '初心者歓迎' }));
    expect(e).toEqual({
      title: '港（募集中）',
      description: 'GM: 未定\n日時: 時期未定（募集中）\n参加者: 未定\n参加希望: ソラ、こまち\n場所: ボイスチャンネル\nメモ: 初心者歓迎',
      color: 0x4a86e8,
      footer: { text: 'テストの卓' },
    });
    expect(sessionEmbed(ctxOf(), session({ status: '調整中', gm: 'ひより', members: ['ソラ'] })).title).toBe('港（調整中）');
    // 参加希望は募集中の卓だけに出す
    const held = sessionEmbed(ctxOf(), session({ gm: 'ひより', members: ['ソラ'], want: ['こまち'], date: '2026-10-17' }));
    expect(held.title).toBe('港');
    expect(held.description).toBe('GM: ひより\n日時: 10/17（土） 時間未定\n参加者: ソラ');
  });

  test('行けなくなった知らせ: GMにIDが無ければ名前で、GMがいなければ呼ばない。アプリのURLが無ければリンクを付けない', () => {
    const s = session({ gm: 'こまち', members: ['ソラ'], date: TODAY, start: '20:00' });
    expect(absencePayload(ctxOf({ appUrl: '' }), s, 'ソラ', '').content).toBe('🙇 「港」（10/10（土） 20:00〜）に、ソラが行けなくなりました。 こまちさん\nYokiで「日を組み直す」か、参加者を見直してください。');
    expect(absencePayload(ctxOf({ appUrl: '' }), { ...s, gm: '' }, 'ソラ', '').content).toContain('ソラが行けなくなりました。\nYoki');
  });

  test('締め切りの知らせ: GMにIDが無ければ名前で呼ぶ。アプリのURLが無ければリンクを付けない', () => {
    const p = recruitDuePayload(ctxOf({ appUrl: '' }), session({ status: '募集', gm: 'こまち', want: ['ソラ'], recruitDue: TODAY }));
    expect(p.content).toBe('📮 「港」の募集は今日（10/10（土））で締め切りです。参加希望: ソラ（1人） こまちさん\n集まったら、カードの「開催にする」か、「編集」で状態を「調整中」にして進めてください。');
  });

  test('募集の定員と締め切りがあれば、参加希望の人数と締め切りを書く（まだいなくても）', () => {
    const e = sessionEmbed(ctxOf(), session({ status: '募集', want: ['ソラ'], capacity: 3, recruitDue: '2026-10-15' }));
    expect(e.description).toBe('GM: 未定\n日時: 時期未定（募集中）\n参加者: 未定\n参加希望: ソラ（1/3人）\n締め切り: 10/15（木）');
    expect(sessionEmbed(ctxOf(), session({ status: '募集', capacity: 2 })).description).toContain('参加希望: まだいません（0/2人）');
  });
});

describe('メンションと案内の行', () => {
  test('メンションはDiscord IDのある人だけ。いくつかの卓で重なっても1回', () => {
    const a = session({ gm: 'ひより', members: ['こまち', 'ゲスト'] });
    const b = session({ gm: 'ソラ', members: ['ひより'] });
    expect(mentionsOf(ctxOf(), [a, b])).toBe('<@400000000000000010> <@400000000000000011>');
    expect(mentionsOf(ctxOf(), [session({ gm: 'こまち', members: ['ゲスト'] })])).toBe('');
  });

  test('募集と調整の卓にだけ、Yokiへの案内を添える（URLが無ければ添えない）', () => {
    expect(recruitLink(ctxOf(), session({ status: '募集' }))).toBe('\n🔗 参加希望はYokiの「募集・調整」タブから: ' + URL_);
    expect(recruitLink(ctxOf(), session({ status: '調整中' }))).toBe('\n🔗 日程調整はYokiの「募集・調整」タブから: ' + URL_);
    expect(recruitLink(ctxOf(), session({ status: '開催' }))).toBe('');
    expect(recruitLink(ctxOf({ appUrl: '' }), session({ status: '募集' }))).toBe('');
  });
});

describe('登録・変更・削除と案内', () => {
  test('変更はメンションしない。削除は卓の名前だけで、埋め込みは付けない', () => {
    const s = session({ gm: 'ひより', members: ['ソラ'], date: '2026-10-17' });
    const changed = changePayload(ctxOf(), s, '変更', 'ひより');
    expect(changed.content).toBe('✏️ 卓の予定が変更されました（ひより）');
    expect(changed.embeds).toHaveLength(1);
    expect(changePayload(ctxOf(), { name: '港' } as Session, '削除', 'ひより')).toEqual({ content: '🗑️ 卓の予定が削除されました（ひより）：港', embeds: [] });
  });

  test('登録で呼べる人がいなければ、メンションの行を足さない。変えた人が分からなければ名前を付けない', () => {
    const s = session({ gm: 'こまち', status: '調整中' });
    expect(changePayload(ctxOf(), s, '登録', '').content).toBe('🆕 卓の予定が登録されました\n🔗 日程調整はYokiの「募集・調整」タブから: ' + URL_);
  });

  test('案内は、送った人とメンションがあれば添える', () => {
    const s = session({ gm: 'ひより', members: ['こまち'], date: '2026-10-17', start: '20:00' });
    expect(announcePayload(ctxOf(), s, 'ソラ').content).toBe('📣 卓の案内: 港（10/17（土） 20:00〜）　by ソラ\n<@400000000000000010>');
    expect(announcePayload(ctxOf(), session({ gm: 'こまち' }), '').content).toBe('📣 卓の案内: 港（日程未定）');
  });
});

describe('参加確認', () => {
  test('興味ありの人を呼ぶ。Discord IDの無い人は名前で。一言が無ければ送った人を最後に添える', () => {
    const s = session({ status: '募集', gm: 'ひより', interest: ['こまち', 'ソラ', 'ゲスト'], windowFrom: '2026-10-12', windowTo: '2026-10-17' });
    const p = askPayload(ctxOf(), s, 'ひより', '  ');
    expect(p.content).toBe(
      '❓ 「港」（10/12（月）〜10/17（土）に開催予定）に参加できそうですか？ <@400000000000000011> こまちさん ゲストさん\n' +
      '参加希望であれば、Yokiの「募集・調整」タブで「参加希望」を押してください。　by ひより\n' + URL_,
    );
    expect(p.embeds).toHaveLength(1);
  });

  test('一言は 💬 の行に。送った人が分からなければ名前を付けない。URLが無ければ書かない', () => {
    const s = session({ status: '募集', interest: ['ソラ'] });
    expect(askPayload(ctxOf({ appUrl: '' }), s, '', 'ボイスあり').content).toBe(
      '❓ 「港」（時期未定）に参加できそうですか？ <@400000000000000011>\n💬 ボイスあり\n参加希望であれば、Yokiの「募集・調整」タブで「参加希望」を押してください。',
    );
  });
});

describe('日程調整の締め切り', () => {
  test('催促: DiscordのIDが無い人は名前で呼ぶ。URLが無ければ添えない', () => {
    const s = session({ status: '調整中', gm: 'ひより', members: ['こまち'], candidates: ['2026-10-09', '2026-10-12'], pollDue: '2026-10-11' });
    expect(pollDuePayload(ctxOf({ appUrl: '' }), s, ['こまち']).content).toBe(
      '⏰ 「港」の日程調整の締め切りは明日（10/11（日））です。まだ答えていない人: こまちさん\n候補日: 10/12（月）\nYokiの「募集・調整」タブで、候補日ごとに ◯・△・× を押してください。',
    );
  });

  test('締め切りが過ぎた: GMにDiscordのIDが無ければ名前で呼ぶ。URLが無ければ添えない', () => {
    const s = session({ status: '調整中', gm: 'こまち', candidates: ['2026-10-12'], pollDue: '2026-10-09' });
    expect(pollClosedPayload(ctxOf({ appUrl: '' }), s, []).content).toBe(
      '⌛ 「港」の日程調整の締め切り（10/9（金））が過ぎました。こまちさん\n・10/12（月）　◯ 0/0（全員 ◯）\nYokiの「募集・調整」タブで、開催日を選ぶか、候補日を選び直してください。',
    );
  });
});

describe('日程調整の知らせ', () => {
  test('始めたときはGMと参加者を呼び、候補日と時間を書く', () => {
    const s = session({ status: '調整中', gm: 'ひより', members: ['こまち', 'ソラ'], candidates: ['2026-10-12', '2026-10-13'], start: '20:00', end: '23:00' });
    const p = pollPayload(ctxOf(), s, 'ひより');
    expect(p.content).toBe(
      '🗓️ 「港」の日程を決めます。<@400000000000000010> <@400000000000000011> こまちさん\n' +
      '候補日: 10/12（月）、10/13（火）　20:00〜23:00\n' +
      'Yokiの「募集・調整」タブで、候補日ごとに ◯・△（調整すれば行ける）・× を押してください。全員の回答がそろったら、GMが開催日を選びます。　by ひより\n' + URL_,
    );
    expect(p.embeds![0]!.title).toBe('港（調整中）');
  });

  test('時間が未定なら時間を書かない。送った人とURLが無ければ添えない', () => {
    const s = session({ status: '調整中', gm: 'こまち', candidates: ['2026-10-12'] });
    expect(pollPayload(ctxOf({ appUrl: '' }), s, '').content).toBe(
      '🗓️ 「港」の日程を決めます。こまちさん\n候補日: 10/12（月）\nYokiの「募集・調整」タブで、候補日ごとに ◯・△（調整すれば行ける）・× を押してください。全員の回答がそろったら、GMが開催日を選びます。',
    );
  });

  test('回答がそろったらGMだけを呼び、これからの候補日ごとに ◯ の数を並べる', () => {
    const s = session({ status: '調整中', gm: 'ひより', members: ['ソラ'], candidates: ['2026-10-09', '2026-10-12', '2026-10-13'] });
    const votes = new Map([[1, { '2026-10-09': { ひより: '◯', ソラ: '◯' }, '2026-10-12': { ひより: '◯', ソラ: '◯' }, '2026-10-13': { ひより: '◯', ソラ: '×' } }]]);
    expect(pollReadyPayload(ctxOf({ votes }), s).content).toBe(
      '📝 「港」の日程調整の回答がそろいました。<@400000000000000010>\n' +
      '・10/12（月）　◯ 2/2（全員 ◯）\n・10/13（火）　◯ 1/2\n' +
      'Yokiの「募集・調整」タブで、開催日を選んでください。\n' + URL_,
    );
  });

  test('GMにDiscord IDが無ければ名前で、GMがいなければ呼ばない。回答が無ければ ◯ は0。Discordの無い人とゲストは数えない', () => {
    const s = session({ status: '調整中', gm: 'こまち', members: ['ソラ', 'ゲスト'], candidates: ['2026-10-12'] });
    expect(pollReadyPayload(ctxOf({ appUrl: '' }), s).content).toBe(
      '📝 「港」の日程調整の回答がそろいました。こまちさん\n・10/12（月）　◯ 0/1\nYokiの「募集・調整」タブで、開催日を選んでください。',
    );
    const noGm = session({ status: '調整中', members: ['ソラ'], candidates: ['2026-10-12'] });
    expect(pollReadyPayload(ctxOf(), noGm).content.split('\n')[0]).toBe('📝 「港」の日程調整の回答がそろいました。');
  });

  test('日程が決まった知らせ。呼べる人もURLも無ければ、決まった日時だけ', () => {
    const s = session({ gm: 'こまち', date: '2026-10-17', start: '20:00', end: '23:00' });
    expect(decidedPayload(ctxOf({ appUrl: '' }), s).content).toBe('✅ 「港」の日程が決まりました: 10/17（土） 20:00〜23:00');
    expect(decidedPayload(ctxOf(), session({ gm: 'ソラ', date: '2026-10-17' })).content).toBe(
      '✅ 「港」の日程が決まりました: 10/17（土） 時間未定\n<@400000000000000011>\n🔗 Yoki: ' + URL_,
    );
  });
});

describe('まとめての変更と接続テスト', () => {
  test('まとめての変更は卓の名前を並べ、送った人とメンションを添える', () => {
    expect(bulkPayload('登録', '', ['港 #1', '港 #2'], '<@400000000000000010>').content).toBe('🔁 卓の予定を一括で登録\n・港 #1\n・港 #2\n<@400000000000000010>');
    expect(bulkPayload('変更', 'ひより', ['港'], '').content).toBe('🔁 卓の予定を一括で変更（ひより）\n・港');
  });

  test('接続テストは、送り先が分かればそれも書く', () => {
    expect(testPayload('テストの卓').content).toBe('✅ Yokiから接続テスト（テストの卓）');
    expect(testPayload('テストの卓', '募集のチャンネル').content).toBe('✅ Yokiから接続テスト（テストの卓 / 募集のチャンネル）');
  });
});
