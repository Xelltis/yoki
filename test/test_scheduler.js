// Code.gs を通しで動かす検証
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); OUT.push('ok - ' + msg); }
function sheetOf(name) { return SS.sheets.find(function (x) { return x.name === name; }); }

var dailyTriggers = function () { return TRIGGERS.filter(function (t) { return t.fn === 'dailyNotify'; }); };

// 1. 初期設定
onOpen();               // シート無しの状態でも落ちない
setup();
assert(SS.sheets.map(function (s) { return s.name; }).join(',') === 'カレンダー,一覧,管理,都合,セッション,メンバー,日付メモ,予定メモ,日程調整,設定,シリーズ通知,通知ログ', 'シートの並び: ' + SS.sheets.map(function (s) { return s.name; }).join(','));
assert(sheetOf('設定').getLastRow() === 1 + DEFAULT_SETTINGS.length, '設定の既定値が入る');
setup();                // 2 回目でも壊れない
assert(sheetOf('設定').getLastRow() === 1 + DEFAULT_SETTINGS.length, '設定を 2 回作っても増えない');

// 2. サンプル投入
seedSample();
var sesSheet = sheetOf('セッション');
assert(sesSheet.getLastRow() === 5, 'サンプルの卓が 4 件入る (' + sesSheet.getLastRow() + ')');
assert(sheetOf('メンバー').getLastRow() === 5, 'サンプルのメンバーが 4 人入る');
seedSample();
assert(sesSheet.getLastRow() === 5, 'サンプルを 2 回入れても重複しない');

OUT.push(dumpSheet('カレンダー', 40, 7));
OUT.push(dumpSheet('一覧', 10, 13));
OUT.push(dumpSheet('管理', 30, 10));
OUT.push(dumpSheet('都合', 14, 7));

// 3. カレンダーの内容
var cal = sheetOf('カレンダー');
var found = false, tomorrowKey = ymd_(addDays_(new Date(), 1));
for (var k in cal.cells) { if (String(cal.cells[k]).indexOf('鉄鳴界の夜明け #1') >= 0 && k.split(',')[0] > 3) found = true; }
assert(found, 'カレンダーに明日の卓が描かれる');
assert(cal.getRange(2, 2).getValue() === '全員', '都合の対象は既定で全員');
assert(cal.validations.some(function (v) { return v[0] === 2 && v[1] === 2 && v[4].indexOf('新キャンペーン顔合わせ') >= 0; }), 'B2 のドロップダウンに卓名が入る');

// 4. 都合の対象を卓に切り替え（onEdit 経由）
cal.getRange(2, 2).setValue('新キャンペーン顔合わせ');
onEdit({ range: cal.getRange(2, 2) });
var okCells = 0;
for (var k2 in cal.cells) { if (String(cal.cells[k2]).indexOf('◎ 全員空き') >= 0) okCells++; }
assert(okCells >= 1, '全員空きの日にマークが付く (' + okCells + ' 日)');
assert(cal.getRange(2, 2).getValue() === '新キャンペーン顔合わせ', '対象の選択が更新後も残る');

// 5. 都合の印が保持される
var av = sheetOf('都合');
var before = av.getRange(5, 4).getValue(); // 3 日後のアリス（卓の無い日）
av.getRange(5, 4).setValue('×');
onEdit({ range: av.getRange(5, 4) });
refreshAll();
assert(av.getRange(5, 4).getValue() === '×', '都合の印が更新後も残る (before=' + before + ')');

