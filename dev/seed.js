// ES モジュールではなく、DEV_BACKEND（dev/pages.js が組む）の中にそのまま差し込まれるスクリプト。
// Apps Script のモック（test/mock_gas.js）と src/server と同じスコープで動くので、saveSession などをそのまま呼べる。
// 下の WEBAPP_URL に入れる印は、組み立てるときにアプリの URL に置き換わる（dev/pages.js の APP_URL）

// サンプルデータの下ごしらえ（開くたびに作る。日付は今日から数える）。最初に呼ばれたときに 1 度だけ回す
var seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;
  var fullData = consoleData_, fullRefresh = refreshAll_;
  consoleData_ = function () { return {}; };   // 下ごしらえの途中の返事は捨てるので、画面用データも表の描き直しもしない
  refreshAll_ = function () {};
  SS.name = '卓予定';
  WEBAPP_URL = '__APP_URL__';        // 「使い方」のリンクと、Discord の文に付く URL
  userEmail_ = function () { return ''; };
  setup();
  setInitialPassword({ password: 'sample-sample', confirm: 'sample-sample' });
  tokenOk_ = function () { return true; };   // 開発サーバーでは合言葉を聞かない
  var T = function (n) { return ymd_(addDays_(new Date(), n)); };
  var me = 'ひより';
  [['ひより', 'GM が多め'], ['ソラ', ''], ['こまち', '平日は 21 時から'], ['レン', ''], ['ミナト', 'TRPG は始めたばかり'], ['ユズ', '']].forEach(function (m, k) {
    saveMember({ name: m[0], discordId: '4000000000000000' + (10 + k), note: m[1] });
  });
  saveConsoleSettings({ webhook: 'https://discord.com/api/webhooks/000000000000000000/sample' });
  setAutoNotify({ enabled: true, me: me });
  var S = function (o) {
    return saveSession(Object.assign({ extra: '', notify: false, me: me, members: [], start: '', end: '', place: '', memo: '', series: '' }, o));
  };
  var nm = new Date(); nm.setDate(1); nm.setMonth(nm.getMonth() + 1);
  var nextFrom = ymd_(nm), nextMid = ymd_(new Date(nm.getFullYear(), nm.getMonth(), 15)), nextTo = ymd_(new Date(nm.getFullYear(), nm.getMonth() + 1, 0));
  // キャンペーン（シリーズ）
  S({ name: '鉄鳴界の夜明け #1', series: '鉄鳴界の夜明け', gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], date: T(-6), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: 'キャンペーン第 1 回。キャラクター作成から' });
  S({ name: '鉄鳴界の夜明け #2', series: '鉄鳴界の夜明け', seriesEnd: T(40), gm: 'ひより', members: ['ソラ', 'こまち', 'レン'], dates: [T(2), T(9), T(16)], date: T(2), start: '20:00', end: '23:00', status: '開催', place: 'ユドナリウムアックス', memo: '前回の続きから' });
  // 単発
  S({ name: '今夜の短編', gm: 'ユズ', members: ['ひより', 'ミナト'], date: T(0), start: '21:00', end: '23:00', status: '開催', place: 'Discord ボイス', memo: '2 時間で終わる短いシナリオ' });
  var port = S({ name: '星降る港の依頼', gm: 'ミナト', members: ['ソラ', 'レン'], date: T(1), start: '20:30', end: '23:00', status: '開催', place: 'Discord ボイス', memo: 'ミナトさんの初 GM' });
  S({ name: '連れて帰る', gm: 'ソラ', members: ['ひより', 'ミナト', 'ユズ'], date: T(5), start: '14:00', end: '18:00', status: '開催', place: 'ユドナリウムアックス', memo: '初めての人も歓迎' });
  S({ name: '灰色の図書館', gm: 'レン', members: ['こまち', 'ユズ', 'ひより'], date: T(12), start: '21:00', end: '23:30', status: '開催', place: 'Discord ボイス', memo: '' });
  // 募集
  var castle = S({ name: '雪原の古城', gm: 'こまち', status: '募集', windowFrom: nextFrom, windowTo: nextMid, memo: '3〜4 人で。ボイスあり' });
  setInterest({ id: castle.id, name: 'ソラ', level: 'want' });
  setInterest({ id: castle.id, name: 'レン', level: 'interest' });
  setInterest({ id: castle.id, name: 'ユズ', level: 'interest' });
  var camp = S({ name: '新キャンペーン顔合わせ', gm: 'ひより', status: '募集', windowFrom: nextMid, windowTo: nextTo, memo: '長いキャンペーンの相談会。見学だけでも' });
  setInterest({ id: camp.id, name: 'ミナト', level: 'want' });
  setInterest({ id: camp.id, name: 'こまち', level: 'interest' });
  // 日程調整
  var maze = S({ name: '迷宮の底へ', gm: 'レン', members: ['ひより', 'ソラ', 'こまち'], status: '調整中', windowFrom: T(18), windowTo: T(32), memo: '候補の期間のどこかで 1 回' });
  startPoll({ id: maze.id, dates: [T(19), T(21), T(24), T(26)], start: '20:00', end: '23:00', me: 'レン' });
  [['ひより', 19, '◯'], ['ひより', 21, '×'], ['ひより', 24, '◯'], ['ソラ', 19, '×'], ['ソラ', 24, '◯'], ['ソラ', 26, '◯']].forEach(function (v) {
    setPollVote({ id: maze.id, ymd: T(v[1]), name: v[0], vote: v[2] });
  });
  // メンバーの予定（都合の悪い日だけ）
  [['ソラ', [2], '×'], ['こまち', [3], '△'], ['レン', [4], '×'], ['ミナト', [0], '△']].forEach(function (b) {
    setAvailabilityBulk({ name: b[0], from: T(0), to: T(59), weekdays: b[1], mark: b[2], keep: true });
  });
  setAvailability('ひより', T(7), '×', '');
  setAvailability('ユズ', T(10), '△', '');
  setAvailNote({ name: 'ソラ', ymd: T(8), text: '21 時からなら参加できます' });
  setDayNote({ ymd: T(5), text: 'ユドナリウムの部屋は前日に作ります', me: 'ソラ' });
  // Discord に送った跡（送ったことにするだけで、どこにも届かない）
  sendDiscordStep({ kind: 'announce', id: port.id, attempt: 1, me: 'ミナト' });
  sendDiscordStep({ kind: 'ask', id: castle.id, attempt: 1, me: 'こまち', message: '' });
  consoleData_ = fullData; refreshAll_ = fullRefresh;
}
