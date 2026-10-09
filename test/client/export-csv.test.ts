// グループの書き出しの、卓の一覧のCSV（src/client/features/console/admin/exportFile.tsのsessionsCsv）
import { expect, test } from 'vitest';
import { sessionsCsv } from '../../src/client/features/console/admin/exportFile';
import type { GroupExport } from '../../src/shared/api';

const session = (over: Partial<GroupExport['sessions'][number]>) => ({
  id: 'S001', name: '港', status: '開催', date: '2026-10-10', start: '20:00', end: '', gm: 'ひより', coGms: ['ユズ'], members: ['ソラ', 'こまち'],
  place: '', series: '', scenario: '', memo: '', record: { logUrl: '', recap: '' }, ...over,
}) as GroupExport['sessions'][number];
const csv = (...sessions: GroupExport['sessions']) => sessionsCsv({ sessions } as GroupExport);

test('頭にBOMと見出しを付け、行はCRLFで区切る。値はいつも " で囲む', () => {
  const lines = csv(session({})).split('\r\n');
  expect(lines[0]).toBe('﻿"卓のID","名前","状態","開催日","開始","終了","GM","共同GM","参加者","場所","シリーズ","シナリオ","メモ","ログ"');
  expect(lines[1]).toBe('"S001","港","開催","2026-10-10","20:00","","ひより","ユズ","ソラ、こまち","","","","",""');
  expect(lines[2]).toBe('');
});

test('中の " は2つにし、改行はそのまま囲みの中に置く', () => {
  expect(csv(session({ name: '"港"の卓', memo: '1行目\n2行目' })).split('\r\n')[1]).toContain('"""港""の卓"');
  expect(csv(session({ memo: '1行目\n2行目' }))).toContain('"1行目\n2行目"');
});

test('= + - @ で始まる値は、式として読まれないように頭に \' を付ける', () => {
  const line = csv(session({ name: '=HYPERLINK("x")', memo: '+1', place: '-2', series: '@a' })).split('\r\n')[1]!;
  expect(line).toContain('"\'=HYPERLINK(""x"")"');
  expect(line).toContain('"\'+1"');
  expect(line).toContain('"\'-2"');
  expect(line).toContain('"\'@a"');
});