// 6. 登録ダイアログの保存・更新・削除
showWebAppUrl();
assert(ALERTS[ALERTS.length - 1].indexOf('公開されていません') >= 0, '未公開なら案内を出す');
WEBAPP_URL = 'https://script.google.com/macros/s/mock/exec';
showWebAppUrl();
assert(ALERTS[ALERTS.length - 1] === '[dialog] ウェブアプリ', '公開済みなら URL のダイアログを出す');
var res = saveSession({ name: 'テスト卓', gm: 'ダン', me: 'ダン', members: ['アリス'], extra: 'ゲスト太郎、ボブ', date: ymd_(addDays_(new Date(), 3)), start: '21:00', end: '', status: '開催', place: '', memo: 'm', notify: true });
assert(res.ok && res.id === 'S005', '新規登録で S005 が振られる: ' + res.message);
assert(FETCHES.length === 0, 'Webhook 未設定なら送らない');
var s4 = getSessions_(SS._proxy).filter(function (s) { return s.id === 'S005'; })[0];
assert(s4.members.join('、') === 'アリス、ゲスト太郎、ボブ', '参加者がまとまる: ' + s4.members.join('、'));
assert(s4.start === '21:00' && s4.end === '', '時刻');
var err = null;
try { saveSession({ name: '日付なし', status: '開催', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('開催日') >= 0, '開催なのに日付が無いと弾く');
res = saveSession({ id: 'S005', name: 'テスト卓（改）', gm: 'ダン', members: ['アリス'], extra: '', date: ymd_(addDays_(new Date(), 4)), start: '20:00', end: '23:00', status: '開催', notify: false });
assert(res.ok && res.id === 'S005', '更新しても ID が変わらない');
assert(sesSheet.getLastRow() === 6, '更新で行が増えない');
refreshIfDirty();
var admin = sheetOf('管理');
var adminText = Object.keys(admin.cells).map(function (k) { return String(admin.cells[k]); }).join('\n');
assert(adminText.indexOf('ゲスト太郎') < 0, '更新後は未登録参加者の警告が消える');
res = deleteSession({ id: 'S005', me: 'ダン', notify: false });
assert(sesSheet.getLastRow() === 5, '削除で行が減る');

// 7. 通知
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
onEdit({ range: sheetOf('設定').getRange(2, 2) });
res = saveSession({ name: '通知テスト卓', gm: 'アリス', members: ['ボブ'], extra: '', date: ymd_(addDays_(new Date(), 1)), start: '19:00', end: '22:00', status: '開催', notify: true });
assert(FETCHES.length === 1 && FETCHES[0].body.embeds[0].title === '通知テスト卓', '登録時に Discord へ送る');
sheetOf('メンバー').getRange(2, 2).setValue('123456789012345678'); // アリスの Discord ID
FETCHES.length = 0;
dailyNotify();
assert(FETCHES.length === 1, '前日通知が 1 通にまとまる');
assert(FETCHES[0].body.embeds.length === 2, '明日の卓 2 件が embeds に入る (' + FETCHES[0].body.embeds.length + ')');
assert(FETCHES[0].body.content.indexOf('<@123456789012345678>') >= 0, 'メンションが付く: ' + FETCHES[0].body.content);
var notifiedCount = getSessions_(SS._proxy).filter(function (s) { return s.notified; }).length;
assert(notifiedCount === 2, '通知済みの印が付く (' + notifiedCount + ')');
dailyNotify();
assert(FETCHES.length === 1, '同じ日に 2 回走っても送り直さない');
var listText = Object.keys(sheetOf('一覧').cells).map(function (k) { return String(sheetOf('一覧').cells[k]); }).join('\n');
assert(listText.indexOf('済 ') >= 0, '一覧に通知済みが出る');
var calText = Object.keys(cal.cells).map(function (k) { return String(cal.cells[k]); }).join('\n');
assert(calText.indexOf('開催前の知らせ 送信済み') >= 0, 'お知らせに送信済みが出る');
FETCH_CODE = 400;
FETCHES.length = 0;
UI_ANSWER = 'OK';
notifyTomorrowNow();
assert(ALERTS[ALERTS.length - 1].indexOf('失敗') >= 0, '失敗時はアラートに出る: ' + ALERTS[ALERTS.length - 1]);
assert(sheetOf('通知ログ').getLastRow() >= 4, '通知ログに残る');
FETCH_CODE = 204;
testDiscord();

// 8. トリガー
installTriggers();
assert(dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1, '前日通知のトリガーは毎時の見回りが 1 つ');
installTriggers();
assert(dailyTriggers().length === 1, '2 回設定しても 1 つ');
assert(String(getSettings_(SS._proxy)['自動通知の設定者']).indexOf('tester@example.com') >= 0, '設定者が書かれる');
removeTriggers();
assert(dailyTriggers().length === 0, '解除できる');

// 9. 表示月数を 12 にしても落ちない
sheetOf('設定').getRange(5, 2).setValue(12);
sheetOf('設定').getRange(6, 2).setValue(366);
refreshAll();
assert(sheetOf('都合').getLastRow() === 367, '都合 366 日');
sheetOf('設定').getRange(5, 2).setValue(2);
sheetOf('設定').getRange(6, 2).setValue(60);

// 10. 手入力の揺れ: 開催日を文字列、時刻を Date、状態を空で
sesSheet.appendRow(['', '手入力卓', 'カレン', 'アリス,ボブ', '2026/10/03', new Date(1899, 11, 30, 19, 30), 0.9375, '', '', '', '', '', '']);
refreshAll();
var manual = getSessions_(SS._proxy).filter(function (s) { return s.name === '手入力卓'; })[0];
assert(manual && manual.ymd === '2026-10-03' && manual.start === '19:30' && manual.end === '22:30' && manual.status === '開催', '手入力の揺れを読める: ' + JSON.stringify([manual.ymd, manual.start, manual.end, manual.status]));

// 11. メンバー 0 人・卓 0 件でも表示が組める
var empty = new Spreadsheet('空');
empty.sheets.push(new Sheet(empty, 'Sheet1'));
var keep = SS; SS = empty;
setup();
assert(SS.sheets.length === 12 && !SS.sheets.some(function (s) { return s.name === 'Sheet1'; }), '空のシートは消え、12 枚になる');
OUT.push(dumpSheet('管理', 20, 6));
OUT.push(dumpSheet('一覧', 4, 13));
SS = keep;

// 12. Web アプリ
SS = keep;
var page = doGet();
assert(page.name === 'Console', 'doGet が Console.html を返す');
var tut = doGet({ parameter: { page: 'tutorial' } });
assert(tut.name === 'Tutorial' && tut.title === '卓予定の使い方' && tut.appended.indexOf('window.APP_URL = "' + WEBAPP_URL + '"') >= 0, '?page=tutorial で使い方のページを返し、アプリの URL を渡す');
assert(doGet({ parameter: {} }).name === 'Console' && doGet({ parameter: { page: 'other' } }).name === 'Console', 'ほかの page は画面を返す');
var cd = getConsoleData();
assert(cd.appUrl === WEBAPP_URL, '画面用データにウェブアプリの URL が載る（使い方のページへのリンク用）');
assert(cd.members.length === 4 && cd.sessions.length >= 4 && cd.availDays.length === 60 && cd.today === ymd_(new Date()), 'コンソール用データ');
assert(typeof cd.avail === 'object' && cd.statuses.join(',') === '募集,調整中,開催,終了,中止' && cd.webhookSet === true, 'コンソール用データの付随項目');
var day3 = cd.availDays[3];
var r12 = setAvailability('ダン', day3, '△');
assert(r12.ok && getAvailability_(SS._proxy)[day3]['ダン'] === '△', 'コンソールから都合を書ける');
setAvailability('ダン', day3, '');
assert(!getAvailability_(SS._proxy)[day3]['ダン'], '空にできる');
err = null; try { setAvailability('いない人', day3, '△'); } catch (e) { err = e.message; }
assert(err && err.indexOf('メンバー') >= 0, 'メンバーに無い名前は弾く: ' + err);
err = null; try { setAvailability('ダン', '2030-01-01', '△'); } catch (e) { err = e.message; }
assert(err && err.indexOf('範囲外') >= 0, '都合表の範囲外は弾く');
err = null; try { setAvailability('ダン', day3, '◎'); } catch (e) { err = e.message; }
assert(err && err.indexOf('印') >= 0, '不正な印は弾く');
// アクティブが取れない（Web アプリ）状況でも、シート側で一度メニューを実行していれば ID から引ける
refreshAll();
ACTIVE_AVAILABLE = false;
var cd2 = getConsoleData();
assert(cd2.title === '卓予定テスト', 'アクティブ無しでも Script Properties の ID で開ける');
var res12 = saveSession({ name: 'Webから', gm: 'ボブ', members: ['ダン'], extra: '', date: ymd_(addDays_(new Date(), 5)), start: '20:00', end: '', status: '開催', notify: false, me: 'ボブ' });
assert(res12.ok, 'Web アプリからも登録できる: ' + res12.message);
ACTIVE_AVAILABLE = true;

// 13. メンバーの追加・更新・削除（コンソールから）
ACTIVE_AVAILABLE = true;
var m1 = saveMember({ name: 'エマ', discordId: '<@987654321098765432>', note: '新人' });
assert(m1.ok && getMembers_(SS._proxy).some(function (m) { return m.name === 'エマ' && m.discordId === '987654321098765432'; }), 'メンバーを追加できる。<@ > は剥がす');
assert(m1.data && m1.data.members.some(function (m) { return m.name === 'エマ'; }), '返事に最新のデータが同梱される');
refreshIfDirty();
assert(sheetOf('都合').getRange(1, sheetOf('都合').getLastColumn()).getValue() === 'エマ', '都合表に列が増える（描き直し後）');
err = null; try { saveMember({ name: 'エマ' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('同じ名前') >= 0, '重複は弾く');
err = null; try { saveMember({ name: 'A、B' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('区切り') >= 0, '区切り文字入りの名前は弾く');
err = null; try { saveMember({ name: 'フー', discordId: 'abc' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('数字') >= 0, 'Discord ID が数字でなければ弾く');
// 名前の変更が卓と都合に追随する
sheetOf('都合').getRange(2, 4).setValue('△'); // アリスの今日
var m2 = saveMember({ oldName: 'アリス', name: 'アリシア', discordId: '123456789012345678', note: '' });
assert(m2.ok, '名前を変えられる: ' + m2.message);
var afterRename = getSessions_(SS._proxy);
assert(afterRename.some(function (s) { return s.gm === 'アリシア'; }) && !afterRename.some(function (s) { return s.gm === 'アリス' || s.members.indexOf('アリス') >= 0; }), '卓の GM・参加者も新しい名前になる');
assert(getAvailability_(SS._proxy)[ymd_(new Date())]['アリシア'] === '△', '都合の印が新しい名前に引き継がれる');
var m3 = deleteMember({ name: 'エマ' });
assert(m3.ok && !getMembers_(SS._proxy).some(function (m) { return m.name === 'エマ'; }), 'メンバーを消せる');
err = null; try { deleteMember({ name: 'いない' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('見つかりません') >= 0, '無い名前の削除は弾く');
var cd3 = getConsoleData();
assert(cd3.members.some(function (m) { return m.name === 'アリシア' && m.discordId === '123456789012345678'; }), 'コンソール用データに Discord ID が載る');

// 14. 都合表の「参」「GM」
refreshAll();
var avs = sheetOf('都合');
var hdr = avs.getRange(1, 1, 1, avs.getLastColumn()).getValues()[0];
var tomorrowRow = 3; // 2 行目が今日
var colOf = function (n) { return hdr.indexOf(n) + 1; };
assert(avs.getRange(tomorrowRow, colOf('アリシア')).getValue() === 'GM', '明日の卓の GM は「GM」');
assert(avs.getRange(tomorrowRow, colOf('ボブ')).getValue() === '参', '明日の卓の参加者は「参」');
assert(availabilityMap_(loadContext_(SS._proxy), TARGET_ALL)[ymd_(addDays_(new Date(), 1))] === undefined, '卓に入っている日は全員空きにならない');
err = null; try { setAvailability('ボブ', ymd_(addDays_(new Date(), 1)), '△'); } catch (e) { err = e.message; }
assert(err && err.indexOf('卓に入っている') >= 0, 'コンソールからは参のマスを変えられない');
avs.getRange(tomorrowRow, colOf('ボブ')).setValue('△');
onEdit({ range: avs.getRange(tomorrowRow, colOf('ボブ')) });
assert(avs.getRange(tomorrowRow, colOf('ボブ')).getValue() === '参', 'シートで参を書き換えても戻る');
var cd4 = getConsoleData();
assert(cd4.booked[ymd_(addDays_(new Date(), 1))]['ボブ'] === '参', 'コンソール用データに booked が載る');

// 15. 一括変更
var before15 = getSessions_(SS._proxy);
var idsAll = before15.filter(function (s) { return s.status === '開催'; }).map(function (s) { return s.id; });
assert(idsAll.length >= 3, '一括変更の対象が 3 件以上ある (' + idsAll.length + ')');
err = null; try { bulkUpdateSessions({ ids: [], action: 'status', value: '終了' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('選んで') >= 0, '未選択は弾く');
var adjId = before15.filter(function (s) { return s.status === '募集'; })[0].id;
err = null; try { bulkUpdateSessions({ ids: [adjId], action: 'status', value: '開催' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('開催日が無い') >= 0, '日付の無い卓を開催にはできない: ' + err);
var b1 = bulkUpdateSessions({ ids: idsAll.slice(0, 2), action: 'addMember', value: 'ダン', me: 'ダン' });
assert(b1.ok && b1.count === 2 && getSessions_(SS._proxy).filter(function (s) { return idsAll.slice(0, 2).indexOf(s.id) >= 0; }).every(function (s) { return s.members.indexOf('ダン') >= 0 && s.editor === 'ダン'; }), '参加者を一括で追加: ' + b1.message);
var b2 = bulkUpdateSessions({ ids: idsAll.slice(0, 2), action: 'removeMember', value: 'ダン' });
assert(b2.ok && getSessions_(SS._proxy).filter(function (s) { return idsAll.slice(0, 2).indexOf(s.id) >= 0; }).every(function (s) { return s.members.indexOf('ダン') < 0; }), '参加者を一括で外す');
var firstId = idsAll[0];
var d0 = getSessions_(SS._proxy).filter(function (s) { return s.id === firstId; })[0];
var b3 = bulkUpdateSessions({ ids: [firstId], action: 'shiftDays', value: '7' });
var d1 = getSessions_(SS._proxy).filter(function (s) { return s.id === firstId; })[0];
assert(b3.ok && daysBetween_(d0.date, d1.date) === 7 && !d1.notified, '開催日を 7 日ずらし、前日通知の印が消える');
err = null; try { bulkUpdateSessions({ ids: [firstId], action: 'shiftDays', value: 'x' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日数') >= 0, '日数でなければ弾く');
var b4 = bulkUpdateSessions({ ids: [firstId], action: 'setGm', value: 'カレン' });
assert(b4.ok && getSessions_(SS._proxy).filter(function (s) { return s.id === firstId; })[0].gm === 'カレン', 'GM を一括で変える');
FETCHES.length = 0;
var b5 = bulkUpdateSessions({ ids: idsAll, action: 'status', value: '終了', notify: true, me: 'ボブ' });
assert(b5.ok && b5.count === idsAll.length && getSessions_(SS._proxy).filter(function (s) { return idsAll.indexOf(s.id) >= 0; }).every(function (s) { return s.status === '終了'; }), '状態を一括で終了に: ' + b5.message);
assert(FETCHES.length === 1 && FETCHES[0].body.content.indexOf('一括で') >= 0, '一括変更の Discord 通知が 1 通');
var rowsBefore = sheetOf('セッション').getLastRow();
var b6 = bulkUpdateSessions({ ids: idsAll.slice(0, 2), action: 'delete' });
assert(b6.ok && sheetOf('セッション').getLastRow() === rowsBefore - 2, '一括で削除して行が 2 減る');
assert(getSessions_(SS._proxy).every(function (s) { return idsAll.slice(0, 2).indexOf(s.id) < 0; }), '消した卓は残らない');

// 16. 卓 1 件の案内をいま送る
var left = getSessions_(SS._proxy);
var adj16 = left.filter(function (s) { return s.status === '募集'; })[0];
FETCHES.length = 0;
var n1 = notifySessionNow({ id: adj16.id, me: 'カレン' });
assert(n1.ok && FETCHES.length === 1 && FETCHES[0].body.embeds[0].title.indexOf(adj16.name) === 0 && FETCHES[0].body.content.indexOf('by カレン') >= 0, '案内を 1 通送る: ' + n1.message);
assert(!getSessions_(SS._proxy).filter(function (s) { return s.id === adj16.id; })[0].notified, '明日の卓でなければ前日通知の印は付かない');
var t16 = saveSession({ name: '明日の案内テスト', gm: 'ボブ', members: ['ダン'], extra: '', date: ymd_(addDays_(new Date(), 1)), start: '19:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
var n2 = notifySessionNow({ id: t16.id });
assert(n2.ok && getSessions_(SS._proxy).filter(function (s) { return s.id === t16.id; })[0].notified, '明日の卓なら前日通知済みになる: ' + n2.message);
err = null; try { notifySessionNow({ id: 'S999' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('見つかりません') >= 0, '無い卓は弾く');
FETCH_CODE = 500;
err = null; try { notifySessionNow({ id: t16.id }); } catch (e) { err = e.message; }
assert(err && err.indexOf('失敗') >= 0, '送信失敗はエラーで返す');
FETCH_CODE = 204;

// 17. メンバーの予定をまとめて入れる
var avb = sheetOf('都合');
var hdr17 = avb.getRange(1, 1, 1, avb.getLastColumn()).getValues()[0];
var colDan = hdr17.indexOf('ダン') + 1;
var days17 = avb.getLastRow() - 1;
avb.getRange(2, colDan, days17, 1).setValues(Array.apply(null, Array(days17)).map(function () { return ['']; }));
refreshAll(); // 参/GM を戻す
var f17 = ymd_(new Date()), t17 = ymd_(addDays_(new Date(), 13));
var ab1 = setAvailabilityBulk({ name: 'ダン', from: f17, to: t17, weekdays: [0, 6], mark: '×', keep: true });
var vals17 = avb.getRange(2, colDan, 14, 1).getValues().map(function (r) { return String(r[0]); });
var dates17 = avb.getRange(2, 1, 14, 1).getValues().map(function (r) { return toDate_(r[0]); });
var okWeekend = vals17.every(function (v, i) { var wk = dates17[i].getDay() === 0 || dates17[i].getDay() === 6; var bk = bookedMap_(loadContext_(SS._proxy))[ymd_(dates17[i])] || {}; if (bk['ダン']) return v === bk['ダン']; return wk ? v === '×' : v === ''; });
assert(ab1.ok && okWeekend, '土日だけ ○ が入り、卓の日は飛ばす: ' + ab1.message);
var ab2 = setAvailabilityBulk({ name: 'ダン', from: f17, to: t17, weekdays: [0, 1, 2, 3, 4, 5, 6], mark: '△', keep: true });
var vals17b = avb.getRange(2, colDan, 14, 1).getValues().map(function (r) { return String(r[0]); });
assert(ab2.ok && ab2.skippedKeep > 0 && vals17b.every(function (v, i) { return v !== '' && (v !== '△' || vals17[i] === ''); }), '入力済みを残して残りに △: ' + ab2.message);
var ab3 = setAvailabilityBulk({ name: 'ダン', from: f17, to: t17, weekdays: [0, 1, 2, 3, 4, 5, 6], mark: '×', keep: false });
var vals17c = avb.getRange(2, colDan, 14, 1).getValues().map(function (r) { return String(r[0]); });
assert(ab3.ok && vals17c.every(function (v) { return v === '×' || v === '参' || v === 'GM'; }), '上書きすると全部 × になる（参/GM は残る）: ' + ab3.message);
var ab4 = setAvailabilityBulk({ name: 'ダン', from: f17, to: t17, weekdays: [0, 1, 2, 3, 4, 5, 6], mark: '', keep: false });
assert(ab4.ok && avb.getRange(2, colDan, 14, 1).getValues().every(function (r) { return r[0] === '' || r[0] === '参' || r[0] === 'GM'; }), '空にできる');
err = null; try { setAvailabilityBulk({ name: 'ダン', from: t17, to: f17, mark: '△' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('期間') >= 0, '逆の期間は弾く');
err = null; try { setAvailabilityBulk({ name: 'ダン', from: f17, to: t17, weekdays: [], mark: '△' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('曜日') >= 0, '曜日なしは弾く');
err = null; try { setAvailabilityBulk({ name: '', from: f17, to: t17, mark: '△' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('名前') >= 0, '名前なしは弾く');

// 18. 設定タブ
TRIGGERS.length = 0;
setSetting_(SS._proxy, '自動通知の設定者', '');
var cd18 = getConsoleData();
assert(cd18.settings.webhookMasked.indexOf('…') >= 0 && cd18.settings.notifyHour === 20 && cd18.settings.triggerMine === false && cd18.settings.setter === '', '設定の初期値が載る');
var an1 = setAutoNotify({ enabled: true, hour: '21', me: 'カレン' });
assert(an1.ok && dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1 && getSettings_(SS._proxy)['開催前の知らせ（時刻）'] === 21 && an1.setter.indexOf('カレン') === 0, 'コンソールから自動通知を有効にできる（毎時の見回り、基本の時刻は 21）: ' + an1.message);
assert(getConsoleData().settings.triggerMine === true, '有効化後は triggerMine が true');
var sc1 = saveConsoleSettings({ hour: '7', notifyOnSave: false, calMonths: '3', availDays: '90' });
assert(sc1.ok && dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1 && getSettings_(SS._proxy)['開催前の知らせ（時刻）'] === 7, '時刻を変えても見回りのトリガーは 1 本のまま、時刻は設定に入る: ' + sc1.message);
assert(!isOn_(getSettings_(SS._proxy)['登録時にDiscordへ通知']) && getSettings_(SS._proxy)['カレンダーの表示月数'] === 3 && sheetOf('都合').getLastRow() === 91, '通知の既定・表示月数・予定の日数が保存される');
err = null; try { saveConsoleSettings({ webhook: 'https://example.com/hook' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('Webhook URL の形') >= 0, 'Discord 以外の URL は弾く');
var sc2 = saveConsoleSettings({ webhook: 'https://discord.com/api/webhooks/1/abc' });
assert(sc2.ok && getSettings_(SS._proxy)['Discord Webhook URL'] === 'https://discord.com/api/webhooks/1/abc', 'Webhook URL を保存できる');
var sc3 = saveConsoleSettings({ webhook: '', clearWebhook: false });
assert(sc3.ok && getSettings_(SS._proxy)['Discord Webhook URL'] === 'https://discord.com/api/webhooks/1/abc', '空欄のままなら URL は消えない');
FETCHES.length = 0;
var td = testDiscordConsole();
assert(td.ok && FETCHES.length === 1, 'コンソールから接続テスト');
var sc4 = saveConsoleSettings({ webhook: '', clearWebhook: true });
assert(sc4.ok && getSettings_(SS._proxy)['Discord Webhook URL'] === '', '明示すれば URL を空にできる');
err = null; try { testDiscordConsole(); } catch (e) { err = e.message; }
assert(err && err.indexOf('空') >= 0, 'URL が空なら接続テストは弾く');
var an2 = setAutoNotify({ enabled: false });
assert(an2.ok && dailyTriggers().length === 0 && getSettings_(SS._proxy)['自動通知の設定者'] === '', 'コンソールから解除できる');
setSetting_(SS._proxy, '自動通知の設定者', 'someone@example.com / 2026/01/01 00:00');
var an3 = setAutoNotify({ enabled: false });
assert(!an3.ok && an3.message.indexOf('別のアカウント') >= 0, '他人が設定した分は解除できず案内する');
setSetting_(SS._proxy, '自動通知の設定者', '');
saveConsoleSettings({ hour: '20', notifyOnSave: true, calMonths: '2', availDays: '60' });
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');

// 19. 祝日
var h26 = jpHolidays_(2026);
assert(h26['2026-01-01'] === '元日' && h26['2026-01-12'] === '成人の日' && h26['2026-03-20'] === '春分の日' && h26['2026-09-23'] === '秋分の日', '2026 年の固定祝日・成人の日・春分・秋分');
assert(h26['2026-05-06'] === '振替休日', '2026/5/3 が日曜なので 5/6 が振替休日');
assert(h26['2026-09-21'] === '敬老の日' && h26['2026-09-22'] === '国民の休日', '2026 年のシルバーウィーク（9/22 が国民の休日）');
assert(!h26['2026-09-09'] && Object.keys(h26).length >= 18, '平日は祝日でない');
var h25 = jpHolidays_(2025);
assert(h25['2025-11-24'] === '振替休日' && h25['2025-07-21'] === '海の日' && h25['2025-10-13'] === 'スポーツの日', '2025 年の振替休日・海の日・スポーツの日');
refreshAll();
var avh = sheetOf('都合');
var dates19 = avh.getRange(2, 1, avh.getLastRow() - 1, 2).getValues();
var holRow = dates19.filter(function (r) { return String(r[1]).indexOf('祝') >= 0; });
assert(holRow.length >= 1 && holidayName_(toDate_(holRow[0][0])), '都合シートの曜日に「祝」が付く (' + holRow.length + ' 日)');

// 22. 日付メモ
var nd = ymd_(addDays_(new Date(), 4));
var n1 = setDayNote({ ymd: nd, text: '合宿の下見', me: 'カレン' });
assert(n1.ok && getDayNotes_(SS._proxy)[nd].text === '合宿の下見' && getDayNotes_(SS._proxy)[nd].by === 'カレン', 'メモを書けて、書いた人が残る');
var rows22 = sheetOf('日付メモ').getLastRow();
setDayNote({ ymd: nd, text: '合宿の下見（宿を予約した）' });
assert(sheetOf('日付メモ').getLastRow() === rows22 && getDayNotes_(SS._proxy)[nd].text.indexOf('宿を予約') > 0, '同じ日に書き直しても行は増えない');
refreshIfDirty();
var calText22 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText22.indexOf('📝 合宿の下見') >= 0, 'カレンダーシートにメモが出る');
assert(getConsoleData().notes[nd].text.indexOf('合宿') === 0, 'コンソール用データにメモが載る');
setDayNote({ ymd: nd, text: '' });
assert(!getDayNotes_(SS._proxy)[nd] && sheetOf('日付メモ').getLastRow() === rows22 - 1, '空にすると消える');
err = null; try { setDayNote({ ymd: 'x', text: 'a' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日付が読めません') >= 0, '読めない日付は弾く');
var long22 = new Array(520).join('あ');
err = null; try { setDayNote({ ymd: nd, text: long22 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('500 文字') >= 0, '長すぎるメモは弾く');

// 23. 過ぎた卓は自動で終了。カレンダーには残る
var past1 = saveSession({ name: '過ぎた卓A', gm: 'カレン', members: ['ダン'], extra: '', date: ymd_(addDays_(new Date(), -3)), start: '20:00', end: '', status: '開催' });
var past2 = saveSession({ name: '過ぎた卓B', gm: 'ボブ', members: [], extra: '', date: ymd_(addDays_(new Date(), -1)), start: '13:00', end: '', status: '開催' });
var todaySes = saveSession({ name: '今日の卓', gm: 'カレン', members: [], extra: '', date: ymd_(new Date()), start: '21:00', end: '', status: '開催' });
var st23 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0].status; };
assert(st23(past1.id) === '終了' && st23(past2.id) === '終了', '開催日が過ぎた卓は保存の時点で終了になる');
assert(st23(todaySes.id) === '開催', '今日の卓は「開催」になる（終了にはしない）');
// 手で「予定」に戻してもう一度確かめる
sheetOf('セッション').getRange(getSessions_(SS._proxy).filter(function (s) { return s.id === past1.id; })[0].row, SC.STATUS + 1).setValue('開催');
assert(st23(past1.id) === '開催', '手で開催に戻せる');
var n23 = autoFinishPast_(loadContext_(SS._proxy));
assert(n23 === 1 && st23(past1.id) === '終了', '表示の作り直しで終了になる（' + n23 + ' 件）');
assert(autoFinishPast_(loadContext_(SS._proxy)) === 0, '二度目は何もしない');
// カレンダーに残る
refreshIfDirty();
var calText23 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText23.indexOf('済 20:00 過ぎた卓A') >= 0 && calText23.indexOf('済 13:00 過ぎた卓B') >= 0, 'カレンダーに「済」付きで残る');
// 中止も残る
var cancelId = saveSession({ name: '中止の卓', gm: 'ボブ', members: [], extra: '', date: ymd_(addDays_(new Date(), 5)), start: '19:00', end: '', status: '中止' });
refreshAll();
calText23 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText23.indexOf('中止 19:00 中止の卓') >= 0, '中止の卓もカレンダーに残る');
// 一覧からは消える
var listText23 = Object.keys(sheetOf('一覧').cells).map(function (k) { return String(sheetOf('一覧').cells[k]); }).join('\n');
assert(listText23.indexOf('過ぎた卓A') < 0 && listText23.indexOf('今日の卓') >= 0, '一覧には稼働中の卓だけが並ぶ');
// コンソール用データにも終了の卓が載る
var cd23 = getConsoleData();
assert(cd23.sessions.some(function (s) { return s.id === past1.id && s.status === '終了'; }), 'コンソール用データに終了の卓が載る');
assert(cd23.settings.autoFinish === true, '設定タブに自動終了の状態が載る');
// 設定で止められる
saveConsoleSettings({ autoFinish: false });
sheetOf('セッション').getRange(getSessions_(SS._proxy).filter(function (s) { return s.id === past1.id; })[0].row, SC.STATUS + 1).setValue('開催');
assert(autoFinishPast_(loadContext_(SS._proxy)) === 0 && st23(past1.id) === '開催', 'OFF にすると自動で終了にしない');
saveConsoleSettings({ autoFinish: true });
refreshAll();
assert(st23(past1.id) === '終了', 'ON に戻すとまた終了になる');
// 日程未定（募集）は触らない
var adj23 = getSessions_(SS._proxy).filter(function (s) { return s.status === '募集'; })[0];
assert(adj23, '募集の卓は残っている');

// 24. 描き直しは「あとで」。登録は行を書くだけで、返事に最新データが付く
delete SPROPS[DIRTY_KEY];
TRIGGERS = TRIGGERS.filter(function (t) { return t.fn !== 'refreshIfDirty'; });
var calBefore = JSON.stringify(sheetOf('カレンダー').cells);
CALLS = {};
var r24 = saveSession({ name: '軽い登録', gm: 'カレン', members: ['ダン'], extra: '', date: ymd_(addDays_(new Date(), 15)), start: '20:00', end: '', status: '開催', notify: false });
var sheetCalls24 = Object.keys(CALLS).filter(function (k) { return /^(Sheet|Range|Spreadsheet)\./.test(k) && !/\._/.test(k); }).reduce(function (a, k) { return a + CALLS[k]; }, 0);
assert(r24.ok && sheetCalls24 < 80, '登録 1 回のシート操作が 80 回未満（' + sheetCalls24 + ' 回）');
assert(JSON.stringify(sheetOf('カレンダー').cells) === calBefore, '登録の時点ではカレンダーシートは描き直されない');
assert(SPROPS[DIRTY_KEY] === '1', '「あとで描き直す」の印が付く');
assert(TRIGGERS.some(function (t) { return t.fn === 'refreshIfDirty' && t.minutes === 10; }), '10 分おきのトリガーが 1 本できる');
saveSession({ name: '軽い登録 2', gm: 'カレン', members: [], extra: '', date: ymd_(addDays_(new Date(), 16)), start: '20:00', end: '', status: '開催', notify: false });
assert(TRIGGERS.filter(function (t) { return t.fn === 'refreshIfDirty'; }).length === 1, '2 回書いてもトリガーは増えない');
assert(r24.data && r24.data.sessions.some(function (s) { return s.id === r24.id && s.name === '軽い登録'; }), '返事の data に登録した卓が入っている');
assert(r24.data.sessions.every(function (s) { return s.hash === undefined; }) && r24.data.today === ymd_(new Date()), '返事の data は getConsoleData と同じ形');
var did = refreshIfDirty();
assert(did === true && JSON.stringify(sheetOf('カレンダー').cells).indexOf('軽い登録') >= 0, 'トリガーの描き直しでカレンダーシートに出る');
assert(SPROPS[DIRTY_KEY] === undefined, '描き直したら印が消える');
assert(refreshIfDirty() === false, '印が無ければ何もしない');
// メンバーを足した直後でも、その人の予定を書ける（都合シートに列が無くても作り直す）
saveMember({ name: 'ジョージ', discordId: '', note: '' });
var r24b = setAvailability('ジョージ', ymd_(addDays_(new Date(), 3)), '△');
assert(r24b.ok && getAvailability_(SS._proxy)[ymd_(addDays_(new Date(), 3))]['ジョージ'] === '△', '足した直後のメンバーの予定も書ける');
deleteMember({ name: 'ジョージ' });
// 予定の日数を変えたときは、都合シートの行はその場で作り直す
saveConsoleSettings({ availDays: '90' });
assert(sheetOf('都合').getLastRow() === 91, '予定の日数を変えると都合シートは即座に 90 日になる');
saveConsoleSettings({ availDays: '60' });
// シートを開いたときの描き直しでも印が消える
saveSession({ name: '軽い登録 3', gm: 'カレン', members: [], extra: '', date: ymd_(addDays_(new Date(), 17)), start: '20:00', end: '', status: '開催', notify: false });
assert(SPROPS[DIRTY_KEY] === '1', '印が付いた');
onOpen();
assert(SPROPS[DIRTY_KEY] === undefined, 'シートを開いたときの描き直しで印が消える');

// 25. Discord: ID 未登録の参加者が混ざっていても送れる。送らなかった理由と失敗の見当がログに残る
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
var mem25 = sheetOf('メンバー');
var names25 = mem25.getRange(2, 1, mem25.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
mem25.getRange(2, 2, mem25.getLastRow() - 1, 1).setValues(names25.map(function () { return ['']; }));
mem25.getRange(2, 2).setValue('123456789012345678'); // 先頭の人だけ ID あり
var first25 = names25[0];
var day25 = ymd_(addDays_(new Date(), 1));
var others25 = names25.slice(1, 3);
var s25 = saveSession({ name: 'ID混在の卓', gm: first25, members: others25, extra: '未登録の人', date: day25, start: '20:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
var msg25 = sendTomorrow_(loadContext_(SS._proxy), true);
assert(FETCHES.length === 1 && msg25.indexOf('送りました') === 0, 'ID の無い参加者や未登録の人が混ざっていても前日通知は送れる: ' + msg25);
var body25 = FETCHES[0].body;
assert(body25.content.indexOf('<@123456789012345678>') >= 0 && (body25.content.match(/<@/g) || []).length === 1, 'メンションは ID のある人だけ（他は名前で載る）');
assert(body25.embeds.some(function (e) { return e.title.indexOf('ID混在の卓') === 0 && e.description.indexOf('未登録の人') >= 0; }), '未登録の人も本文には名前で載る');
mem25.getRange(2, 2).setValue('');
FETCHES.length = 0;
assert(sendTomorrow_(loadContext_(SS._proxy), true).indexOf('送りました') === 0 && FETCHES.length === 1 && FETCHES[0].body.content.indexOf('<@') < 0, '全員 ID 無しでも送れる（メンション無し）');
// 送らなかったときも跡が残る
var log25 = sheetOf('通知ログ');
var rows25 = log25.getLastRow();
var r25 = sendTomorrow_(loadContext_(SS._proxy), false);
assert(r25.indexOf('送信済み') >= 0 && log25.getLastRow() === rows25 + 1 && String(log25.getRange(rows25 + 1, 4).getValue()).indexOf('送らず') === 0, 'すべて送信済みのときも通知ログに「送らず」と理由が残る');
sheetOf('設定').getRange(2, 2).setValue('');
rows25 = log25.getLastRow();
sendTomorrow_(loadContext_(SS._proxy), true);
assert(String(log25.getRange(rows25 + 1, 4).getValue()).indexOf('Webhook URL が空') > 0, 'URL が空のときも理由が残る');
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
// 失敗の見当
FETCH_CODE = 404; rows25 = log25.getLastRow();
sendTomorrow_(loadContext_(SS._proxy), true);
assert(String(log25.getRange(rows25 + 1, 4).getValue()).indexOf('Webhook URL が違うか') > 0, '404 には「URL が違う」の見当が付く');
FETCH_CODE = 400; rows25 = log25.getLastRow();
sendTomorrow_(loadContext_(SS._proxy), true);
assert(String(log25.getRange(rows25 + 1, 4).getValue()).indexOf('受け付けませんでした') > 0, '400 には「本文」の見当が付く');
FETCH_CODE = 204;
assert(discordHint_(0, 'Exception: Required permissions: https://www.googleapis.com/auth/script.external_request').indexOf('承認') > 0, '承認不足のエラーには「承認」の見当が付く');
// 画面に渡す情報
mem25.getRange(2, 2).setValue('12345');
var cd25 = getConsoleData();
assert(cd25.log.length >= 5 && cd25.log[0].at && cd25.log[0].result, 'コンソール用データに通知ログの最新分が載る（' + cd25.log.length + ' 件）');
assert(cd25.members.some(function (m) { return m.name === first25 && m.idOk === false; }), '桁のおかしい ID には印が付く');
mem25.getRange(2, 2).setValue('123456789012345678');
assert(getConsoleData().members.filter(function (m) { return m.name === first25; })[0].idOk === true, '18 桁なら印は付かない');
assert(getConsoleData().members.filter(function (m) { return m.name === names25[1]; })[0].idOk === true, 'ID 未設定は印を付けない');
// 数値セルに入れて桁が丸まった ID も検出できる
mem25.getRange(2, 2).setValue(1.2345678901234568e17);
var idText25 = getMembers_(SS._proxy).filter(function (m) { return m.name === first25; })[0].discordId;
assert(/^\d+$/.test(idText25) === false || idText25.length < 17 || idText25.slice(-1) === '0', '数値として入った ID は文字列として読まれる: ' + idText25);
mem25.getRange(2, 2).setValue('123456789012345678');

// 26. Discord: 429（Cloudflare 1015）や 5xx は待って送り直す
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
var ctx26 = loadContext_(SS._proxy);
var log26 = sheetOf('通知ログ');
var lastLog = function () { return String(log26.getRange(log26.getLastRow(), 4).getValue()); };
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 429, 204];
assert(postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-') === true, '429 が 2 回続いても 3 回目で通る');
assert(FETCHES.length === 3 && SLEEPS.length === 2 && SLEEPS[0] === 3000 && SLEEPS[1] === 8000, '3 回送り、間に約 3 秒と約 8 秒待つ: ' + JSON.stringify(SLEEPS));
assert(lastLog() === 'OK (204)（3 回目）', 'ログに何回目で通ったかが残る: ' + lastLog());
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 429, 429];
assert(postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-') === false && FETCHES.length === 3, '3 回とも 429 なら失敗で終わる');
assert(lastLog().indexOf('送信失敗（Discord 側の制限）: HTTP 429 error code: 1015（3 回目、打ち止め）') === 0 && lastLog().indexOf('Cloudflare') > 0 && lastLog().indexOf('このツールの不具合ではありません') > 0, '種類が先に出て、ツールの不具合でない旨が付く: ' + lastLog().slice(0, 80));
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [503, 204];
assert(postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-') === true && FETCHES.length === 2 && SLEEPS.length === 1, '5xx も 1 回待って送り直す');
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [400];
assert(postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-') === false && FETCHES.length === 1 && SLEEPS.length === 0, '400 は送り直さない');
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [404];
assert(postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-') === false && FETCHES.length === 1, '404 も送り直さない');
// Retry-After を尊重する（上限 15 秒）
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 204]; FETCH_HEADERS = { 'Retry-After': '5' };
postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-');
assert(SLEEPS[0] === 5000, 'Retry-After: 5 なら 5 秒待つ: ' + SLEEPS[0]);
FETCH_HEADERS = { 'Retry-After': '120' }; FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 204];
postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-');
assert(SLEEPS[0] === 15000, '長すぎる Retry-After は 15 秒に抑える: ' + SLEEPS[0]);
FETCH_HEADERS = {}; FETCH_BODY = '{"message":"You are being rate limited.","retry_after":2.5,"global":false}';
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 204];
postDiscord_(ctx26, { content: 'x' }, '接続テスト', '-');
assert(SLEEPS[0] === 3000, 'Discord 本体の retry_after（2.5 秒）より既定の 3 秒が長ければ 3 秒: ' + SLEEPS[0]);
FETCH_BODY = null;
// 前日通知でも同じ（失敗したら通知済みの印は付けない）
var t26 = saveSession({ name: 'やり直し確認', gm: 'カレン', members: [], extra: '', date: ymd_(addDays_(new Date(), 1)), start: '20:00', end: '', status: '開催', notify: false });
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 204];
var r26 = sendTomorrow_(loadContext_(SS._proxy), true);
assert(r26.indexOf('送りました') === 0 && FETCHES.length === 2, '前日通知も送り直して通る');
assert(getSessions_(SS._proxy).filter(function (s) { return s.id === t26.id; })[0].notified, '通ったので通知済みになる');
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429, 429, 429];
sheetOf('セッション').getRange(getSessions_(SS._proxy).filter(function (s) { return s.id === t26.id; })[0].row, SC.NOTIFIED + 1).setValue('');
var r26b = sendTomorrow_(loadContext_(SS._proxy), true);
assert(r26b.indexOf('失敗') >= 0 && !getSessions_(SS._proxy).filter(function (s) { return s.id === t26.id; })[0].notified, '3 回とも失敗なら通知済みにしない（次の自動通知でまた送る）');
FETCH_CODES = []; FETCH_CODE = 204;

// 27. 画面が 1 回ずつ送る sendDiscordStep
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
var log27 = sheetOf('通知ログ');
var lastLog27 = function () { return String(log27.getRange(log27.getLastRow(), 4).getValue()); };
FETCHES.length = 0; SLEEPS.length = 0; FETCH_CODES = [429];
var st1 = sendDiscordStep({ kind: 'test', attempt: 1 });
assert(st1.ok === false && st1.retryable === true && st1.waitMs === 3000 && st1.attempt === 1 && st1.maxTries === 3, '1 回目が 429 なら「まだ送り直せる」と 3 秒の待ちを返す: ' + JSON.stringify([st1.retryable, st1.waitMs]));
assert(FETCHES.length === 1 && SLEEPS.length === 0, 'サーバー側では待たない（画面が待つ）');
assert(lastLog27() === 'HTTP 429 error code: 1015（1 回目、3 秒後に送り直し）' && FETCHES[0].body.content.indexOf('接続テスト') >= 0, '1 回目の記録には「送り直す」と書く: ' + lastLog27());
assert(st1.reason && st1.reason.kind === 'cloudflare' && st1.reason.label === 'Discord 側の制限' && st1.reason.toolFault === false && st1.raw === 'HTTP 429 error code: 1015', '返り値に失敗の種類（Cloudflare・ツールの不具合ではない）が付く');
FETCH_CODES = [429];
var st2 = sendDiscordStep({ kind: 'test', attempt: 2 });
assert(st2.retryable === true && st2.waitMs === 8000 && lastLog27() === 'HTTP 429 error code: 1015（2 回目、8 秒後に送り直し）', '2 回目も 429 なら 8 秒の待ち: ' + lastLog27());
FETCH_CODES = [429];
var st3 = sendDiscordStep({ kind: 'test', attempt: 3 });
assert(st3.retryable === false && st3.waitMs === 0 && lastLog27().indexOf('送信失敗（Discord 側の制限）') === 0 && lastLog27().indexOf('（3 回目、打ち止め）') > 0 && lastLog27().indexOf('このツールの不具合ではありません') > 0, '3 回目で駄目なら打ち止め。種類と「ツールの不具合ではない」が記録に残る');
FETCH_CODES = [204];
var st4 = sendDiscordStep({ kind: 'test', attempt: 2 });
assert(st4.ok === true && lastLog27() === 'OK (204)（2 回目）', '2 回目で通れば OK（2 回目）');
FETCH_CODES = [400];
var st5 = sendDiscordStep({ kind: 'test', attempt: 1 });
assert(st5.ok === false && st5.retryable === false && st5.reason.kind === 'bad_payload' && st5.reason.toolFault === true && lastLog27().indexOf('送信失敗（本文）') === 0 && lastLog27().indexOf('このツールの不具合ではありません') < 0, '400 は送り直さず、「本文」の種類でツール側の可能性を残す');
FETCH_CODES = [404];
var st6 = sendDiscordStep({ kind: 'test', attempt: 1 });
assert(st6.reason.kind === 'bad_url' && st6.reason.toolFault === false && lastLog27().indexOf('送信失敗（Webhook URL）') === 0, '404 は「Webhook URL」の種類');
FETCH_CODES = [503];
var st7 = sendDiscordStep({ kind: 'test', attempt: 3 });
assert(st7.reason.kind === 'discord_down' && st7.retryable === false && lastLog27().indexOf('送信失敗（Discord 側の不調）') === 0, '5xx で打ち止めなら「Discord 側の不調」');
var cls = classifyDiscordFailure_(0, 'Exception: Required permissions: https://www.googleapis.com/auth/script.external_request');
assert(cls.kind === 'auth' && cls.toolFault === false, '承認不足は「承認」でツールの不具合ではない');
assert(classifyDiscordFailure_(0, 'Exception: DNS error').kind === 'network' && classifyDiscordFailure_(418, '').kind === 'unknown', '通信と不明の分類');
// 種類ごとの本文
var sess27 = saveSession({ name: '段階送信の卓', gm: 'カレン', members: ['ダン'], extra: '', date: ymd_(addDays_(new Date(), 1)), start: '20:00', end: '', status: '開催', notify: false });
FETCHES.length = 0; FETCH_CODES = [204];
var c27 = sendDiscordStep({ kind: 'change', id: sess27.id, verb: '登録', me: 'ボブ', attempt: 1 });
assert(c27.ok && FETCHES[0].body.content.indexOf('登録されました（ボブ）') > 0 && FETCHES[0].body.embeds[0].title === '段階送信の卓', '登録の知らせは卓の埋め込みつき');
FETCHES.length = 0; FETCH_CODES = [204];
sendDiscordStep({ kind: 'change', id: sess27.id, verb: '変更', attempt: 1 });
assert(FETCHES[0].body.content.indexOf('変更されました') > 0, '変更の知らせ');
FETCHES.length = 0; FETCH_CODES = [204];
var d27 = sendDiscordStep({ kind: 'delete', name: '消した卓', me: 'ボブ', attempt: 1 });
assert(d27.ok && FETCHES[0].body.content.indexOf('削除されました（ボブ）：消した卓') > 0 && FETCHES[0].body.embeds.length === 0, '削除の知らせは本文だけ');
FETCHES.length = 0; FETCH_CODES = [204];
var b27 = sendDiscordStep({ kind: 'bulk', names: ['卓A', '卓B'], label: '状態を「終了」に', me: 'ボブ', attempt: 1 });
assert(b27.ok && FETCHES[0].body.content.indexOf('一括で状態を「終了」に（ボブ）') > 0 && FETCHES[0].body.content.indexOf('・卓B') > 0, '一括変更の知らせ');
FETCHES.length = 0; FETCH_CODES = [204];
sheetOf('メンバー').getRange(2, 2).setValue('123456789012345678');
var a27 = sendDiscordStep({ kind: 'announce', id: sess27.id, me: 'ボブ', attempt: 1 });
assert(a27.ok && a27.notified === true && a27.data && getSessions_(SS._proxy).filter(function (s) { return s.id === sess27.id; })[0].notified, '案内が通れば、明日の卓は前日通知済みになり最新データが付く');
assert(FETCHES[0].body.content.indexOf('📣 卓の案内: 段階送信の卓') === 0 && FETCHES[0].body.content.indexOf('by ボブ') > 0, '案内の本文');
FETCHES.length = 0; FETCH_CODES = [429];
var a27b = sendDiscordStep({ kind: 'announce', id: sess27.id, attempt: 1 });
assert(a27b.ok === false && a27b.notified === undefined && a27b.data === undefined, '案内が通らなければ印も付けず、データも返さない');
err = null; try { sendDiscordStep({ kind: 'nazo', attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('種類が不正') >= 0, '知らない種類は弾く');
err = null; try { sendDiscordStep({ kind: 'change', id: 'S999', attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('見つかりません') >= 0, '無い卓は弾く');
sheetOf('設定').getRange(2, 2).setValue('');
err = null; try { sendDiscordStep({ kind: 'test', attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('Webhook URL が空') >= 0, 'URL が空なら送る前に断る');
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
// 一括変更の返事に、あとで送るための名前と操作の文が付く
var bk27 = bulkUpdateSessions({ ids: [sess27.id], action: 'status', value: '募集', notify: false });
assert(bk27.names && bk27.names[0] === '段階送信の卓' && bk27.label === '状態を「募集」に', '一括変更の返事に names と label が付く: ' + JSON.stringify([bk27.names, bk27.label]));
FETCH_CODES = []; FETCH_CODE = 204;

// 28. 日時の読み戻しは日本語表記（シートが日付型に変えても英語にならない）
var d28 = new Date(2026, 8, 15, 21, 23);   // 2026/09/15（火） 21:23
assert(stampText_(d28) === '2026/09/15（火） 21:23', '日付型 → 2026/09/15（火） 21:23: ' + stampText_(d28));
assert(stampText_('2026/09/15 21:23') === '2026/09/15（火） 21:23', '文字列の日時も同じ形: ' + stampText_('2026/09/15 21:23'));
assert(stampText_('2026-09-15 09:05') === '2026/09/15（火） 09:05', 'ハイフン区切りも読める');
assert(stampText_('') === '' && stampText_(null) === '' && stampText_('メモ書き') === 'メモ書き', '空と普通の文字はそのまま');
assert(String(d28).indexOf('Tue') === 0, '（参考）そのまま String() すると英語になる: ' + String(d28).slice(0, 15));
// 通知ログに日付型で書かれても、画面には日本語表記で渡る
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
FETCH_CODES = [204]; FETCHES.length = 0;
postDiscord_(loadContext_(SS._proxy), { content: 'x' }, '接続テスト', '-');
var lg28 = sheetOf('通知ログ');
var cell28 = lg28.getRange(lg28.getLastRow(), 1).getValue();
assert(cell28 instanceof Date, '通知ログの日時は日付型で書かれる');
var cd28 = getConsoleData();
assert(/^\d{4}\/\d{2}\/\d{2}（[日月火水木金土]） \d{2}:\d{2}$/.test(cd28.log[0].at), '送信記録の日時が「2026/09/15（火） 21:23」の形: ' + cd28.log[0].at);
// 前日通知の日時と日付メモの日時も同じ
var t28 = saveSession({ name: '日時表記の卓', gm: 'カレン', members: [], extra: '', date: ymd_(addDays_(new Date(), 1)), start: '20:00', end: '', status: '開催', notify: false });
sheetOf('セッション').getRange(getSessions_(SS._proxy).filter(function (s) { return s.id === t28.id; })[0].row, SC.NOTIFIED + 1).setValue(new Date(2026, 8, 14, 20, 5));
assert(getSessions_(SS._proxy).filter(function (s) { return s.id === t28.id; })[0].notifiedStamp === '2026/09/14（月） 20:05', '前日通知の日時も日本語表記');
setDayNote({ ymd: ymd_(addDays_(new Date(), 2)), text: '日時の確認', me: 'カレン' });
var noteRow = getDayNotes_(SS._proxy)[ymd_(addDays_(new Date(), 2))].row;
sheetOf('日付メモ').getRange(noteRow, 4).setValue(new Date(2026, 8, 13, 8, 30));
assert(getDayNotes_(SS._proxy)[ymd_(addDays_(new Date(), 2))].at === '2026/09/13（日） 08:30', '日付メモの日時も日本語表記');
setDayNote({ ymd: ymd_(addDays_(new Date(), 2)), text: '', me: 'カレン' });

// 29. 状態は 募集・調整中・開催・終了・中止。募集は開きたい期間を持ち、参加希望と興味ありを付けられる
assert(STATUS_LIST.join(',') === '募集,調整中,開催,終了,中止', '状態は 募集・調整中・開催・終了・中止');
var p29 = parsePeriod_('2026/10 前期');
assert(p29 && p29.label === '10月前期' && p29.key === '2026-10-01' && p29.text === '2026/10 前期', '旧い募集時期を読む: ' + JSON.stringify(p29));
assert(parsePeriod_('2026-11 後期').key === '2026-11-16' && parsePeriod_('2026年11月後期').label === '11月後期', 'ハイフンや年月の表記も読める');
assert(parsePeriod_(new Date(2026, 9, 20)).label === '10月後期' && parsePeriod_('') === null && parsePeriod_('メモ') === null && parsePeriod_('2026/13 前期') === null, '日付型なら日で前後を決める。読めなければ null');
assert(periodWindow_(parsePeriod_('2026/12 後期')).text === '2026/12/16〜2026/12/31' && periodWindow_(p29).text === '2026/10/01〜2026/10/15', '旧い募集時期は期間に読み替える');
// 募集の卓を登録する。開催日は要らない。期間（開きたい日の幅）を持つ
var w29a = '2026-12-16', w29b = '2026-12-31';
var lbl29 = fmtDateJa_(toDate_(w29a)) + '〜' + fmtDateJa_(toDate_(w29b));
var r29 = saveSession({ name: '募集の卓', gm: 'アリス', members: ['ボブ'], extra: '', date: '', start: '', end: '', status: '募集', windowFrom: w29a, windowTo: w29b, notify: false, me: 'アリス' });
var g29 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === r29.id; })[0]; };
assert(r29.ok && g29().status === '募集' && g29().window === '2026/12/16〜2026/12/31' && g29().windowLabel === lbl29 && !g29().date, '募集の卓は期間だけで登録できる: ' + r29.message);
err = null; try { saveSession({ name: '日付なしの予定', status: '開催', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('募集') >= 0, '開催日の無い「開催」は弾き、募集を案内する: ' + err);
err = null; try { saveSession({ name: '日付なしの開催', status: '開催', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('開催日') >= 0, '開催日の無い「開催」も弾く');
err = null; try { saveSession({ name: '片方だけの期間', status: '募集', members: [], windowFrom: w29a }); } catch (e) { err = e.message; }
assert(err && err.indexOf('両方の日') >= 0, '募集の期間も、片方だけは弾く: ' + err);
var r29z = saveSession({ name: '時期未定の募集', gm: 'ボブ', members: [], extra: '', status: '募集', notify: false });
assert(r29z.ok && getSessions_(SS._proxy).filter(function (s) { return s.id === r29z.id; })[0].windowLabel === '', '期間は空でも募集できる');
// 参加希望と興味あり。Discord には送らない
FETCHES.length = 0;
var i1 = setInterest({ id: r29.id, name: 'カレン', level: 'want' });
assert(i1.ok && g29().want.join(',') === 'カレン' && i1.data && i1.data.sessions.some(function (s) { return s.id === r29.id && s.want[0] === 'カレン'; }), '参加希望を出せる。返事に最新データが付く: ' + i1.message);
var i2 = setInterest({ id: r29.id, name: 'ダン', level: 'interest' });
assert(i2.ok && g29().interest.join(',') === 'ダン', '興味ありを付けられる');
setInterest({ id: r29.id, name: 'カレン', level: 'interest' });
assert(g29().want.length === 0 && g29().interest.join(',') === 'ダン,カレン', '参加希望と興味ありは片方だけ: ' + JSON.stringify([g29().want, g29().interest]));
setInterest({ id: r29.id, name: 'カレン', level: 'want' });
var i4 = setInterest({ id: r29.id, name: 'ダン', level: 'none' });
assert(i4.ok && g29().want.join(',') === 'カレン' && g29().interest.length === 0, '取り消せる');
assert(FETCHES.length === 0, '参加希望・興味ありでは Discord に送らない');
err = null; try { setInterest({ id: r29.id, name: '', level: 'want' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('あなた') >= 0, '名前が無ければ弾く');
err = null; try { setInterest({ id: r29.id, name: 'ボブ', level: 'want' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('参加者') >= 0, 'すでに参加者なら弾く: ' + err);
err = null; try { setInterest({ id: t16.id, name: 'カレン', level: 'want' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('募集中ではありません') >= 0, '募集中でない卓には付けられない');
// 募集の卓は都合の判定に参加希望の人も入る
var cand29 = candidatesOf_(g29());
assert(cand29.join(',') === 'アリス,ボブ,カレン', '都合を見る相手は GM・参加者・参加希望: ' + cand29.join(','));
// 一覧・管理・カレンダー・案内の見え方
refreshAll();
var listText29 = Object.keys(sheetOf('一覧').cells).map(function (k) { return String(sheetOf('一覧').cells[k]); }).join('\n');
assert(listText29.indexOf(lbl29 + ' 募集中') >= 0 && listText29.indexOf('参加希望') >= 0, '一覧の「あと」に募集の期間、列に参加希望が出る');
var adminText29 = Object.keys(sheetOf('管理').cells).map(function (k) { return String(sheetOf('管理').cells[k]); }).join('\n');
assert(adminText29.indexOf('うち募集') >= 0 && adminText29.indexOf('希望') >= 0, '管理に募集の数と「希望」の印が出る');
var calText29 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText29.indexOf('募集の卓（GM: アリス、' + lbl29 + '、参加希望 1 人）') >= 0, 'お知らせに募集中の卓と希望の人数: ' + (calText29.match(/🟡[^\n]*/) || [''])[0]);
FETCHES.length = 0;
notifySessionNow({ id: r29.id, me: 'アリス' });
var emb29 = FETCHES[0].body.embeds[0];
assert(emb29.title === '募集の卓（募集中）' && emb29.description.indexOf('日時: ' + lbl29 + ' に開催予定（募集中）') >= 0 && emb29.description.indexOf('参加希望: カレン') >= 0, '案内には期間と参加希望が載る: ' + emb29.description.replace(/\n/g, ' / '));
// 状態を「開催」にすると、参加希望の人が参加者になる
var day29 = ymd_(addDays_(new Date(), 20));
var r29b = saveSession({ id: r29.id, name: '募集の卓', gm: 'アリス', members: ['ボブ'], extra: '', date: day29, start: '20:00', end: '', status: '開催', windowFrom: w29a, windowTo: w29b, notify: false, me: 'アリス' });
assert(r29b.ok && g29().status === '開催' && g29().members.join(',') === 'ボブ,カレン' && g29().want.length === 0 && g29().window === '', '開催にすると参加希望の人が参加者に入り、希望と期間は空になる: ' + r29b.message);
assert(r29b.message.indexOf('参加希望の カレン を参加者に加えました') >= 0 && r29b.promoted[0] === 'カレン', '返事に加えた人が入る');
assert(bookedMap_(loadContext_(SS._proxy))[day29]['カレン'] === '参', '参加者になった人には都合表の「参」が付く');
// 一括変更でも同じ。興味ありの人は動かない
var r29c = saveSession({ name: '募集の卓 2', gm: 'ボブ', members: [], extra: '', date: '', status: '募集', windowFrom: '2027-01-01', windowTo: '2027-01-15', notify: false });
setInterest({ id: r29c.id, name: 'ダン', level: 'want' });
setInterest({ id: r29c.id, name: 'アリス', level: 'interest' });
err = null; try { bulkUpdateSessions({ ids: [r29c.id], action: 'status', value: '開催' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('開催日が無い') >= 0, '開催日の無い卓を一括で「開催」にはできない');
var row29c = getSessions_(SS._proxy).filter(function (s) { return s.id === r29c.id; })[0].row;
sheetOf('セッション').getRange(row29c, SC.DATE + 1).setValue(addDays_(new Date(), 25));
var bk29 = bulkUpdateSessions({ ids: [r29c.id], action: 'status', value: '開催' });
var g29c = getSessions_(SS._proxy).filter(function (s) { return s.id === r29c.id; })[0];
assert(bk29.ok && g29c.status === '開催' && g29c.members.join(',') === 'ダン' && g29c.want.length === 0 && g29c.interest.join(',') === 'アリス' && g29c.window === '', '一括で開催にしても参加希望の人が参加者に入る。興味ありはそのまま: ' + bk29.message);
// 当日の卓はそのまま「開催」、過ぎたら「終了」
var today29 = saveSession({ name: '当日の卓', gm: 'カレン', members: [], extra: '', date: ymd_(new Date()), start: '21:00', end: '', status: '開催' });
var st29 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0].status; };
assert(st29(today29.id) === '開催', '開催日の当日はそのまま「開催」');
assert(autoFinishPast_(loadContext_(SS._proxy)) === 0, '開催の卓はその日のうちは変えない');
sheetOf('セッション').getRange(getSessions_(SS._proxy).filter(function (s) { return s.id === today29.id; })[0].row, SC.DATE + 1).setValue(addDays_(new Date(), -1));
assert(autoFinishPast_(loadContext_(SS._proxy)) === 1 && st29(today29.id) === '終了', '「開催」のまま日が過ぎたら「終了」');
// 旧い版の「調整中」（期間なし）はそのまま調整中として読む
var legacyRow = Math.max(sheetOf('セッション').getLastRow() + 1, 2);
sheetOf('セッション').getRange(legacyRow, 1, 1, 8).setValues([['S900', '旧い卓', 'ボブ', 'ダン', '', '', '', '調整中']]);
var lg29 = getSessions_(SS._proxy).filter(function (s) { return s.id === 'S900'; })[0];
assert(lg29.status === '調整中' && lg29.window === '' && lg29.windowLabel === '', '「調整中」は期間未定の調整中として読む');
assert(autoFinishPast_(loadContext_(SS._proxy)) === 0, '調整中は作り直しで触らない');
// 旧いシートには 期間・参加希望・興味あり の列が足される
sheetOf('セッション').getRange(1, SC.PERIOD + 1, 1, 3).setValues([['', '', '']]);
ensureSheets_(SS._proxy);
assert(sheetOf('セッション').getRange(1, 1, 1, SESSION_HEADER.length).getValues()[0].join(',') === SESSION_HEADER.join(','), '見出しが欠けていれば足す');
// 並び: 日付のある卓 → 期間の始まりが早い順 → 期間未定
var srt29 = sortSessions_([{ name: 'c', date: null, ymd: '', windowKey: '', start: '' }, { name: 'b', date: null, ymd: '', windowKey: '2026-11-16', start: '' }, { name: 'a', date: new Date(), ymd: '2026-12-01', windowKey: '', start: '' }, { name: 'd', date: null, ymd: '', windowKey: '2026-11-01', start: '' }]).map(function (s) { return s.name; });
assert(srt29.join('') === 'adbc', '日付あり → 期間の早い順 → 期間未定: ' + srt29.join(''));
// コンソール用データに載る
var cd29 = getConsoleData();
var cs29 = cd29.sessions.filter(function (s) { return s.id === 'S900'; })[0];
assert(cs29 && cs29.status === '調整中' && Array.isArray(cs29.want) && Array.isArray(cs29.interest) && 'windowLabel' in cs29 && 'windowKey' in cs29, 'コンソール用データに 状態・希望・興味・期間が載る');

// 30. 合言葉。全員共通 1 つ。ブラウザは証を覚え、合言葉を変えると全員の証が無効になる
assert(!hasPassword_() && getConsoleData().hasPassword === false && getConsoleData({ token: 'x' }).sessions.length > 0, '合言葉が無いうちは誰でも開ける（最初に決めるため）');
err = null; try { login({ password: 'abcd' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('まだ決まっていません') >= 0, '決める前のログインは断る');
err = null; try { setInitialPassword({ password: 'abc', confirm: 'abc' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('8 文字以上') >= 0, '短い合言葉は弾く');
err = null; try { setInitialPassword({ password: 'abcdefgh', confirm: 'abcdefgi' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('合っていません') >= 0, '2 つの入力が違えば弾く');
var pw1 = setInitialPassword({ password: ' 合言葉12345 ', confirm: '合言葉12345' });
assert(pw1.ok && pw1.token && hasPassword_(), '最初の合言葉を決めると証が返る（前後の空白は無視）');
assert(!SPROPS[PW.HASH].match(/合言葉/) && SPROPS[PW.HASH] !== SPROPS[PW.VER], '合言葉そのものは保存しない（ハッシュ）');
err = null; try { setInitialPassword({ password: 'abcd', confirm: 'abcd' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('もう決まっています') >= 0, '二度目は決められない');
var nl = getConsoleData();
assert(nl.needLogin === true && nl.hasPassword === true && !nl.sessions && nl.title, '証が無ければデータを返さず、ログインを求める');
assert(getConsoleData({ token: 'wrong' }).needLogin === true, '違う証でも返さない');
assert(getConsoleData({ token: pw1.token }).sessions.length > 0 && getConsoleData({ token: pw1.token }).hasPassword === true, '証があれば返す');
err = null; try { saveSession({ name: '無断', gm: 'ボブ', members: [], extra: '', date: ymd_(addDays_(new Date(), 30)), start: '', end: '', status: '開催' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('AUTH:') === 0, '証の無い書き込みは AUTH: で弾く: ' + err);
err = null; try { setAvailability('ダン', ymd_(addDays_(new Date(), 2)), '△'); } catch (e) { err = e.message; }
assert(err && err.indexOf('AUTH:') === 0, '都合の書き込みも弾く');
['setInterest', 'deleteSession', 'saveMember', 'deleteMember', 'bulkUpdateSessions', 'setDayNote', 'setAvailabilityBulk', 'saveConsoleSettings', 'setAutoNotify', 'sendDiscordStep', 'notifySessionNow', 'testDiscordConsole', 'changePassword'].forEach(function (fn) {
  var e2 = null; try { globalThis[fn]({}); } catch (e) { e2 = e.message; }
  assert(e2 && e2.indexOf('AUTH:') === 0, fn + ' も証が無ければ弾く: ' + e2);
});
var ok30 = saveSession({ token: pw1.token, name: '証つき', gm: 'ボブ', members: [], extra: '', date: ymd_(addDays_(new Date(), 30)), start: '', end: '', status: '開催', notify: false });
assert(ok30.ok && ok30.data.hasPassword === true, '証があれば書ける。返事のデータにも合言葉の有無が付く');
assert(setAvailability('ダン', ymd_(addDays_(new Date(), 2)), '△', pw1.token).ok, '都合も証があれば書ける');
err = null; try { login({ password: 'ちがう' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('違います') >= 0, '違う合言葉は断る');
var lg = login({ password: '合言葉12345' });
assert(lg.ok && lg.token === pw1.token, '合う合言葉なら同じ証が返る（版が同じなので、ほかのブラウザも生きたまま）');
// 変える → 全員の証が無効に
err = null; try { changePassword({ token: pw1.token, current: 'ちがう', password: 'あたらしいあいことば', confirm: 'あたらしいあいことば' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('いまの合言葉') >= 0, '変えるにはいまの合言葉が要る');
var ch = changePassword({ token: pw1.token, current: '合言葉12345', password: 'あたらしいあいことば', confirm: 'あたらしいあいことば' });
assert(ch.ok && ch.token && ch.token !== pw1.token, '変えると新しい証が返る');
assert(getConsoleData({ token: pw1.token }).needLogin === true && getConsoleData({ token: ch.token }).sessions.length > 0, '古い証は無効、新しい証は有効');
err = null; try { login({ password: '合言葉12345' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('違います') >= 0, '古い合言葉では入れない');
assert(login({ password: 'あたらしいあいことば' }).token === ch.token, '新しい合言葉で入れる');
// 間違いが続いたら待たせる
for (var li = 0; li < 10; li++) { try { login({ password: 'x' + li }); } catch (e) {} }
err = null; try { login({ password: 'あたらしいあいことば' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('待って') >= 0, '10 回続けて間違えると、合っていても少し待たせる: ' + err);
SPROPS[PW.FAILS] = JSON.stringify({ n: 10, at: Date.now() - 11 * 60 * 1000 });
assert(login({ password: 'あたらしいあいことば' }).ok && !SPROPS[PW.FAILS], '10 分たてば入れて、数え直す');
// シートのメニューから決め直す（忘れたとき）
PROMPT_ANSWER = { button: 'OK', text: 'めにゅーからきめる' };
setWebPassword();
assert(PROMPTS[PROMPTS.length - 1].indexOf('置き換えます') >= 0 && getConsoleData({ token: ch.token }).needLogin === true && login({ password: 'めにゅーからきめる' }).ok, 'メニューで決め直すと前の証は無効になり、新しい合言葉で入れる');
PROMPT_ANSWER = { button: 'OK', text: 'ab' };
setWebPassword();
assert(ALERTS[ALERTS.length - 1].indexOf('8 文字以上') >= 0 && login({ password: 'めにゅーからきめる' }).ok, '短ければ変えない');
PROMPT_ANSWER = { button: 'CANCEL', text: 'zzzz' };
setWebPassword();
assert(login({ password: 'めにゅーからきめる' }).ok, 'キャンセルなら変えない');
// 以降の検証のために外す
[PW.HASH, PW.SALT, PW.VER, PW.FAILS].forEach(function (k) { delete SPROPS[k]; });
assert(!hasPassword_() && getConsoleData().sessions.length > 0, '（検証用）合言葉を外した');

// 31. メンバーの予定のメモ。○△×とは別に、1 マス（日付×名前）に文を添える
var names31 = getMembers_(SS._proxy).map(function (m) { return m.name; });
var a31 = names31[0], b31 = names31[1];
var days31 = getConsoleData().availDays, booked31 = bookedMap_(loadContext_(SS._proxy));
var nd31 = days31.filter(function (d, i) { return i >= 3 && !(booked31[d] || {})[a31] && !(booked31[d] || {})[b31]; })[0];
assert(a31 && b31 && nd31, '（前提）メンバーが 2 人以上いて、どちらも卓に入っていない日がある: ' + names31.join(',') + ' / ' + nd31);
var m1 = setAvailNote({ name: a31, ymd: nd31, text: ' 21 時から ' });
assert(m1.ok && getAvailNotes_(SS._proxy)[nd31][a31].text === '21 時から' && m1.data.availNotes[nd31][a31].text === '21 時から', 'メモを書けて、返事のデータにも載る: ' + m1.message);
var rows31 = sheetOf('予定メモ').getLastRow();
setAvailNote({ name: a31, ymd: nd31, text: '22 時から' });
assert(sheetOf('予定メモ').getLastRow() === rows31 && getAvailNotes_(SS._proxy)[nd31][a31].text === '22 時から', '書き直しても行が増えない');
setAvailNote({ name: b31, ymd: nd31, text: '午前だけ' });
assert(Object.keys(getAvailNotes_(SS._proxy)[nd31]).length === 2, '同じ日に別の人のメモも持てる');
// 卓に入っている日（参・GM）にも書ける
var bkDay31 = days31.filter(function (d) { return Object.keys(booked31[d] || {}).length > 0; })[0];
var who31 = bkDay31 && Object.keys(booked31[bkDay31])[0];
assert(who31, '（前提）卓に入っている人がいる日がある');
assert(setAvailNote({ name: who31, ymd: bkDay31, text: '少し遅れます' }).ok, '卓に入っている日にもメモは書ける');
// 都合シートのセルのメモに出る
refreshAll();
var avs31 = sheetOf('都合');
var hdr31 = avs31.getRange(1, 1, 1, avs31.getLastColumn()).getValues()[0].map(function (v) { return String(v); });
var rowOf31 = function (d) { return days31.indexOf(d) + 2; };
assert(avs31.notes[rowOf31(nd31) + ',' + (hdr31.indexOf(a31) + 1)] === '22 時から' && avs31.notes[rowOf31(bkDay31) + ',' + (hdr31.indexOf(who31) + 1)] === '少し遅れます', '都合シートのセルのメモに出る');
// 消す
setAvailNote({ name: b31, ymd: nd31, text: '' });
assert(!getAvailNotes_(SS._proxy)[nd31][b31] && getAvailNotes_(SS._proxy)[nd31][a31], '空にすると消える。ほかの人のは残る');
refreshAll();
assert(!sheetOf('都合').notes[rowOf31(nd31) + ',' + (hdr31.indexOf(b31) + 1)] && sheetOf('都合').notes[rowOf31(nd31) + ',' + (hdr31.indexOf(a31) + 1)] === '22 時から', '消したメモは都合シートからも消える');
// 弾く
err = null; try { setAvailNote({ name: '', ymd: nd31, text: 'x' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('あなた') >= 0, '名前なしは弾く');
err = null; try { setAvailNote({ name: '知らない人', ymd: nd31, text: 'x' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('メンバー') >= 0, 'メンバーに無い名前は弾く');
err = null; try { setAvailNote({ name: a31, ymd: 'x', text: 'x' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日付') >= 0, '読めない日付は弾く');
err = null; try { setAvailNote({ name: a31, ymd: nd31, text: new Array(220).join('あ') }); } catch (e) { err = e.message; }
assert(err && err.indexOf('200 文字') >= 0, '長すぎるメモは弾く');
// 名前を変えると追随する
var mem31 = getMembers_(SS._proxy).filter(function (m) { return m.name === a31; })[0];
saveMember({ oldName: a31, name: a31 + '2', discordId: mem31.discordId, note: mem31.note });
assert(getAvailNotes_(SS._proxy)[nd31][a31 + '2'] && !getAvailNotes_(SS._proxy)[nd31][a31], '名前を変えるとメモの名前も変わる');
saveMember({ oldName: a31 + '2', name: a31, discordId: mem31.discordId, note: mem31.note });
// ○△×とは独立
setAvailability(a31, nd31, '×');
assert(getAvailNotes_(SS._proxy)[nd31][a31].text === '22 時から' && getAvailability_(SS._proxy)[nd31][a31] === '×', '印を変えてもメモは残る');
assert(getConsoleData().availNotes[nd31][a31].text === '22 時から', 'コンソール用データに予定メモが載る');

// 32. 募集中の卓の「興味あり」の人に、参加できるかを Discord で聞く。返事は募集タブの「参加希望」で
var rc32 = saveSession({ name: '確認の卓', gm: 'アリス', members: [], extra: '', status: '募集', windowFrom: '2027-02-01', windowTo: '2027-02-15', notify: false });
var g32 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === rc32.id; })[0]; };
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
err = null; try { sendDiscordStep({ kind: 'ask', id: rc32.id, attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('興味あり') >= 0, '興味ありの人がいなければ断る');
err = null; try { sendDiscordStep({ kind: 'ask', id: t16.id, attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('募集中ではありません') >= 0, '募集中でない卓には送らない');
// ボブ（ID あり）とダン（ID なし）を興味ありに。カレンは参加希望
saveMember({ oldName: 'ボブ', name: 'ボブ', discordId: '111111111111111111', note: '' });
saveMember({ oldName: 'ダン', name: 'ダン', discordId: '', note: '' });
setInterest({ id: rc32.id, name: 'ボブ', level: 'interest' });
setInterest({ id: rc32.id, name: 'ダン', level: 'interest' });
setInterest({ id: rc32.id, name: 'カレン', level: 'want' });
FETCHES.length = 0;
var a1 = sendDiscordStep({ kind: 'ask', id: rc32.id, attempt: 1, me: 'アリス' });
assert(a1.ok && FETCHES.length === 1, '確認文を 1 通送る');
var c32 = FETCHES[0].body.content;
assert(c32.indexOf('<@111111111111111111>') >= 0 && c32.indexOf('ダン さん') >= 0 && c32.indexOf('カレン') < 0, '興味ありの人だけを呼び、ID の無い人は名前で書く: ' + c32.replace(/\n/g, ' / '));
assert(c32.indexOf('「募集・調整」タブで「参加希望」を押してください') >= 0 && c32.indexOf(fmtDateJa_(toDate_('2027-02-01')) + '〜' + fmtDateJa_(toDate_('2027-02-15'))) >= 0 && c32.indexOf('by アリス') >= 0 && c32.indexOf(WEBAPP_URL) >= 0 && c32.indexOf('💬') < 0, '返事の仕方とウェブアプリの URL、時期、送った人が入る。一言が無ければその行は無い');
// 一言を添える
FETCHES.length = 0;
var a1m = sendDiscordStep({ kind: 'ask', id: rc32.id, attempt: 1, me: 'アリス', message: ' 土曜の夜を考えています。都合を教えてください ' });
var c32m = FETCHES[0].body.content;
assert(a1m.ok && c32m.indexOf('💬 土曜の夜を考えています。都合を教えてください（アリス）') >= 0 && c32m.indexOf('by アリス') < 0 && c32m.indexOf('参加希望であれば') > c32m.indexOf('💬'), '一言が名前付きで挟まり、返事の案内はその後ろ: ' + c32m.replace(/\n/g, ' / '));
err = null; try { sendDiscordStep({ kind: 'ask', id: rc32.id, attempt: 1, message: new Array(520).join('あ') }); } catch (e) { err = e.message; }
assert(err && err.indexOf('500 文字') >= 0, '長すぎる一言は弾く');
assert(FETCHES[0].body.embeds[0].title === '確認の卓（募集中）', '卓の内容も添える');
assert(g32().askedStamp && a1.asked === g32().askedStamp && a1.data.sessions.some(function (s) { return s.id === rc32.id && s.asked === g32().askedStamp; }), '送った日時が卓に残り、画面用データにも載る: ' + g32().askedStamp);
// 募集のまま直しても日時は残り、開催にすると消える
saveSession({ id: rc32.id, name: '確認の卓', gm: 'アリス', members: [], extra: '', status: '募集', windowFrom: '2027-02-01', windowTo: '2027-02-15', notify: false });
assert(g32().askedStamp === a1.asked && g32().interest.join(',') === 'ボブ,ダン', '募集のまま直しても控えと興味ありは残る');
sheetOf('セッション').getRange(g32().row, SC.DATE + 1).setValue(addDays_(new Date(), 40));
bulkUpdateSessions({ ids: [rc32.id], action: 'status', value: '開催' });
assert(g32().status === '開催' && !g32().askedStamp && g32().members.indexOf('カレン') >= 0, '開催にすると参加希望の人が参加者になり、確認の控えは消える');
// 古いシートにも「参加確認」の見出しが足される
sheetOf('セッション').getRange(1, SC.ASK + 1).setValue('');
ensureSheets_(SS._proxy);
assert(sheetOf('セッション').getRange(1, SC.ASK + 1).getValue() === '参加確認', '見出しに「参加確認」が足される');

// 33. シリーズ（キャンペーン）。同じ名前で束ね、複数日をまとめて登録できる
var base33 = ymd_(addDays_(new Date(), 50));
var s1 = saveSession({ name: '黒鉄の塔 #1', series: '黒鉄の塔', gm: 'アリス', members: ['ボブ', 'カレン'], extra: '', date: base33, start: '20:00', end: '23:00', status: '開催', place: 'Discord', memo: '第 1 回', notify: false });
var g33 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0]; };
assert(s1.ok && g33(s1.id).series === '黒鉄の塔' && getConsoleData().sessions.some(function (s) { return s.id === s1.id && s.series === '黒鉄の塔'; }), 'シリーズ名が卓に残り、画面用データにも載る');
// 複数日をまとめて。名前は末尾の数字を進め、GM・参加者・場所などは同じ
var d2 = ymd_(addDays_(new Date(), 57)), d3 = ymd_(addDays_(new Date(), 64));
var s2 = saveSession({ name: '黒鉄の塔 #2', series: '黒鉄の塔', gm: 'アリス', members: ['ボブ', 'カレン'], extra: '', date: d2, dates: [d3, d2, d2], start: '20:00', end: '23:00', status: '開催', place: 'Discord', memo: '', notify: false });
assert(s2.ok && s2.count === 2 && s2.ids.length === 2 && s2.names.join(',') === '黒鉄の塔 #2,黒鉄の塔 #3', '重なる日は 1 つにして、日付順に 2 回分を登録: ' + s2.message);
var r2 = g33(s2.ids[0]), r3 = g33(s2.ids[1]);
assert(r2.ymd === d2 && r3.ymd === d3 && r2.name === '黒鉄の塔 #2' && r3.name === '黒鉄の塔 #3' && r3.series === '黒鉄の塔' && r3.gm === 'アリス' && r3.members.join(',') === 'ボブ,カレン' && r3.place === 'Discord' && r3.start === '20:00', '2 回分とも同じ GM・参加者・場所・時間で、日付順に並ぶ');
assert(s2.data.sessions.filter(function (s) { return s.series === '黒鉄の塔'; }).length === 3, '返事のデータにシリーズ 3 回分');
// 数字が無い名前なら「名前 #1」「名前 #2」
var s3 = saveSession({ name: '一夜の怪談', series: '', gm: 'ボブ', members: [], extra: '', date: d2, dates: [d2, d3], start: '', end: '', status: '開催', notify: false });
assert(s3.names.join(',') === '一夜の怪談,一夜の怪談 #2', '数字の無い名前は 2 回目から「#2」: ' + s3.names.join(','));
// 弾く
err = null; try { saveSession({ id: s1.id, name: '黒鉄の塔 #1', dates: [d2, d3], status: '開催', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('新規のときだけ') >= 0, '既存の卓に複数日は付けられない');
err = null; try { saveSession({ name: '募集で複数', dates: [d2, d3], status: '募集', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('「開催」') >= 0, '募集で複数日は弾く');
err = null; try { saveSession({ name: '変な日', dates: [d2, 'x'], status: '開催', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('読めません') >= 0, '読めない日は弾く');
// 一括でシリーズを付ける・外す
var bs = bulkUpdateSessions({ ids: s3.ids, action: 'setSeries', value: '怪談' });
assert(bs.ok && bs.label === 'シリーズを「怪談」に' && g33(s3.ids[0]).series === '怪談' && g33(s3.ids[1]).series === '怪談', '一括でシリーズを付ける');
var bs2 = bulkUpdateSessions({ ids: [s3.ids[1]], action: 'setSeries', value: '' });
assert(bs2.label === 'シリーズを外す' && g33(s3.ids[1]).series === '' && g33(s3.ids[0]).series === '怪談', '一括でシリーズを外す');
// 一覧シートにシリーズの列
refreshAll();
var listHdr33 = sheetOf('一覧').getRange(2, 1, 1, 16).getValues()[0];
assert(listHdr33[2] === 'シリーズ' && Object.keys(sheetOf('一覧').cells).some(function (k) { return String(sheetOf('一覧').cells[k]) === '黒鉄の塔'; }), '一覧シートにシリーズが出る');
// 古いシートにも「シリーズ」の見出しが足される
sheetOf('セッション').getRange(1, SC.SERIES + 1).setValue('');
ensureSheets_(SS._proxy);
assert(sheetOf('セッション').getRange(1, SC.SERIES + 1).getValue() === 'シリーズ', '見出しに「シリーズ」が足される');
// 直しても残る。サンプルの 1 件目はシリーズ付き
saveSession({ id: s1.id, name: '黒鉄の塔 #1', series: '黒鉄の塔', gm: 'アリス', members: ['ボブ'], extra: '', date: base33, start: '20:00', end: '', status: '開催', notify: false });
assert(g33(s1.id).series === '黒鉄の塔' && g33(s1.id).members.join(',') === 'ボブ', '直してもシリーズは残る');

// 34. 調整中。候補の期間（◯月◯日〜◯日のどこか）を持ち、カレンダーと都合表に印が出る
var wf = ymd_(addDays_(new Date(), 10)), wt = ymd_(addDays_(new Date(), 20));
var ad = saveSession({ name: '調整の卓', gm: 'ボブ', members: ['アリス'], extra: '', status: '調整中', windowFrom: wt, windowTo: wf, notify: false });
var g34 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === ad.id; })[0]; };
assert(ad.ok && g34().status === '調整中' && g34().windowFrom === wf && g34().windowTo === wt && !g34().date && g34().windowLabel === fmtDateJa_(toDate_(wf)) + '〜' + fmtDateJa_(toDate_(wt)), '逆に入れても前後を直して残る: ' + g34().window);
assert(getConsoleData().sessions.some(function (s) { return s.id === ad.id && s.windowFrom === wf && s.windowTo === wt && s.windowLabel && s.windowKey === wf; }), '画面用データに期間が載る');
err = null; try { saveSession({ name: '片方だけ', status: '調整中', windowFrom: wf, windowTo: '', members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('両方') >= 0, '片方だけの期間は弾く');
err = null; try { saveSession({ name: '読めない', status: '調整中', windowFrom: 'x', windowTo: wt, members: [] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('読めません') >= 0, '読めない日は弾く');
var ad2 = saveSession({ name: '期間未定の調整', gm: 'ボブ', members: [], extra: '', status: '調整中', notify: false });
assert(ad2.ok && getSessions_(SS._proxy).filter(function (s) { return s.id === ad2.id; })[0].window === '', '期間は空でもよい');
assert(parseWindow_('2026/10/03 ~ 2026/10/17').fromYmd === '2026-10-03' && parseWindow_('2026-10-17〜2026-10-03').toYmd === '2026-10-17' && parseWindow_('10/3') === null, '区切りの違いと逆順を読み、片方だけは読まない');
// 表示: お知らせ・カレンダー・都合・一覧・管理
refreshAll();
var calText34 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText34.indexOf('🔶 日程調整中: ') >= 0 && calText34.indexOf('調整の卓（GM: ボブ、' + g34().windowLabel + ' のどこか）') >= 0, 'お知らせに調整中の卓と期間: ' + (calText34.match(/🔶[^\n]*/) || [''])[0]);
assert(calText34.split('◇ 調整の卓（調整中）').length - 1 === 11, 'カレンダーの候補の期間 11 日に印が出る (' + (calText34.split('◇ 調整の卓（調整中）').length - 1) + ')');
var avText34 = Object.keys(sheetOf('都合').cells).map(function (k) { return String(sheetOf('都合').cells[k]); }).join('\n');
assert(avText34.split('調整: 調整の卓').length - 1 === 11, '都合表の候補の期間にも出る');
var listText34 = Object.keys(sheetOf('一覧').cells).map(function (k) { return String(sheetOf('一覧').cells[k]); }).join('\n');
assert(listText34.indexOf(g34().windowLabel + ' のどこか 調整中') >= 0, '一覧の「あと」に期間');
var adminText34 = Object.keys(sheetOf('管理').cells).map(function (k) { return String(sheetOf('管理').cells[k]); }).join('\n');
assert(adminText34.indexOf('うち募集・調整中') >= 0 && adminText34.indexOf(g34().windowLabel) >= 0, '管理に期間が出る');
// 募集 → 調整中 で参加希望の人が参加者に移る
var rc34 = saveSession({ name: '募集から調整', gm: 'カレン', members: [], extra: '', status: '募集', windowFrom: '2027-03-01', windowTo: '2027-03-15', notify: false });
setInterest({ id: rc34.id, name: 'ダン', level: 'want' });
var r34 = saveSession({ id: rc34.id, name: '募集から調整', gm: 'カレン', members: [], extra: '', status: '調整中', windowFrom: wf, windowTo: wt, notify: false });
var g34b = getSessions_(SS._proxy).filter(function (s) { return s.id === rc34.id; })[0];
assert(r34.promoted[0] === 'ダン' && g34b.members.join(',') === 'ダン' && g34b.want.length === 0 && g34b.window === windowTextOf_(wf, wt), '調整中にすると参加希望の人が参加者に移り、期間が候補の期間に変わる');
// 調整中 → 予定 で期間は消える。予定に開催日は要る
err = null; try { saveSession({ id: rc34.id, name: '募集から調整', gm: 'カレン', members: ['ダン'], extra: '', status: '開催', notify: false }); } catch (e) { err = e.message; }
assert(err && err.indexOf('開催日') >= 0, '予定にするには開催日が要る');
saveSession({ id: rc34.id, name: '募集から調整', gm: 'カレン', members: ['ダン'], extra: '', date: wf, start: '20:00', end: '', status: '開催', notify: false });
g34b = getSessions_(SS._proxy).filter(function (s) { return s.id === rc34.id; })[0];
assert(g34b.status === '開催' && g34b.window === '' && g34b.ymd === wf, '予定にすると期間は消える');
// 一括で調整中にできる（開催日は要らない）。一括で予定にすると期間が消える
var bk34 = bulkUpdateSessions({ ids: [ad2.id], action: 'status', value: '調整中' });
assert(bk34.ok && getSessions_(SS._proxy).filter(function (s) { return s.id === ad2.id; })[0].status === '調整中', '一括で調整中にできる');
sheetOf('セッション').getRange(g34().row, SC.DATE + 1).setValue(addDays_(new Date(), 12));
bulkUpdateSessions({ ids: [ad.id], action: 'status', value: '開催' });
assert(g34().status === '開催' && g34().window === '', '一括で予定にすると期間は消える');
// 期間を過ぎた調整中はお知らせに出る。自動では変えない
var ad3 = saveSession({ name: '過ぎた調整', gm: 'ボブ', members: [], extra: '', status: '調整中', windowFrom: ymd_(addDays_(new Date(), -10)), windowTo: ymd_(addDays_(new Date(), -3)), notify: false });
refreshAll();
calText34 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText34.indexOf('⚪ 候補の期間を過ぎています: 過ぎた調整') >= 0, '期間を過ぎた調整中を知らせる');
assert(autoFinishPast_(loadContext_(SS._proxy)) === 0, '調整中は自動では変えない');
// 並び: 募集の期間と調整中の期間を同じ物差しで
var srt34 = sortSessions_([{ name: 'b', date: null, ymd: '', windowKey: '2026-11-16', start: '' }, { name: 'a', date: null, ymd: '', windowKey: '2026-11-01', start: '' }, { name: 'c', date: null, ymd: '', windowKey: '', start: '' }]).map(function (s) { return s.name; });
assert(srt34.join('') === 'abc', '募集も調整中も期間の始まりで並べる: ' + srt34.join(''));
// 案内の本文に期間
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
FETCHES.length = 0;
notifySessionNow({ id: ad3.id, me: 'ボブ' });
assert(FETCHES[0].body.embeds[0].title === '過ぎた調整（調整中）' && FETCHES[0].body.embeds[0].description.indexOf('のどこか（調整中）') >= 0, '案内に期間と調整中が載る');
// 古いシートにも「期間」の見出しが足される
sheetOf('セッション').getRange(1, SC.WINDOW + 1).setValue('');
ensureSheets_(SS._proxy);
assert(sheetOf('セッション').getRange(1, SC.WINDOW + 1).getValue() === '期間', '見出しに「期間」が足される');

// 35. 古い入力規則のまま新しい版を貼っても、最初の書き込みでシートを整え直してから書く
assert(SPROPS[SCHEMA_KEY] === SCHEMA_VERSION, '整えたあとは版が控えられている');
var ses35 = sheetOf('セッション');
ses35.validations = ses35.validations.filter(function (v) { return v[1] !== SC.STATUS + 1; });
ses35.validations.push([2, SC.STATUS + 1, 100, 1, ['募集', '予定', '開催', '終了', '中止']]);   // 旧い版のドロップダウン
delete SPROPS[SCHEMA_KEY];
var st35 = saveSession({ name: '規則が古い卓', gm: 'ボブ', members: [], extra: '', status: '調整中', windowFrom: ymd_(addDays_(new Date(), 30)), windowTo: ymd_(addDays_(new Date(), 40)), notify: false });
var rule35 = ses35.validations.filter(function (v) { return v[1] === SC.STATUS + 1; }).pop();
assert(st35.ok && rule35 && rule35[4].indexOf('調整中') >= 0 && SPROPS[SCHEMA_KEY] === SCHEMA_VERSION, '版が古ければ書く前に入力規則を作り直し、版を控える: ' + rule35[4].join(','));
var n35 = ses35.validations.length;
saveSession({ name: '規則が新しい卓', gm: 'ボブ', members: [], extra: '', status: '調整中', notify: false });
assert(ses35.validations.length === n35, '版が新しければ整え直さない');

// 36. 空欄は「参加できる」。○ は無くし、旧い ○ は空欄として読む
err = null; try { setAvailability('ダン', ymd_(addDays_(new Date(), 5)), '○'); } catch (e) { err = e.message; }
assert(err && err.indexOf('△ か ×') >= 0, '○ は書けない');
var d36 = ymd_(addDays_(new Date(), 45));
var names36 = getMembers_(SS._proxy).map(function (m) { return m.name; });
var nm36 = names36[0];
var avs36 = sheetOf('都合'), hdr36 = avs36.getRange(1, 1, 1, avs36.getLastColumn()).getValues()[0].map(function (v) { return String(v); });
var row36 = getConsoleData().availDays.indexOf(d36) + 2;
assert(hdr36.indexOf(nm36) >= 3 && row36 >= 2, '（前提）都合表に列と行がある: ' + nm36);
avs36.getRange(row36, hdr36.indexOf(nm36) + 1).setValue('○');   // 旧い版の印
assert(getAvailability_(SS._proxy)[d36] === undefined || !getAvailability_(SS._proxy)[d36][nm36], '旧い ○ は空欄として読む');
var ctx36 = loadContext_(SS._proxy);
names36.forEach(function (n) { if (ctx36.avail[d36]) delete ctx36.avail[d36][n]; });
assert(availabilityMap_(ctx36, TARGET_ALL)[d36] === 'ok', '誰も印を付けていない日は全員空き');
ctx36.avail[d36] = ctx36.avail[d36] || {}; ctx36.avail[d36][names36[0]] = '△';
assert(availabilityMap_(ctx36, TARGET_ALL)[d36] === 'soft', '△ の人がいれば「△あり」');
ctx36.avail[d36][names36[1]] = '×';
assert(availabilityMap_(ctx36, TARGET_ALL)[d36] === undefined, '× の人がいれば色は付かない');
refreshAll();
assert(String(sheetOf('都合').getRange(row36, hdr36.indexOf(nm36) + 1).getValue() || '') === '', '作り直すと旧い ○ は空欄になる');
var rule36 = sheetOf('都合').validations.filter(function (v) { return v[4] && v[4].indexOf('△') >= 0; }).pop();
assert(rule36 && rule36[4].indexOf('○') < 0 && rule36[4].indexOf('×') >= 0 && rule36[4].indexOf('参') >= 0, '都合のドロップダウンに ○ は無い: ' + rule36[4].join(','));
var calText36 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText36.indexOf('全員空き') >= 0 && calText36.indexOf('全員○') < 0, '凡例も「全員空き」');

// 37. 日程調整。調整中の卓に候補日を出し、全員が答えたら GM に知らせ、GM が選んだ日に開催日が決まる
var pw1 = ymd_(addDays_(new Date(), 60)), pw2 = ymd_(addDays_(new Date(), 70));
var pd1 = ymd_(addDays_(new Date(), 62)), pd2 = ymd_(addDays_(new Date(), 64)), pd3 = ymd_(addDays_(new Date(), 66));
var ps = saveSession({ name: '日程を決める卓', gm: 'ボブ', members: ['アリス', 'カレン'], extra: '', status: '調整中', windowFrom: pw1, windowTo: pw2, notify: false });
var g37 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === (id || ps.id); })[0]; };
var votes37 = function (id) { return getPollVotes_(SS._proxy)[id || ps.id] || {}; };
assert(sheetOf('日程調整') && sheetOf('日程調整').getRange(1, 1, 1, 5).getValues()[0].join(',') === '卓ID,日付,名前,回答,更新日時', '「日程調整」シートがある');
assert(sheetOf('セッション').getRange(1, SC.CANDS + 1).getValue() === '候補日', 'セッションに「候補日」の列がある');
// 弾く
err = null; try { startPoll({ id: ps.id, dates: [], me: 'ボブ' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('1 日以上') >= 0, '候補日が無ければ弾く');
err = null; try { startPoll({ id: ps.id, dates: [ymd_(addDays_(new Date(), -1))], me: 'ボブ' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('過ぎた日') >= 0, '過ぎた日は候補にできない');
err = null; try { startPoll({ id: t16.id, dates: [pd1] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日程調整中ではありません') >= 0, '調整中でない卓では始められない');
var ps0 = saveSession({ name: '参加者のいない調整', gm: 'ボブ', members: [], extra: '', status: '調整中', notify: false });
err = null; try { startPoll({ id: ps0.id, dates: [pd1] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('参加者がいません') >= 0, '参加者のいない卓では始められない');
// 始める
var st37 = startPoll({ id: ps.id, dates: [pd2, pd1, pd1], start: '20:00', end: '23:00', me: 'ボブ' });
assert(st37.ok && st37.fresh && !st37.decided && g37().candidates.join(',') === [pd1, pd2].join(',') && g37().start === '20:00' && g37().end === '23:00', '候補日は重なりを除いて日付順に残り、時間も入る: ' + st37.message);
assert(votes37()[pd1]['ボブ'].vote === '◯' && votes37()[pd2]['ボブ'].vote === '◯' && !votes37()[pd1]['アリス'], '出した人（GM のボブ）の ◯ は最初から付く');
var cs37 = st37.data.sessions.filter(function (s) { return s.id === ps.id; })[0];
assert(cs37.candidates.length === 2 && cs37.votes[pd1]['ボブ'] === '◯', '画面用データに候補日と回答が載る');
// 回答: 弾く
err = null; try { setPollVote({ id: ps.id, ymd: pd1, name: 'ダン', vote: '◯' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('GM でも参加者でもない') >= 0, 'GM・参加者でない人は回答できない');
err = null; try { setPollVote({ id: ps.id, ymd: pd3, name: 'アリス', vote: '◯' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('候補日ではありません') >= 0, '候補日でない日には回答できない');
err = null; try { setPollVote({ id: ps.id, ymd: pd1, name: 'アリス', vote: '△' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('◯ か ×') >= 0, '回答は ◯ か × だけ');
err = null; try { setPollVote({ id: ps.id, ymd: pd1, name: '', vote: '◯' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('あなた') >= 0, '名前が無ければ弾く');
// 回答
var v1 = setPollVote({ id: ps.id, ymd: pd1, name: 'アリス', vote: '◯' });
var v2 = setPollVote({ id: ps.id, ymd: pd1, name: 'カレン', vote: '×' });
assert(!v1.decided && !v2.decided && votes37()[pd1]['カレン'].vote === '×' && g37().status === '調整中', '× の人がいれば決まらない');
var rows37 = sheetOf('日程調整').getLastRow();
setPollVote({ id: ps.id, ymd: pd1, name: 'カレン', vote: '' });
assert(!votes37()[pd1]['カレン'] && sheetOf('日程調整').getLastRow() === rows37 - 1, '空で送ると回答を取り消せる（行が消える）');
// 選び直し: pd2 を外して pd3 を足す
var re37 = startPoll({ id: ps.id, dates: [pd1, pd3], start: '20:00', end: '23:00', me: 'ボブ' });
assert(!re37.fresh && !re37.decided && g37().candidates.join(',') === [pd1, pd3].join(',') && !votes37()[pd2] && votes37()[pd1]['アリス'].vote === '◯' && votes37()[pd3]['ボブ'].vote === '◯', '選び直すと、外した日の回答は消え、残した日の回答は残り、足した日に出した人の ◯ が付く');
// シートの表示（決まる前）
refreshAll();
var calText37 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
assert(calText37.indexOf('日程を決める卓（GM: ボブ、候補日 2 日・未回答 2 人）') >= 0, 'お知らせに候補日の数と未回答の人数: ' + (calText37.match(/🔶[^\n]*/) || [''])[0].slice(0, 120));
// Discord で知らせる
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/mock');
var kar37 = getMembers_(SS._proxy).filter(function (m) { return m.name === 'カレン'; })[0];
assert(kar37, '（前提）カレンはメンバー');
saveMember({ oldName: 'カレン', name: 'カレン', discordId: '222222222222222222', note: kar37.note });
FETCHES.length = 0; FETCH_CODE = 204; FETCH_BODY = null;
var dp37 = sendDiscordStep({ kind: 'poll', id: ps.id, attempt: 1, me: 'ボブ' });
var c37 = FETCHES[0].body.content;
assert(dp37.ok && c37.indexOf('<@222222222222222222>') >= 0 && c37.indexOf('アリス さん') >= 0 && c37.indexOf(fmtDateJa_(toDate_(pd1))) >= 0 && c37.indexOf(fmtDateJa_(toDate_(pd3))) >= 0 && c37.indexOf('20:00〜23:00') >= 0 && c37.indexOf('「募集・調整」タブ') >= 0 && c37.indexOf('GM が開催日を選びます') >= 0, '知らせに呼びかけ・候補日・時間・答え方が入る: ' + c37.replace(/\n/g, ' / ').slice(0, 160));
assert(FETCHES[0].body.embeds[0].description.indexOf('候補日: ') >= 0, '添える卓の内容にも候補日が出る');
// 全員の回答がそろったら ready を返す（自動では決めない）
assert(!setPollVote({ id: ps.id, ymd: pd3, name: 'アリス', vote: '◯' }).ready, 'まだカレンが答えていない');
assert(!setPollVote({ id: ps.id, ymd: pd1, name: 'カレン', vote: '×' }).ready, 'カレンにまだ答えていない候補日がある');
FETCHES.length = 0;
var rd37 = setPollVote({ id: ps.id, ymd: pd3, name: 'カレン', vote: '◯' });
assert(rd37.notified === true && FETCHES.length === 1 && FETCHES[0].body.content.indexOf('回答がそろいました') >= 0, 'そろった知らせはサーバーからその場で送る（画面を閉じても届く）');
assert(rd37.ready && !rd37.decided && g37().status === '調整中' && rd37.message.indexOf('そろいました') >= 0, '全員が答えると ready。全員が ◯ の日があっても決まらない: ' + rd37.message);
assert(!setPollVote({ id: ps.id, ymd: pd1, name: 'カレン', vote: '◯' }).ready, 'そろったあとに答えを変えても、もう ready にならない');
assert(!setPollVoteAll({ id: ps.id, name: 'アリス', vote: '◯' }).ready, '「どの日でもいい」でも、そろったあとは ready にならない');
FETCHES.length = 0;
var pr37 = sendDiscordStep({ kind: 'pollReady', id: ps.id, attempt: 1, me: 'カレン' });
var cr37 = FETCHES[0].body.content;
assert(pr37.ok && cr37.indexOf('回答がそろいました') >= 0 && cr37.indexOf('<@111111111111111111>') >= 0 && cr37.indexOf('<@222222222222222222>') < 0 && cr37.indexOf(fmtDateJa_(toDate_(pd3)) + '　◯ 3/3（全員 ◯）') >= 0, 'そろった知らせは GM だけを呼び、候補日ごとの ◯ の数を並べる: ' + cr37.replace(/\n/g, ' / ').slice(0, 200));
// GM が選んで決める
err = null; try { decidePoll({ id: ps.id, ymd: pd2, me: 'ボブ' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('候補日ではありません') >= 0, '候補日でない日には決められない');
FETCHES.length = 0;
var dec37 = decidePoll({ id: ps.id, ymd: pd3, me: 'ボブ' });
assert(dec37.notified === true && FETCHES.length === 1 && FETCHES[0].body.content.indexOf('日程が決まりました') >= 0 && FETCHES[0].body.content.indexOf('<@222222222222222222>') >= 0, '決まった知らせはサーバーからその場で送り、参加者をメンションする');
assert(dec37.decided === pd3 && dec37.message.indexOf('日程を決めました') >= 0, 'GM が選んだ日に決まる: ' + dec37.message);
var gd37 = g37();
assert(gd37.status === '開催' && gd37.ymd === pd3 && gd37.start === '20:00' && gd37.end === '23:00' && gd37.candidates.length === 0 && gd37.window === '' && !getPollVotes_(SS._proxy)[ps.id], '状態は「予定」、開催日は決まった日、候補日・期間・回答は片付く');
assert(bookedMap_(loadContext_(SS._proxy))[pd3]['カレン'] === '参' && bookedMap_(loadContext_(SS._proxy))[pd3]['ボブ'] === 'GM', '決まった日には都合表の「参」「GM」が付く');
assert(dec37.data.sessions.some(function (s) { return s.id === ps.id && s.status === '開催' && s.date === pd3; }), '返事のデータにも決まった日');
FETCHES.length = 0;
var dd37 = sendDiscordStep({ kind: 'decided', id: ps.id, attempt: 1, me: 'カレン' });
assert(dd37.ok && FETCHES[0].body.content.indexOf('日程が決まりました') >= 0 && FETCHES[0].body.content.indexOf(fmtDateJa_(toDate_(pd3))) >= 0 && FETCHES[0].body.content.indexOf('<@222222222222222222>') >= 0, '決まった知らせに日付と呼びかけ');
err = null; try { startPoll({ id: ps.id, dates: [pd1] }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日程調整中ではありません') >= 0, '決まった卓ではもう始められない');
err = null; try { sendDiscordStep({ kind: 'poll', id: ps.id, attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日程調整をしていません') >= 0, '決まった卓の日程調整の知らせは送れない');
// やめる・始め直す
var ps2 = saveSession({ name: 'やめる調整', gm: 'ボブ', members: ['アリス'], extra: '', status: '調整中', notify: false });
var s2 = startPoll({ id: ps2.id, dates: [pd1], me: 'アリス' });
assert(!s2.decided && votes37(ps2.id)[pd1]['アリス'].vote === '◯', '参加者が出しても、その人の ◯ が付く（GM がまだなので決まらない）');
var cp37 = cancelPoll({ id: ps2.id });
assert(cp37.ok && g37(ps2.id).candidates.length === 0 && !getPollVotes_(SS._proxy)[ps2.id] && g37(ps2.id).status === '調整中', 'やめると候補日と回答が消え、卓は調整中のまま');
startPoll({ id: ps2.id, dates: [pd1], me: 'ダン' });
assert(!getPollVotes_(SS._proxy)[ps2.id], '出した人が GM・参加者でなければ ◯ は付かない');
// 編集では残り、状態を変えると消える
saveSession({ id: ps2.id, name: 'やめる調整', gm: 'ボブ', members: ['アリス'], extra: '', status: '調整中', notify: false });
assert(g37(ps2.id).candidates.join(',') === pd1, '調整中のまま直しても候補日は残る');
bulkUpdateSessions({ ids: [ps2.id], action: 'status', value: '募集' });
assert(g37(ps2.id).candidates.length === 0, '状態を変えると候補日は消える');
// 卓を消すと回答も消える
var ps3 = saveSession({ name: '消す調整', gm: 'ボブ', members: ['アリス'], extra: '', status: '調整中', notify: false });
startPoll({ id: ps3.id, dates: [pd2], me: 'ボブ' });
assert(getPollVotes_(SS._proxy)[ps3.id], '（前提）回答がある');
deleteSession({ id: ps3.id, notify: false });
assert(!getPollVotes_(SS._proxy)[ps3.id], '卓を消すと回答も消える');
// シートの表示
var ps4 = saveSession({ name: '表示の調整', gm: 'ボブ', members: ['アリス'], extra: '', status: '調整中', notify: false });
startPoll({ id: ps4.id, dates: [ymd_(addDays_(new Date(), 5))], me: 'ボブ' });
refreshAll();
calText37 = Object.keys(sheetOf('カレンダー').cells).map(function (k) { return String(sheetOf('カレンダー').cells[k]); }).join('\n');
var avText37 = Object.keys(sheetOf('都合').cells).map(function (k) { return String(sheetOf('都合').cells[k]); }).join('\n');
assert(calText37.indexOf('🗳 候補日: 表示の調整') >= 0 && avText37.indexOf('候補: 表示の調整') >= 0, 'カレンダーと都合シートに候補日が出る');
assert(parseCands_('2026/10/03、2026-10-01 2026/10/03') .join(',') === '2026-10-01,2026-10-03' && parseCands_('') .length === 0, '候補日の読み取り（区切りの違い・重なり・空）');

// 38. 旧い「予定」の読み替え、シリーズの最終日、単発の卓からのシリーズ化
var sesSheet38 = sheetOf('セッション');
var old38 = saveSession({ name: '旧い状態の卓', gm: 'アリス', members: [], extra: '', date: ymd_(addDays_(new Date(), 6)), start: '20:00', end: '', status: '開催', notify: false });
var row38 = getSessions_(SS._proxy).filter(function (s) { return s.id === old38.id; })[0].row;
sesSheet38.getRange(row38, SC.STATUS + 1).setValue('予定');
var g38 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0]; };
assert(g38(old38.id).status === '開催', '旧い版の「予定」は「開催」として読む');
assert(getConsoleData().statuses.indexOf('予定') < 0, '状態の一覧に「予定」は無い');
ensureSheets_(SS._proxy);
assert(String(sesSheet38.getRange(row38, SC.STATUS + 1).getValue()) === '開催', 'シートを整え直すと、セルの「予定」も「開催」に書き換わる');

var end38 = ymd_(addDays_(new Date(), 40));
var sa38 = saveSession({ name: '灰の街 #1', series: '灰の街', seriesEnd: end38, gm: 'ボブ', members: ['アリス'], extra: '', date: ymd_(addDays_(new Date(), 7)), start: '20:00', end: '', status: '開催', notify: false });
assert(g38(sa38.id).seriesEnd === end38, 'シリーズの最終日を保存して読み出せる');
assert(getConsoleData().sessions.filter(function (s) { return s.id === sa38.id; })[0].seriesEnd === end38, '画面用データにシリーズの最終日が載る');
var sb38 = saveSession({ id: sa38.id, name: '灰の街 #1', series: '灰の街', seriesEnd: 'よめない', gm: 'ボブ', members: ['アリス'], extra: '', date: ymd_(addDays_(new Date(), 7)), start: '20:00', end: '', status: '開催', notify: false });
assert(sb38.ok && g38(sa38.id).seriesEnd === '', '読めない最終日は空にする');
var sc38 = saveSession({ name: 'シリーズなしの卓', gm: 'ダン', members: ['ボブ'], extra: '', date: ymd_(addDays_(new Date(), 8)), start: '20:00', end: '', status: '開催', notify: false });
assert(g38(sc38.id).series === '', '単発の卓はシリーズなしで登録できる');
var sd38 = saveSession({ name: 'シリーズなしの卓 2', series: 'シリーズなしの卓', seriesFrom: sc38.id, gm: 'ダン', members: ['ボブ'], extra: '', date: ymd_(addDays_(new Date(), 9)), start: '20:00', end: '', status: '開催', notify: false });
assert(sd38.ok && g38(sc38.id).series === 'シリーズなしの卓' && g38(sd38.id).series === 'シリーズなしの卓', '「続けて登録」で前の回もシリーズに入る');
assert(sd38.message.indexOf('前の回も') >= 0, '返事にシリーズにまとめた旨が入る: ' + sd38.message);
var se38 = saveSession({ name: '灰の街 #2', series: '別のシリーズ', seriesFrom: sa38.id, gm: 'ボブ', members: [], extra: '', date: ymd_(addDays_(new Date(), 10)), start: '20:00', end: '', status: '開催', notify: false });
assert(g38(sa38.id).series === '灰の街', 'もうシリーズがある回は、名前を書き換えない');

// 39. シリーズごとの通知: 送り先のチャンネルと、前日通知の時刻
FETCH_CODE = 204;
var base39 = 'https://discord.com/api/webhooks/base/1';
var ser39 = 'https://discord.com/api/webhooks/series/2';
saveConsoleSettings({ webhook: base39, hour: '20' });
var sh39 = sheetOf('セッション');
getSessions_(SS._proxy).forEach(function (x) { sh39.getRange(x.row, SC.NOTIFIED + 1).setValue('済'); });
var t39 = ymd_(addDays_(new Date(), 1));
var a39 = saveSession({ name: '夜更けの回 #1', series: '夜更けの回', gm: 'アリス', members: ['ボブ'], extra: '', date: t39, start: '22:00', end: '', status: '開催', notify: false });
var b39 = saveSession({ name: '単発の卓', gm: 'ボブ', members: [], extra: '', date: t39, start: '20:00', end: '', status: '開催', notify: false });
err = null; try { saveSeriesNotify({ series: '夜更けの回', webhook: 'https://example.com/x' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('Webhook URL の形') >= 0, 'シリーズの Webhook も Discord の形でなければ弾く');
err = null; try { saveSeriesNotify({ series: '夜更けの回', hour: '25' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('0〜23') >= 0, 'シリーズの時刻は 0〜23');
err = null; try { saveSeriesNotify({ series: '' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('シリーズ') >= 0, 'シリーズ名なしは弾く');
var sv39 = saveSeriesNotify({ series: '夜更けの回', webhook: ser39, alsoBase: false, hour: '21' });
var cd39 = sv39.data.seriesNotify.filter(function (x) { return x.series === '夜更けの回'; })[0];
assert(sv39.ok && cd39 && cd39.hasWebhook && cd39.webhookMasked !== ser39 && cd39.webhookMasked.indexOf('…') >= 0 && cd39.alsoBase === false && cd39.hour === 21, 'シリーズの送り先と時刻を保存し、画面用データでは URL を伏せる: ' + sv39.message);
assert(sheetOf('シリーズ通知').getLastRow() === 2, 'シリーズ通知シートに 1 行');
var ctx39 = loadContext_(SS._proxy);
var tg39 = discordTargets_(ctx39, '夜更けの回');
assert(tg39.length === 1 && tg39[0].url === ser39, '基本にも送るが OFF なら、シリーズのチャンネルだけ');
assert(discordTargets_(ctx39, '').length === 1 && discordTargets_(ctx39, '')[0].url === base39, 'シリーズの無い卓は基本のチャンネル');
assert(discordTargets_(ctx39, '別のシリーズ')[0].url === base39, '設定の無いシリーズも基本のチャンネル');
saveSeriesNotify({ series: '夜更けの回', alsoBase: true });
ctx39 = loadContext_(SS._proxy);
tg39 = discordTargets_(ctx39, '夜更けの回');
assert(tg39.length === 2 && tg39[0].url === ser39 && tg39[1].url === base39 && getSeriesNotify_(SS._proxy)['夜更けの回'].hour === 21, '基本にも送るが ON なら両方へ。URL と時刻はそのまま残る');
// 毎時の見回り
FETCHES.length = 0;
var log39 = sheetOf('通知ログ').getLastRow();
dailyNotify({ testHour: 19 });
assert(FETCHES.length === 0 && sheetOf('通知ログ').getLastRow() === log39, '19 時: まだどの卓も送る時刻ではなく、通知ログも増やさない');
dailyNotify({ testHour: 20 });
assert(FETCHES.length === 1 && FETCHES[0].url === base39 && FETCHES[0].body.embeds.length === 1 && FETCHES[0].body.embeds[0].title === '単発の卓', '20 時: 基本の時刻の卓だけを、基本のチャンネルへ');
dailyNotify({ testHour: 21 });
assert(FETCHES.length === 3 && FETCHES[1].url === ser39 && FETCHES[2].url === base39 && FETCHES[1].body.embeds[0].title === '夜更けの回 #1' && FETCHES[2].body.embeds[0].title === '夜更けの回 #1', '21 時: シリーズの卓を、シリーズのチャンネルと基本のチャンネルの両方へ');
var g39 = function (id) { return getSessions_(SS._proxy).filter(function (x) { return x.id === id; })[0]; };
assert(g39(a39.id).notified && g39(b39.id).notified, 'どちらの卓も通知済みになる');
var logText39 = sheetOf('通知ログ').getRange(2, 1, sheetOf('通知ログ').getLastRow() - 1, 4).getValues().map(function (r) { return r.join(' '); }).join('\n');
assert(logText39.indexOf('夜更けの回 #1（シリーズ「夜更けの回」のチャンネル）') >= 0, '通知ログに、どのチャンネルへ送ったかが残る');
var log39b = sheetOf('通知ログ').getLastRow();
dailyNotify({ testHour: 22 });
assert(FETCHES.length === 3 && sheetOf('通知ログ').getLastRow() === log39b, '22 時: もう送るものは無く、通知ログも増やさない');
// 画面から 1 か所ずつ送る
FETCHES.length = 0;
var st0 = sendDiscordStep({ kind: 'announce', id: a39.id, attempt: 1, to: 0 });
var st1 = sendDiscordStep({ kind: 'announce', id: a39.id, attempt: 1, to: 1 });
assert(st0.ok && st0.targetCount === 2 && st0.to === 0 && FETCHES[0].url === ser39 && st1.ok && st1.to === 1 && FETCHES[1].url === base39 && st1.targetLabel === '基本のチャンネル', '画面からは送り先を 1 か所ずつ送る（シリーズ → 基本）');
var tst39 = sendDiscordStep({ kind: 'test', series: '夜更けの回', attempt: 1 });
assert(tst39.ok && tst39.targetCount === 1 && FETCHES[2].url === ser39 && FETCHES[2].body.content.indexOf('夜更けの回') >= 0, 'シリーズのチャンネルだけに接続テストを送れる');
err = null; try { sendDiscordStep({ kind: 'test', series: '別のシリーズ', attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('専用の Webhook URL') >= 0, '専用の URL が無いシリーズの接続テストは断る');
var dl39 = sendDiscordStep({ kind: 'delete', name: '消した回', series: '夜更けの回', attempt: 1 });
assert(dl39.ok && dl39.targetCount === 2 && FETCHES[3].url === ser39, '消した卓の知らせも、シリーズの送り先へ');
FETCHES.length = 0;
sendDiscordStep({ kind: 'bulk', names: ['まとめ'], label: '変更', attempt: 1 });
assert(FETCHES.length === 1 && FETCHES[0].url === base39, 'まとめての変更は基本のチャンネルへ');
var bk39 = sendDiscordStep({ kind: 'bulk', names: ['夜更けの回 #2', '夜更けの回 #3'], label: '登録', series: '夜更けの回', attempt: 1, to: 0 });
assert(bk39.ok && bk39.targetCount === 2 && FETCHES[1].url === ser39, '同じシリーズの回をまとめて登録したときは、そのシリーズの送り先へ');
FETCHES.length = 0;
saveSession({ id: a39.id, name: '夜更けの回 #1', series: '夜更けの回', gm: 'アリス', members: ['ボブ'], extra: '', date: t39, start: '22:30', end: '', status: '開催', notify: true });
assert(FETCHES.length === 2 && FETCHES[0].url === ser39 && FETCHES[1].url === base39, '保存と同時の知らせも、シリーズの送り先（両方）へ');
var rm39 = saveSeriesNotify({ series: '夜更けの回', remove: true });
assert(rm39.ok && sheetOf('シリーズ通知').getLastRow() === 1 && discordTargets_(loadContext_(SS._proxy), '夜更けの回')[0].url === base39 && notifyHourOf_(loadContext_(SS._proxy), g39(a39.id)) === 20, '設定を消すと、基本のチャンネルと基本の時刻に戻る');
// 旧い「毎日 1 回」のトリガーの置き換え
TRIGGERS.length = 0;
TRIGGERS.push({ fn: 'dailyNotify', hour: 20, days: 1 });
PropertiesService.getScriptProperties().deleteProperty('NOTIFY_TRIGGER');
ensureSheets_(SS._proxy);
assert(dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1, '旧い「毎日 1 回」のトリガーは、シートを整え直すと毎時の見回りに置き換わる');
ensureSheets_(SS._proxy);
assert(dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1, '置き換えは 1 度だけ');

// 40. 開催前の知らせ: 開催日の何日前の何時台に送るか（基本とシリーズごと）
FETCH_CODE = 204;
setSetting_(SS._proxy, '自動通知の設定者', 'テスト / 2026/09/19 10:00');
var sh40 = sheetOf('セッション');
getSessions_(SS._proxy).forEach(function (x) { sh40.getRange(x.row, SC.NOTIFIED + 1).setValue('済'); });
var ahead40 = function (n) { return ymd_(addDays_(new Date(), n)); };
var g40 = function (id) { return getSessions_(SS._proxy).filter(function (x) { return x.id === id; })[0]; };
err = null; try { saveConsoleSettings({ days: '31' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('0〜30') >= 0, '何日前は 0〜30');
err = null; try { saveConsoleSettings({ days: '1.5' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('整数') >= 0, '何日前は整数');
err = null; try { saveConsoleSettings({ hour: '24' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('0〜23') >= 0, '時刻は 0〜23');
err = null; try { saveSeriesNotify({ series: '夜更けの回', days: '-1' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('0〜30') >= 0, 'シリーズの何日前も 0〜30');
var sc40 = saveConsoleSettings({ days: '3', hour: '9' });
var st40 = getSettings_(SS._proxy);
assert(sc40.ok && st40['開催前の知らせ（何日前）'] === 3 && st40['開催前の知らせ（時刻）'] === 9 && sc40.data.settings.notifyDays === 3 && sc40.data.settings.notifyHour === 9 && sc40.message.indexOf('3 日前の 9 時台') >= 0, '基本の日と時刻を保存: ' + sc40.message);
assert(sheetOf('設定').getLastRow() === 1 + DEFAULT_SETTINGS.length, '設定の行は増えない');
var x3 = saveSession({ name: '三日後の卓', gm: 'アリス', members: ['ボブ'], extra: '', date: ahead40(3), start: '21:00', end: '', status: '開催', notify: false });
var x1 = saveSession({ name: '明日の卓（基本は 3 日前）', gm: 'ボブ', members: [], extra: '', date: ahead40(1), start: '21:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
dailyNotify({ testHour: 8 });
assert(FETCHES.length === 0, '8 時: まだ送らない');
dailyNotify({ testHour: 9 });
assert(FETCHES.length === 1 && FETCHES[0].body.embeds.length === 1 && FETCHES[0].body.embeds[0].title === '三日後の卓' && FETCHES[0].body.content.indexOf('📢 3 日後は卓の日です！') === 0, '9 時: 3 日後の卓だけを送る。見出しは「3 日後は卓の日です」: ' + (FETCHES[0] && FETCHES[0].body.content));
assert(g40(x3.id).notified && !g40(x1.id).notified, '送った卓だけ通知済み。開催前の知らせの日を過ぎた明日の卓は送らない');
// シリーズだけ「当日の 12 時台」
var sv40 = saveSeriesNotify({ series: '当日の回', days: '0', hour: '12' });
var cd40 = sv40.data.seriesNotify.filter(function (x) { return x.series === '当日の回'; })[0];
assert(sv40.ok && cd40 && cd40.days === 0 && cd40.hour === 12 && !cd40.hasWebhook && sv40.message.indexOf('当日の 12 時台') >= 0, 'シリーズの日と時刻を保存（URL 無しでもよい）: ' + sv40.message);
var x0 = saveSession({ name: '当日の回 #1', series: '当日の回', gm: 'アリス', members: [], extra: '', date: ahead40(0), start: '21:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
dailyNotify({ testHour: 11 });
assert(FETCHES.length === 0, '11 時: 当日の回はまだ');
dailyNotify({ testHour: 12 });
assert(FETCHES.length === 1 && FETCHES[0].body.embeds[0].title === '当日の回 #1' && FETCHES[0].body.content.indexOf('📢 今日は卓の日です！') === 0 && FETCHES[0].url === 'https://discord.com/api/webhooks/base/1', '12 時: 当日の回を基本のチャンネルへ、見出しは「今日は卓の日です」');
// 同じ時刻・同じチャンネルでも、「あと何日」が違えば分けて送る
saveSeriesNotify({ series: 'あさっての回', days: '2', hour: '9' });
var y3 = saveSession({ name: '三日後の卓 その2', gm: 'ボブ', members: [], extra: '', date: ahead40(3), start: '20:00', end: '', status: '開催', notify: false });
var y2 = saveSession({ name: 'あさっての回 #1', series: 'あさっての回', gm: 'ボブ', members: [], extra: '', date: ahead40(2), start: '20:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
dailyNotify({ testHour: 9 });
var heads40 = FETCHES.map(function (f) { return f.body.content.split('！')[0]; }).sort().join(' / ');
assert(FETCHES.length === 2 && heads40 === '📢 3 日後は卓の日です / 📢 あさっては卓の日です', '「あと何日」ごとに 1 通ずつ: ' + heads40);
assert(notifyYmdOf_(loadContext_(SS._proxy), g40(y2.id)) === ahead40(0) && notifyHourOf_(loadContext_(SS._proxy), g40(y2.id)) === 9 && notifyDaysOf_(loadContext_(SS._proxy), g40(x1.id)) === 3, '卓ごとの送る日と時刻');
// 画面から案内を送ったとき: 今日が開催前の知らせの日なら通知済みにする
var a40 = saveSession({ name: '案内で済ます卓', gm: 'アリス', members: [], extra: '', date: ahead40(3), start: '20:00', end: '', status: '開催', notify: false });
var an40 = sendDiscordStep({ kind: 'announce', id: a40.id, attempt: 1 });
assert(an40.ok && an40.notified === true && g40(a40.id).notified, '今日が開催前の知らせの日の卓は、案内を送ると開催前の知らせ済みになる');
var b40 = saveSession({ name: '案内だけの卓', gm: 'アリス', members: [], extra: '', date: ahead40(5), start: '20:00', end: '', status: '開催', notify: false });
var bn40 = sendDiscordStep({ kind: 'announce', id: b40.id, attempt: 1 });
assert(bn40.ok && !bn40.notified && !g40(b40.id).notified, '開催前の知らせの日がまだ先の卓は、案内を送っても開催前の知らせ済みにしない');
var nn40 = notifySessionNow({ id: a40.id });
assert(nn40.ok && nn40.message.indexOf('今日が開催前の知らせの日なので') >= 0, '案内（旧い入口）も同じ: ' + nn40.message);
// 開催前の知らせの状態の文言（基本は 3 日前の 9 時台）
var ctx40 = loadContext_(SS._proxy);
assert(notifyStateText_(ctx40, g40(x3.id)) === '開催前の知らせ 送信済み' && notifyStateText_(ctx40, g40(x1.id)) === '開催前の知らせ 未送信' && notifyStateText_(ctx40, g40(b40.id)) === '開催前の知らせ ' + fmtDateJa_(addDays_(new Date(), 2)) + ' 9 時台に送る',
  '状態: 送信済み／送る日を過ぎた未送信／これから送る日時: ' + notifyStateText_(ctx40, g40(b40.id)));
// シートのお知らせ: 明日の卓の開催前の知らせが、いつ送られるか
saveConsoleSettings({ days: '1', hour: '20' });
var z1 = saveSession({ name: '明日の卓（前日 20 時）', gm: 'アリス', members: [], extra: '', date: ahead40(1), start: '20:00', end: '', status: '開催', notify: false });
refreshAll();
var cal40 = Object.keys(cal.cells).map(function (k) { return String(cal.cells[k]); }).join('\n');
assert(cal40.indexOf('開催前の知らせ ' + fmtDateJa_(new Date()) + ' 20 時台に送る') >= 0, 'お知らせに「開催前の知らせ 今日の日付 20 時台に送る」');
setSetting_(SS._proxy, '自動通知の設定者', '');
assert(notifyStateText_(loadContext_(SS._proxy), g40(z1.id)) === '開催前の知らせ 未設定', '自動通知を有効にしていなければ「未設定」');
// 旧い版の設定シート: 「前日通知の時刻」を読み替え、整え直すと名前を直す
var st40s = sheetOf('設定');
var keys40 = st40s.getRange(2, 1, st40s.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
var hr40 = keys40.indexOf('開催前の知らせ（時刻）') + 2, dy40 = keys40.indexOf('開催前の知らせ（何日前）') + 2;
st40s.getRange(hr40, 1).setValue('前日通知の時刻'); st40s.getRange(hr40, 2).setValue(18);
st40s.deleteRow(dy40);
assert(getSettings_(SS._proxy)['開催前の知らせ（時刻）'] === 18 && getSettings_(SS._proxy)['開催前の知らせ（何日前）'] === 1, '旧い項目名のままでも時刻を読め、何日前は既定の 1');
setSetting_(SS._proxy, '開催前の知らせ（時刻）', 19);
assert(st40s.getRange(hr40, 1).getValue() === '開催前の知らせ（時刻）' && st40s.getRange(hr40, 2).getValue() === 19, '書くときに旧い行を今の名前に直す');
st40s.getRange(hr40, 1).setValue('前日通知の時刻');
ensureSheets_(SS._proxy);
var keys40b = st40s.getRange(2, 1, st40s.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
assert(keys40b.indexOf('前日通知の時刻') < 0 && st40s.getRange(hr40, 1).getValue() === '開催前の知らせ（時刻）' && st40s.getRange(hr40, 2).getValue() === 19 && keys40b.indexOf('開催前の知らせ（何日前）') >= 0 && st40s.getLastRow() === 1 + DEFAULT_SETTINGS.length, '整え直すと、値を残して名前を直し、何日前の行を足す');
// 旧い版のシリーズ通知シート（何日前の列が無い）
var sn40 = sheetOf('シリーズ通知');
sn40.clear();
sn40.getRange(1, 1, 1, 5).setValues([['シリーズ', 'Discord Webhook URL', '基本のチャンネルにも送る', '前日通知の時刻', '更新日時']]);
sn40.getRange(2, 1, 1, 5).setValues([['古い回', 'https://discord.com/api/webhooks/old/1', 'OFF', 22, '2026/09/19 10:00']]);
var old40 = getSeriesNotify_(SS._proxy)['古い回'];
assert(old40 && old40.webhook === 'https://discord.com/api/webhooks/old/1' && old40.alsoBase === false && old40.hour === 22 && old40.days === null, '旧い列の並びのままでも読める');
ensureSheets_(SS._proxy);
var head40 = sn40.getRange(1, 1, 1, SERIES_NOTIFY_HEADER.length).getValues()[0].join(',');
var row40 = sn40.getRange(2, 1, 1, SERIES_NOTIFY_HEADER.length).getValues()[0];
assert(head40 === SERIES_NOTIFY_HEADER.join(',') && row40[0] === '古い回' && row40[2] === 'OFF' && row40[3] === '' && row40[4] === 22 && sn40.getLastRow() === 2, '整え直すと今の列の並びに組み直す: ' + row40.join(','));
var new40 = getSeriesNotify_(SS._proxy)['古い回'];
assert(new40.hour === 22 && new40.days === null && new40.webhook === old40.webhook, '組み直したあとも同じ値');
ensureSheets_(SS._proxy);
assert(sn40.getLastRow() === 2, '組み直しは 1 度だけ');
// セッションシートの見出し「前日通知」→「開催前の知らせ」
sh40.getRange(1, SC.NOTIFIED + 1).setValue('前日通知');
ensureSheets_(SS._proxy);
assert(sh40.getRange(1, SC.NOTIFIED + 1).getValue() === '開催前の知らせ' && sh40.getRange(1, SC.PERIOD + 1).getValue() === SESSION_HEADER[SC.PERIOD], 'セッションの見出しも今の名前に直る');

// 41. 種類ごとのチャンネル: 開催前の知らせと募集の知らせを、基本とは別のチャンネルへ
FETCH_CODE = 204;
var base41 = 'https://discord.com/api/webhooks/base/1', rem41 = 'https://discord.com/api/webhooks/remind/3', rec41 = 'https://discord.com/api/webhooks/recruit/4', ser41 = 'https://discord.com/api/webhooks/series41/5';
saveConsoleSettings({ webhook: base41, days: '1', hour: '20' });
var sh41 = sheetOf('セッション');
getSessions_(SS._proxy).forEach(function (x) { sh41.getRange(x.row, SC.NOTIFIED + 1).setValue('済'); });
err = null; try { saveConsoleSettings({ kindWebhook: { kind: 'remind', url: 'https://example.com/x' } }); } catch (e) { err = e.message; }
assert(err && err.indexOf('Webhook URL の形') >= 0, '種類ごとの URL も Discord の形でなければ弾く');
err = null; try { saveConsoleSettings({ kindWebhook: { kind: 'other', url: rem41 } }); } catch (e) { err = e.message; }
assert(err && err.indexOf('種類が不正') >= 0, '知らない種類は弾く');
var k41 = saveConsoleSettings({ kindWebhook: { kind: 'remind', url: rem41 } });
saveConsoleSettings({ kindWebhook: { kind: 'recruit', url: rec41 } });
var d41 = getConsoleData();
assert(k41.ok && d41.remindWebhookSet && d41.recruitWebhookSet && d41.settings.remindWebhookMasked.indexOf('…') >= 0 && d41.settings.remindWebhookMasked !== rem41 && getSettings_(SS._proxy)['開催前の知らせの Webhook URL'] === rem41, '開催前の知らせと募集の URL を保存し、画面用のデータでは伏せる: ' + k41.message);
assert(sheetOf('設定').getLastRow() === 1 + DEFAULT_SETTINGS.length, '設定の行は項目の数だけ');
// 開催前の知らせ: シリーズの無い卓は開催前の知らせのチャンネル。シリーズ専用のチャンネルがある卓はシリーズが先
saveSeriesNotify({ series: '四十一の回', webhook: ser41, alsoBase: true });
saveSeriesNotify({ series: '四十一だけの回', webhook: ser41, alsoBase: false });
var t41 = ymd_(addDays_(new Date(), 1));
var p41 = saveSession({ name: '明日の単発', gm: 'アリス', members: [], extra: '', date: t41, start: '20:00', end: '', status: '開催', notify: false });
var q41 = saveSession({ name: '四十一の回 #1', series: '四十一の回', gm: 'アリス', members: [], extra: '', date: t41, start: '21:00', end: '', status: '開催', notify: false });
var r41 = saveSession({ name: '四十一だけの回 #1', series: '四十一だけの回', gm: 'アリス', members: [], extra: '', date: t41, start: '22:00', end: '', status: '開催', notify: false });
FETCHES.length = 0;
dailyNotify({ testHour: 20 });
var byUrl41 = {};
FETCHES.forEach(function (f) { byUrl41[f.url] = (byUrl41[f.url] || []).concat(f.body.embeds.map(function (e) { return e.title; })); });
assert(!byUrl41[base41] && byUrl41[rem41] && byUrl41[rem41].sort().join(',') === '四十一の回 #1,明日の単発' && byUrl41[ser41] && byUrl41[ser41].sort().join(',') === '四十一だけの回 #1,四十一の回 #1',
  '開催前の知らせは開催前の知らせのチャンネルへ。シリーズ専用がある卓はシリーズへ、「基本にも送る」なら開催前の知らせのチャンネルにも。基本のチャンネルには流れない: ' + JSON.stringify(byUrl41));
var log41 = sheetOf('通知ログ').getRange(2, 1, sheetOf('通知ログ').getLastRow() - 1, 4).getValues().map(function (r) { return r.join(' '); }).join('\n');
assert(log41.indexOf('（開催前の知らせのチャンネル）') >= 0, '通知ログに、開催前の知らせのチャンネルへ送ったことが残る');
// 募集: 状態が「募集」の卓の登録・案内・削除と、参加確認は募集のチャンネル。開催の卓は基本
FETCHES.length = 0;
var m41 = saveSession({ name: '募集の卓41', gm: 'アリス', members: [], extra: '', date: '', start: '', end: '', status: '募集', notify: true });
assert(FETCHES.length === 1 && FETCHES[0].url === rec41, '募集の卓を登録した知らせは募集のチャンネルへ');
FETCHES.length = 0;
saveSession({ id: p41.id, name: '明日の単発', gm: 'アリス', members: [], extra: '', date: t41, start: '20:30', end: '', status: '開催', notify: true });
assert(FETCHES.length === 1 && FETCHES[0].url === base41, '開催の卓の変更は基本のチャンネルへ');
FETCHES.length = 0;
var st41 = sendDiscordStep({ kind: 'change', id: m41.id, verb: '変更', attempt: 1 });
var an41 = sendDiscordStep({ kind: 'announce', id: m41.id, attempt: 1 });
var an41b = sendDiscordStep({ kind: 'announce', id: p41.id, attempt: 1 });
assert(st41.ok && st41.targetLabel === '募集のチャンネル' && an41.targetLabel === '募集のチャンネル' && an41b.targetLabel === '基本のチャンネル' && FETCHES[0].url === rec41 && FETCHES[1].url === rec41 && FETCHES[2].url === base41, '画面から送るときも、募集の卓は募集のチャンネル、開催の卓は基本');
setInterest({ id: m41.id, name: 'ボブ', level: 'interest' });
FETCHES.length = 0;
var ask41 = sendDiscordStep({ kind: 'ask', id: m41.id, attempt: 1, message: '' });
assert(ask41.ok && FETCHES.length === 1 && FETCHES[0].url === rec41 && ask41.targetLabel === '募集のチャンネル', '興味ありの人への参加確認は募集のチャンネルへ');
FETCHES.length = 0;
var dl41 = sendDiscordStep({ kind: 'delete', name: '消した募集', status: '募集', attempt: 1 });
var dl41b = sendDiscordStep({ kind: 'delete', name: '消した開催', status: '開催', attempt: 1 });
assert(FETCHES[0].url === rec41 && FETCHES[1].url === base41 && dl41.ok && dl41b.ok, '消した卓の知らせは、募集なら募集のチャンネル、それ以外は基本');
var nn41 = notifySessionNow({ id: m41.id });
assert(nn41.ok && FETCHES[2].url === rec41, '案内（旧い入口）も募集のチャンネルへ');
FETCHES.length = 0;
sendDiscordStep({ kind: 'bulk', names: ['まとめ'], label: '変更', attempt: 1 });
assert(FETCHES.length === 1 && FETCHES[0].url === base41, 'まとめての変更は基本のまま');
assert(discordTargets_(loadContext_(SS._proxy), '', '')[0].url === base41, '日程調整など、種類の無い知らせは基本');
// 接続テスト
FETCHES.length = 0;
var tr41 = sendDiscordStep({ kind: 'test', channel: 'remind', attempt: 1 });
assert(tr41.ok && tr41.targetCount === 1 && FETCHES[0].url === rem41 && FETCHES[0].body.content.indexOf('開催前の知らせのチャンネル') >= 0, '開催前の知らせのチャンネルだけに接続テストを送れる');
var tb41 = sendDiscordStep({ kind: 'test', attempt: 1 });
assert(tb41.ok && FETCHES[1].url === base41, '基本の接続テストは基本のチャンネル');
// 外すと基本に戻る
var c41 = saveConsoleSettings({ kindWebhook: { kind: 'recruit', url: '', clear: true } });
assert(c41.ok && !getConsoleData().recruitWebhookSet && sessionTargets_(loadContext_(SS._proxy), getSessions_(SS._proxy).filter(function (x) { return x.id === m41.id; })[0])[0].url === base41, '募集の URL を外すと、募集の知らせは基本のチャンネルへ戻る');
err = null; try { sendDiscordStep({ kind: 'test', channel: 'recruit', attempt: 1 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('募集のチャンネルの Webhook URL がありません') >= 0, 'URL の無い種類の接続テストは断る');
saveConsoleSettings({ kindWebhook: { kind: 'remind', url: '', clear: true } });

// 42. 募集・調整の知らせに卓予定の URL を添える
FETCHES.length = 0;
var m42 = saveSession({ name: '募集の卓42', gm: 'アリス', members: [], extra: '', date: '', start: '', end: '', status: '募集', notify: true });
assert(FETCHES.length === 1 && FETCHES[0].body.content.indexOf('参加希望は卓予定の「募集・調整」タブから: ' + WEBAPP_URL) >= 0, '募集の卓の登録の知らせに、参加希望の入口として卓予定の URL: ' + FETCHES[0].body.content);
FETCHES.length = 0;
var a42 = saveSession({ name: '調整の卓42', gm: 'アリス', members: ['ボブ'], extra: '', date: '', start: '', end: '', status: '調整中', windowFrom: ymd_(addDays_(new Date(), 10)), windowTo: ymd_(addDays_(new Date(), 20)), notify: true });
assert(a42.ok && FETCHES.length === 1 && FETCHES[0].body.content.indexOf('日程調整は卓予定の「募集・調整」タブから: ' + WEBAPP_URL) >= 0, '調整中の卓の登録の知らせに、日程調整の入口として卓予定の URL');
FETCHES.length = 0;
var h42 = saveSession({ name: '開催の卓42', gm: 'アリス', members: [], extra: '', date: ymd_(addDays_(new Date(), 30)), start: '20:00', end: '', status: '開催', notify: true });
assert(FETCHES.length === 1 && FETCHES[0].body.content.indexOf(WEBAPP_URL) < 0, '開催の卓の知らせには付けない');
var ctx42 = loadContext_(SS._proxy), g42 = function (id) { return ctx42.sessions.filter(function (x) { return x.id === id; })[0]; };
assert(announcePayload_(ctx42, g42(m42.id), 'アリス').content.indexOf(WEBAPP_URL) >= 0 && announcePayload_(ctx42, g42(h42.id), 'アリス').content.indexOf(WEBAPP_URL) < 0, '案内も、募集・調整中の卓にだけ付ける');
assert(decidedPayload_(ctx42, g42(h42.id)).content.indexOf('🔗 卓予定: ' + WEBAPP_URL) >= 0, '日程が決まった知らせにも卓予定の URL');
assert(changePayload_(ctx42, { name: '消した募集', status: '募集' }, '削除', 'アリス').content.indexOf(WEBAPP_URL) < 0, '削除の知らせには付けない');
var keep42 = WEBAPP_URL; WEBAPP_URL = '';
assert(changePayload_(ctx42, g42(m42.id), '変更', 'アリス').content.indexOf('🔗') < 0, 'URL が取れないときは行ごと出さない');
WEBAPP_URL = keep42;

// 43. 募集をやめるとき、興味ありの人は外す（参加者にする人は画面から members で渡る）
var r43 = saveSession({ name: '募集から開催へ43', gm: 'アリス', members: [], extra: '', date: '', start: '', end: '', status: '募集', notify: false });
setInterest({ id: r43.id, name: 'ボブ', level: 'want' });
setInterest({ id: r43.id, name: 'カレン', level: 'interest' });
setInterest({ id: r43.id, name: 'ダン', level: 'interest' });
var g43 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === r43.id; })[0]; };
assert(g43().want.join() === 'ボブ' && g43().interest.join() === 'カレン、ダン'.replace('、', ','), '下ごしらえ: 参加希望 1 人・興味あり 2 人');
var h43 = saveSession({ id: r43.id, name: '募集から開催へ43', gm: 'アリス', members: ['カレン'], extra: '', date: ymd_(addDays_(new Date(), 6)), start: '20:00', end: '', status: '開催', notify: false });
var s43 = g43();
assert(h43.ok && s43.members.indexOf('ボブ') >= 0 && s43.members.indexOf('カレン') >= 0 && s43.members.indexOf('ダン') < 0 && s43.want.length === 0 && s43.interest.length === 0,
  '開催にすると、参加希望は参加者へ、選んだ興味ありの人も参加者へ、残りは外れる: ' + s43.members.join('、'));
assert(h43.promoted.join() === 'ボブ' && h43.dropped.join() === 'ダン' && h43.message.indexOf('興味ありの ダン は外しました') >= 0, '加えた人と外した人を返事に載せる: ' + h43.message);
var r43b = saveSession({ name: '募集のまま43', gm: 'アリス', members: [], extra: '', date: '', start: '', end: '', status: '募集', notify: false });
setInterest({ id: r43b.id, name: 'カレン', level: 'interest' });
saveSession({ id: r43b.id, name: '募集のまま43（名前だけ変更）', gm: 'アリス', members: [], extra: '', date: '', start: '', end: '', status: '募集', notify: false });
assert(getSessions_(SS._proxy).filter(function (s) { return s.id === r43b.id; })[0].interest.join() === 'カレン', '募集のままなら、興味ありはそのまま残る');

// 44. 卓予定の名前を変える
var name44 = SS.name;
err = null; try { renameSpreadsheet({ name: '  ' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('名前を入れて') >= 0, '空の名前は弾く');
err = null; try { renameSpreadsheet({ name: new Array(90).join('あ') }); } catch (e) { err = e.message; }
assert(err && err.indexOf('80 文字') >= 0, '長すぎる名前は弾く');
var rn44 = renameSpreadsheet({ name: '日曜卓の予定' });
assert(rn44.ok && SS.name === '日曜卓の予定' && rn44.data.title === '日曜卓の予定' && rn44.message.indexOf('日曜卓の予定') >= 0, '名前を変えると、画面用のデータにも新しい名前が載る: ' + rn44.message);
renameSpreadsheet({ name: name44 });
assert(SS.name === name44, '元の名前に戻せる');

// 45. 募集の卓も期間で持つ。旧い「募集時期」はシートを整え直すと期間に移る
var sh45 = sheetOf('セッション');
var row45 = sh45.getLastRow() + 1;
sh45.getRange(row45, 1, 1, SESSION_HEADER.length).setValues([fill_(['OLD1', '旧い募集の卓', 'アリス', '', '', '', '', '募集', '', '', 'サンプル', '', '', '2027/05 後期'], SESSION_HEADER.length, '')]);
var g45 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === 'OLD1'; })[0]; };
assert(sh45.getRange(row45, SC.WINDOW + 1).getValue() === '' && g45().windowFrom === '2027-05-16' && g45().windowTo === '2027-05-31' && g45().windowLabel === fmtDateJa_(toDate_('2027-05-16')) + '〜' + fmtDateJa_(toDate_('2027-05-31')), '整え直す前でも、旧い募集時期は期間として読む: ' + JSON.stringify([g45().windowFrom, g45().windowTo]));
ensureSheets_(SS._proxy);
assert(sh45.getRange(row45, SC.WINDOW + 1).getValue() === '2027/05/16〜2027/05/31' && sh45.getRange(row45, SC.PERIOD + 1).getValue() === '', '整え直すと期間の列に移り、募集時期の列は空になる: ' + sh45.getRange(row45, SC.WINDOW + 1).getValue());
assert(SESSION_HEADER[SC.PERIOD] === '募集時期（旧）' && SESSION_HEADER[SC.WINDOW] === '期間' && SESSION_HEADER[SC.URGED] === '期間前の催促' && SESSION_HEADER[SC.SOON] === '開始直前の知らせ', '見出しは 募集時期（旧）・期間・期間前の催促・開始直前の知らせ');
// 期間を入れたまま募集 → 調整中 → 開催 と進める
var w45a = ymd_(addDays_(new Date(), 30)), w45b = ymd_(addDays_(new Date(), 44));
var r45 = saveSession({ name: '期間つきの募集', gm: 'アリス', members: [], extra: '', status: '募集', windowFrom: w45a, windowTo: w45b, notify: false });
var h45 = function () { return getSessions_(SS._proxy).filter(function (s) { return s.id === r45.id; })[0]; };
assert(r45.ok && h45().windowFrom === w45a && h45().windowTo === w45b, '募集の卓に期間が付く');
saveSession({ id: r45.id, name: '期間つきの募集', gm: 'アリス', members: [], extra: '', status: '調整中', windowFrom: w45a, windowTo: w45b, notify: false });
assert(h45().status === '調整中' && h45().windowFrom === w45a, '調整中にしても期間はそのまま');
var bk45 = bulkUpdateSessions({ ids: [r45.id], action: 'status', value: '中止' });
assert(bk45.ok && h45().window === '', '募集・調整中から出ると期間は消える');

// 46. 期間前の催促。期間の始まる前日に、まだ募集中・調整中なら GM に知らせる
FETCH_CODE = 204;
FETCHES.length = 0;
sheetOf('設定').getRange(2, 2).setValue('https://discord.com/api/webhooks/base/1');
saveConsoleSettings({ days: '1', hour: '20' });
var sh46 = sheetOf('セッション');
getSessions_(SS._proxy).forEach(function (x) { sh46.getRange(x.row, SC.NOTIFIED + 1).setValue('済'); sh46.getRange(x.row, SC.URGED + 1).setValue('済'); });
assert(getSettings_(SS._proxy)[URGE_KEY] === 'ON', '期間前の催促は既定で ON');
// メンションを見るので、いまシートにいるメンバーの先頭 2 人に Discord ID を入れておく
var memSh46 = sheetOf('メンバー');
var memNames46 = memSh46.getRange(2, 1, memSh46.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0] || '').trim(); });
var gm46 = memNames46[0], mb46 = memNames46[1], gmId46 = '123456789012345678', mbId46 = '111111111111111111';
memSh46.getRange(2, 2).setValue(gmId46);
memSh46.getRange(3, 2).setValue(mbId46);
var tomo46 = ymd_(addDays_(new Date(), 1)), far46 = ymd_(addDays_(new Date(), 5));
var u46 = saveSession({ name: '明日から募集の卓', gm: gm46, members: [], extra: '', status: '募集', windowFrom: tomo46, windowTo: far46, notify: false });
var v46 = saveSession({ name: '明日から調整の卓', gm: mb46, members: [], extra: '', status: '調整中', windowFrom: tomo46, windowTo: far46, notify: false });
var x46 = saveSession({ name: 'まだ先の募集', gm: gm46, members: [], extra: '', status: '募集', windowFrom: far46, windowTo: ymd_(addDays_(new Date(), 9)), notify: false });
var g46 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0]; };
FETCHES.length = 0;
dailyNotify({ testHour: 19 });
assert(FETCHES.length === 0, '19 時: まだ送る時刻ではない');
dailyNotify({ testHour: 20 });
var heads46 = FETCHES.map(function (f) { return f.body.content.split('。')[0]; }).sort().join(' / ');
assert(FETCHES.length === 2 && heads46 === '⏳ 明日から「明日から募集の卓」の募集の期間です / ⏳ 明日から「明日から調整の卓」の候補の期間です', '20 時: 明日から期間の卓を 2 件、募集と調整で言い分けて送る: ' + heads46);
var uMsg46 = FETCHES.filter(function (f) { return f.body.content.indexOf('明日から募集の卓') >= 0; })[0].body.content;
assert(uMsg46.indexOf('<@' + gmId46 + '>') >= 0 && uMsg46.indexOf(WEBAPP_URL) >= 0, 'GM をメンションし、卓予定の URL を添える: ' + uMsg46.replace(/\n/g, ' / '));
assert(g46(u46.id).urged && g46(v46.id).urged && !g46(x46.id).urged, '送った卓に催促の印が付き、まだ先の卓には付かない');
FETCHES.length = 0;
dailyNotify({ testHour: 21 });
assert(FETCHES.length === 0, '同じ日に 2 回走っても送り直さない');
// 期間を変えると、また送れるようになる
saveSession({ id: u46.id, name: '明日から募集の卓', gm: gm46, members: [], extra: '', status: '募集', windowFrom: tomo46, windowTo: ymd_(addDays_(new Date(), 6)), notify: false });
assert(!g46(u46.id).urged, '期間を変えると催促の印は消える');
dailyNotify({ testHour: 20 });
assert(FETCHES.length === 1, '期間を変えたあとは、もう一度だけ送る');
sh46.getRange(g46(u46.id).row, SC.URGED + 1).setValue('');
// 設定を OFF にすると送らない
FETCHES.length = 0;
var off46 = saveConsoleSettings({ urge: false });
assert(off46.ok && getSettings_(SS._proxy)[URGE_KEY] === 'OFF', '期間前の催促を OFF にできる');
dailyNotify({ testHour: 20 });
assert(FETCHES.length === 0, 'OFF なら送らない');
saveConsoleSettings({ urge: true });

// 47. 開始直前の知らせ。当日、開始の◯分前に GM と参加者へ
FETCHES.length = 0;
assert(getSettings_(SS._proxy)[SOON_KEY] === 'OFF' && soonMinutes_(getSettings_(SS._proxy)) === 30, '開始直前の知らせは既定で OFF・30 分前');
installTriggers();
assert(dailyTriggers().length === 1 && dailyTriggers()[0].hours === 1, 'OFF のあいだ、見回りは毎時');
err = null; try { saveConsoleSettings({ soonMinutes: '3' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('5〜720') >= 0, '何分前は 5〜720');
var on47 = saveConsoleSettings({ soon: true, soonMinutes: '30' });
assert(on47.ok && getSettings_(SS._proxy)[SOON_KEY] === 'ON' && on47.data.settings.soon === true && on47.data.settings.soonMinutes === 30, '開始直前の知らせを ON にできる: ' + on47.message);
assert(dailyTriggers().length === 1 && dailyTriggers()[0].minutes === SOON_PATROL_MIN && on47.message.indexOf('見回りを 5 分ごとに') >= 0, 'ON にすると見回りが 5 分ごとになる: ' + on47.message);
var today47 = ymd_(new Date());
var sh47 = sheetOf('セッション');
getSessions_(SS._proxy).forEach(function (x) { sh47.getRange(x.row, SC.NOTIFIED + 1).setValue('済'); sh47.getRange(x.row, SC.URGED + 1).setValue('済'); sh47.getRange(x.row, SC.SOON + 1).setValue('済'); });
var a47 = saveSession({ name: '今夜の卓', gm: gm46, members: [mb46], extra: '', date: today47, start: '20:00', end: '23:00', status: '開催', notify: false });
var b47 = saveSession({ name: '夜更けの卓', gm: gm46, members: [], extra: '', date: today47, start: '23:30', end: '', status: '開催', notify: false });
var g47 = function (id) { return getSessions_(SS._proxy).filter(function (s) { return s.id === id; })[0]; };
var at47 = function (h, m) { var d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
FETCHES.length = 0;
dailyNotify({ testNow: at47(19, 20), testHour: 19 });
assert(FETCHES.length === 0, '40 分前: まだ送らない');
dailyNotify({ testNow: at47(19, 40), testHour: 19 });
assert(FETCHES.length === 1 && FETCHES[0].body.content.indexOf('⏰ あと 20 分で「今夜の卓」が始まります。') === 0, '20 分前: 開始直前の知らせを送る: ' + (FETCHES[0] && FETCHES[0].body.content));
assert(FETCHES[0].body.content.indexOf('<@' + gmId46 + '>') >= 0 && FETCHES[0].body.content.indexOf('<@' + mbId46 + '>') >= 0, 'GM と参加者をメンションする: ' + FETCHES[0].body.content);
assert(g47(a47.id).soon && !g47(b47.id).soon, '送った卓に印が付く。まだ先の卓には付かない');
FETCHES.length = 0;
dailyNotify({ testNow: at47(19, 45), testHour: 19 });
assert(FETCHES.length === 0, '5 分後の見回りでは送り直さない');
// 開始をだいぶ過ぎていたら送らない
sh47.getRange(g47(a47.id).row, SC.SOON + 1).setValue('');
dailyNotify({ testNow: at47(20, 30), testHour: 20 });
assert(FETCHES.length === 0, '開始を 30 分過ぎていたら送らない');
dailyNotify({ testNow: at47(20, 5), testHour: 20 });
assert(FETCHES.length === 1 && FETCHES[0].body.content.indexOf('⏰ まもなく「今夜の卓」が始まります。') === 0, '開始を少し過ぎたところなら「まもなく」で送る: ' + (FETCHES[0] && FETCHES[0].body.content));
// 開始時刻を変えると、また送れるようになる
assert(g47(a47.id).soon, '下ごしらえ: 送信済み');
saveSession({ id: a47.id, name: '今夜の卓', gm: gm46, members: [mb46], extra: '', date: today47, start: '21:00', end: '23:00', status: '開催', notify: false });
assert(!g47(a47.id).soon, '開始時刻を変えると、開始直前の知らせの印は消える');
FETCHES.length = 0;
var off47 = saveConsoleSettings({ soon: false });
assert(off47.ok && getSettings_(SS._proxy)[SOON_KEY] === 'OFF' && dailyTriggers()[0].hours === 1 && off47.message.indexOf('見回りを毎時に') >= 0, 'OFF に戻すと見回りも毎時に戻る: ' + off47.message);
dailyNotify({ testNow: at47(20, 40), testHour: 20 });
assert(FETCHES.length === 0, 'OFF なら送らない');
removeTriggers();

// 48. 日程調整の「どの日でもいい」（おまかせ）。候補日すべてに ◯ を付ける
FETCH_CODE = 204;
var q1 = ymd_(addDays_(new Date(), 80)), q2 = ymd_(addDays_(new Date(), 82)), q3 = ymd_(addDays_(new Date(), 84));
var qs = saveSession({ name: 'おまかせの卓', gm: 'ボブ', members: ['アリス', 'カレン'], extra: '', status: '調整中', windowFrom: q1, windowTo: q3, notify: false });
startPoll({ id: qs.id, dates: [q1, q2, q3], start: '20:00', end: '23:00', me: 'ボブ' });
var g48 = function () { return getSessions_(SS._proxy).filter(function (x) { return x.id === qs.id; })[0]; };
var v48 = function () { return getPollVotes_(SS._proxy)[qs.id] || {}; };
var mine48 = function (n) { return [q1, q2, q3].map(function (k) { return (v48()[k] || {})[n] ? v48()[k][n].vote : ''; }).join(''); };
assert(mine48('ボブ') === '◯◯◯' && mine48('アリス') === '', '下ごしらえ: 出した GM だけ ◯ が付いている');
// 弾く
err = null; try { setPollVoteAll({ id: qs.id, name: 'ダン' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('GM でも参加者でもない') >= 0, 'GM・参加者でない人は使えない');
err = null; try { setPollVoteAll({ id: qs.id, name: '' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('あなた') >= 0, '名前が無ければ弾く');
err = null; try { setPollVoteAll({ id: t16.id, name: 'アリス' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('日程調整中ではありません') >= 0, '調整中でない卓では使えない');
err = null; try { setPollVoteAll({ id: qs.id, name: 'アリス', vote: '×' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('◯ だけ') >= 0, 'おまかせで付けられるのは ◯ だけ');
// × を付けていた日も ◯ になる
setPollVote({ id: qs.id, ymd: q2, name: 'アリス', vote: '×' });
assert(mine48('アリス') === '×', '下ごしらえ: アリスは 2 日目に × を付けている: ' + mine48('アリス'));
var rows48 = sheetOf('日程調整').getLastRow();
var a48 = setPollVoteAll({ id: qs.id, name: 'アリス' });
assert(a48.ok && !a48.decided && mine48('アリス') === '◯◯◯', '候補日すべてに ◯ が付き、× の日も ◯ に変わる: ' + mine48('アリス'));
assert(a48.message.indexOf('3 日すべてに ◯') >= 0 && a48.days.length === 3, '返事に日数が入る: ' + a48.message);
assert(sheetOf('日程調整').getLastRow() === rows48 + 2, '行は足りないぶんだけ増える（3 日 − すでにあった 1 日）');
assert(mine48('ボブ') === '◯◯◯' && mine48('カレン') === '', 'ほかの人の回答は触らない');
var cd48 = a48.data.sessions.filter(function (x) { return x.id === qs.id; })[0];
assert(cd48.votes[q1]['アリス'] === '◯' && cd48.votes[q3]['アリス'] === '◯', '画面用データにも載る');
// 取り消し
var c48 = setPollVoteAll({ id: qs.id, name: 'アリス', vote: '' });
assert(c48.ok && mine48('アリス') === '' && c48.message.indexOf('取り消し') >= 0 && mine48('ボブ') === '◯◯◯', '空で送ると自分の回答だけ全部消える: ' + c48.message);
// 最後の 1 人が押すと ready になる。決めるのは GM
setPollVoteAll({ id: qs.id, name: 'アリス' });
var d48 = setPollVoteAll({ id: qs.id, name: 'カレン' });
assert(d48.ready && !d48.decided && g48().status === '調整中', '全員が ◯ になっても自動では決まらず、ready を返す: ' + d48.message);
var e48 = decidePoll({ id: qs.id, ymd: q1, me: 'ボブ' });
assert(e48.decided === q1 && g48().status === '開催' && g48().ymd === q1 && g48().start === '20:00', 'GM が選んだ日に決まる: ' + e48.message);
assert(g48().candidates.length === 0 && g48().window === '', '決まると候補日と期間は片付く');
assert(bookedMap_(loadContext_(SS._proxy))[q1]['カレン'] === '参', '決まった日に「参」が付く');
// 過ぎた候補日は触らない
var r48 = saveSession({ name: 'おまかせの卓 2', gm: 'ボブ', members: ['アリス', 'カレン'], extra: '', status: '調整中', notify: false });   // カレンは答えないので決まらない
startPoll({ id: r48.id, dates: [q1, q2], me: 'ボブ' });
var row48 = getSessions_(SS._proxy).filter(function (x) { return x.id === r48.id; })[0].row;
sheetOf('セッション').getRange(row48, SC.CANDS + 1).setValue(candsText_([ymd_(addDays_(new Date(), -3)), q2]));
var p48 = setPollVoteAll({ id: r48.id, name: 'アリス' });
var pv48 = getPollVotes_(SS._proxy)[r48.id] || {};
assert(p48.days.length === 1 && p48.days[0] === q2 && !(pv48[ymd_(addDays_(new Date(), -3))] || {})['アリス'], '過ぎた候補日には付けない');
sheetOf('セッション').getRange(row48, SC.CANDS + 1).setValue(candsText_([ymd_(addDays_(new Date(), -3))]));
err = null; try { setPollVoteAll({ id: r48.id, name: 'アリス' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('これからの候補日がありません') >= 0, '過ぎた候補日しか無ければ断る');

// 49. 管理者。管理者の合言葉を決めると、シートを開く・ほかの人のぶん・メンバー・設定・削除が管理者だけになる
var mem49 = getMembers_(SS._proxy).map(function (m) { return m.name; });
var A49 = mem49[0], B49 = mem49[1];
var tok49 = '';   // この時点では合言葉を外してあるので、証は何でも通る
// 決める前は、誰でも管理者としてふるまえる
assert(!getConsoleData({ token: tok49 }).adminSet, '最初は管理者の合言葉が決まっていない');
assert(getConsoleData({ token: tok49 }).isAdmin === true, '決まっていないあいだは全員が管理者あつかい');
assert(!!getConsoleData({ token: tok49 }).url, 'そのあいだはシートの URL も渡す');
// 決める
err = null; try { setAdminPassword({ token: tok49, password: 'ab', confirm: 'ab', me: A49 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('8 文字以上') >= 0, '短い管理者の合言葉は弾く');
err = null; try { setAdminPassword({ token: tok49, password: 'adminpass1', confirm: 'chigau1234', me: A49 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('合っていません') >= 0, '2 つの入力が違えば弾く');
var sa49 = setAdminPassword({ token: tok49, password: 'adminpass1', confirm: 'adminpass1', me: A49 });
var atok49 = sa49.adminToken;
assert(sa49.ok && atok49 && sa49.data.adminSet === true && sa49.data.isAdmin === true, '管理者の合言葉を決めると、証が返る: ' + sa49.message);
assert(sa49.data.admins.join(',') === A49, '決めた人が名簿に載る: ' + sa49.data.admins.join(','));
assert(getSettings_(SS._proxy)['管理者'] === A49, '名簿は設定シートの「管理者」に入る');
// 管理者でない人には、シートの URL を渡さない
var plain49 = getConsoleData({ token: tok49 });
assert(plain49.isAdmin === false && plain49.url === '' && plain49.adminSet === true, '管理者でなければ isAdmin は false、シートの URL も空');
assert(getConsoleData({ token: tok49, adminToken: atok49 }).url !== '', '管理者にはシートの URL を渡す');
// 関所
var guard49 = function (fn, form, what) {
  var e2 = null;
  try { fn(form); } catch (e) { e2 = e.message; }
  assert(e2 && e2.indexOf('ADMIN:') === 0, what + 'は管理者だけ: ' + e2);
};
guard49(saveMember, { token: tok49, name: 'よそ者' }, 'メンバーの追加');
guard49(deleteMember, { token: tok49, name: B49 }, 'メンバーを外すこと');
guard49(saveConsoleSettings, { token: tok49, calMonths: '3' }, '設定の変更');
guard49(setAutoNotify, { token: tok49, enabled: false }, '知らせの設定');
guard49(saveSeriesNotify, { token: tok49, series: '鉄鳴界の夜明け', days: '2' }, 'シリーズの設定');
guard49(renameSpreadsheet, { token: tok49, name: 'べつの名前' }, '名前の変更');
guard49(changePassword, { token: tok49, current: 'x', password: 'y' }, 'みんなの合言葉の変更');
guard49(bulkUpdateSessions, { token: tok49, ids: ['S001'], action: 'status', value: '中止' }, 'まとめて変えること');
guard49(deleteSession, { token: tok49, id: 'S001' }, '卓の削除');
// 自分のぶんは誰でも、ほかの人のぶんは管理者だけ
var day49 = '';
for (var i49 = 2; i49 < 55 && !day49; i49++) {
  var k49 = ymd_(addDays_(new Date(), i49));
  var busy49 = getSessions_(SS._proxy).some(function (x) { return x.ymd === k49 && (peopleOf_(x).indexOf(A49) >= 0 || peopleOf_(x).indexOf(B49) >= 0); });
  if (!busy49) day49 = k49;
}
assert(!!day49, '下ごしらえ: 2 人とも卓の無い日がある');
err = null; try { setAvailability(B49, day49, '×', tok49, B49); } catch (e) { err = e.message; }
assert(!err, '自分の都合は管理者でなくても入れられる: ' + err);
err = null; try { setAvailability(A49, day49, '×', tok49, B49); } catch (e) { err = e.message; }
assert(err && err.indexOf('ADMIN:') === 0, 'ほかの人の都合は管理者だけ: ' + err);
err = null; try { setAvailNote({ token: tok49, me: B49, name: A49, ymd: day49, text: 'よそから' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('ADMIN:') === 0, 'ほかの人の予定メモも管理者だけ');
err = null; try { setAvailability(A49, day49, '△', tok49, B49, atok49); } catch (e) { err = e.message; }
assert(!err, '管理者ならほかの人の都合も入れられる: ' + err);
// 管理者としてログインすると名簿に足される
err = null; try { loginAdmin({ token: tok49, password: 'chigau', me: B49 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('違います') >= 0, '管理者の合言葉が違えば断る');
var la49 = loginAdmin({ token: tok49, password: 'adminpass1', me: B49 });
assert(la49.ok && la49.adminToken === atok49 && la49.data.admins.join(',') === [A49, B49].join(','), '合言葉が合えば管理者になり、名簿に足される: ' + la49.data.admins.join(','));
// 名簿から外す
err = null; try { removeAdmin({ token: tok49, name: B49 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('ADMIN:') === 0, '名簿を変えるのも管理者だけ');
var rm49 = removeAdmin({ token: tok49, adminToken: atok49, name: B49 });
assert(rm49.ok && rm49.data.admins.join(',') === A49, '名簿から外せる');
err = null; try { removeAdmin({ token: tok49, adminToken: atok49, name: A49 }); } catch (e) { err = e.message; }
assert(err && err.indexOf('1 人だけ') >= 0, '最後の 1 人は外せない');
// 管理者の合言葉を変えると、前の証は効かなくなる
var ch49 = setAdminPassword({ token: tok49, adminToken: atok49, current: 'adminpass1', password: 'adminpass2', confirm: 'adminpass2', me: A49 });
assert(ch49.ok && ch49.adminToken !== atok49, '変えると新しい証になる');
err = null; try { saveMember({ token: tok49, adminToken: atok49, name: 'ふるい証' }); } catch (e) { err = e.message; }
assert(err && err.indexOf('ADMIN:') === 0, '古い証はもう通らない');
var sm49 = saveMember({ token: tok49, adminToken: ch49.adminToken, name: 'あたらしい人', discordId: '', note: '' });
assert(sm49.ok, '新しい証なら通る');
deleteMember({ token: tok49, adminToken: ch49.adminToken, name: 'あたらしい人' });
// シートのメニューからやめると、全員が操作できる状態に戻る
PROMPT_ANSWER = { button: 'OK', text: '' };
setAdminPasswordFromSheet();
assert(ALERTS[ALERTS.length - 1].indexOf('やめました') >= 0, 'シートのメニューから管理者の合言葉をやめられる: ' + ALERTS[ALERTS.length - 1]);
assert(getConsoleData({ token: tok49 }).isAdmin === true, 'やめると全員が管理者あつかいに戻る');

// 50. 書き込みの順番待ち。どの書き込みも 1 本のロックを取り、入れ子では取り直さない
var lockLog = [], lockFree = true, realGetLock = LockService.getScriptLock;
LockService.getScriptLock = function () {
  return { tryLock: function () { lockLog.push('try'); if (!lockFree) return false; lockFree = false; return true; }, releaseLock: function () { lockLog.push('release'); lockFree = true; } };
};
lockLog.length = 0;
saveSession({ name: 'ロックの卓', gm: 'アリス', members: ['ボブ'], extra: '', date: ymd_(addDays_(new Date(), 20)), start: '20:00', end: '', status: '開催', notify: false });
assert(lockLog.join(',') === 'try,release' && lockFree, '卓の保存はロックを 1 回だけ取って放す（中の描き直しで取り直さない）: ' + lockLog.join(','));
lockLog.length = 0;
setAvailability('ボブ', ymd_(addDays_(new Date(), 4)), '×');
assert(lockLog.join(',') === 'try,release', '都合の入力もロックを取る: ' + lockLog.join(','));
lockLog.length = 0;
refreshAll_(loadContext_(SS._proxy));
assert(lockLog.join(',') === 'try,release', '表示の描き直しもロックを取る: ' + lockLog.join(','));
// ほかの操作が持っているあいだは書かない
lockFree = false;
err = null; try { setAvailability('ボブ', ymd_(addDays_(new Date(), 5)), '△'); } catch (e) { err = e.message; }
assert(err && err.indexOf('重なりました') >= 0, 'ロックが取れなければ書かずに知らせる');
markDirty_();
assert(refreshIfDirty() === false && PropertiesService.getScriptProperties().getProperty(DIRTY_KEY) === '1', '10 分おきの描き直しは、取れなければ黙って次に回す（印は残る）');
lockFree = true;
LockService.getScriptLock = realGetLock;

OUT.push('CALLS: ' + Object.keys(CALLS).sort().join(', '));
OUT.push('ALL PASSED');
