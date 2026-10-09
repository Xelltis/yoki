// 時間帯つきの日程調整: 昼と夜に分けるグループでは、候補を「10/12の夜」のように出せる（候補は「YYYY-MM-DD 夜」の形）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { customId, pollComponents } from '../../src/worker/discord/buttons';
import { handleComponent } from '../../src/worker/discord/interactions';
import type { Bindings } from '../../src/worker/env';
import { pollPayload } from '../../src/worker/discord/payloads';
import { loadGroup } from '../../src/worker/domain/load';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { candDay, candLabel, candPart, parseCandidate, sortCandidates } from '../../src/shared/candidates';
import { parseYmd } from '../../src/worker/lib/jst';
import { fail, GUILD, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await ok(G.admin, G.id, 'saveConsoleSettings', { dayParts: true });
  await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
});
const sessionOf = (r: Record<string, any>) => r.data.sessions[0];
const label = (k: string) => candLabel(k, fmtDateJa);

describe('候補の形', () => {
  test('日付か「日付 昼|夜」。並べると日付の順、同じ日は 1日・昼・夜 の順', () => {
    expect(parseCandidate('2026-10-12', parseYmd)).toBe('2026-10-12');
    expect(parseCandidate(' 2026/10/12  夜 ', parseYmd)).toBe('2026-10-12 夜');
    expect([parseCandidate('2026-10-12 朝', parseYmd), parseCandidate('あした', parseYmd), parseCandidate('', parseYmd), parseCandidate(undefined, parseYmd)]).toEqual([null, null, null, null]);
    expect(sortCandidates(['2026-10-13', '2026-10-12 夜', '2026-10-12', '2026-10-12 昼'])).toEqual(['2026-10-12', '2026-10-12 昼', '2026-10-12 夜', '2026-10-13']);
    expect([candDay('2026-10-12 夜'), candPart('2026-10-12 夜'), candPart('2026-10-12')]).toEqual(['2026-10-12', '夜', '']);
    expect(label('2026-10-12 夜')).toBe('10/12（月）の夜');
  });
});

describe('出す・答える', () => {
  test('昼と夜に分けて候補を出せる。並べて控え、履歴にも時間帯を書く。分けていないグループでは断る', async () => {
    const r = await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 夜', T(3) + ' 昼', T(4) + ' 夜'] });
    expect(sessionOf(r).candidates).toEqual([T(3) + ' 昼', T(3) + ' 夜', T(4) + ' 夜']);
    const h = (await ok(G.admin, G.id, 'getSessionHistory', { id: 'S001' })).items[0].detail;
    expect(h).toBe('候補日を出した: ' + [T(3) + ' 昼', T(3) + ' 夜', T(4) + ' 夜'].map(label).join('、'));
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 朝'] })).error).toBe('日付が読めません: ' + T(3) + ' 朝');
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(-1) + ' 夜'] })).error).toBe('過ぎた日は候補にできません: ' + label(T(-1) + ' 夜'));
    // 締め切りは、いちばん早い候補の日より前
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 夜'], due: T(3) })).error).toContain('いちばん早い候補日（' + fmtDateJa(T(3)) + '）より前の日');
    await ok(G.admin, G.id, 'saveConsoleSettings', { dayParts: false });
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 夜'] })).error).toBe('昼と夜に分けていないグループでは、候補に時間帯を付けられません。');
  });

  test('候補ごとに答える。候補でない・過ぎた候補には答えられない', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 昼', T(3) + ' 夜'] });
    const r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: T(3) + ' 夜', vote: '◯' });
    expect(r.message).toBe(label(T(3) + ' 夜') + ' ソラ: ◯');
    expect(sessionOf(r).votes).toEqual({ [T(3) + ' 昼']: { ひより: '◯' }, [T(3) + ' 夜']: { ひより: '◯', ソラ: '◯' } });
    expect((await fail(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: T(3), vote: '◯' })).error).toBe(fmtDateJa(T(3)) + 'は「迷宮」の候補日ではありません。');
    expect((await fail(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: 'x', vote: '◯' })).error).toBe('日付が読めません: x');
    await env.DB.prepare("UPDATE sessions SET candidates = ?").bind(JSON.stringify([T(-1) + ' 夜'])).run();
    expect((await fail(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: T(-1) + ' 夜', vote: '◯' })).error).toBe('過ぎた候補日には回答できません。');
  });

  test('予定表から答えると、時間帯の付いた候補は、その時間帯の印で答える', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), mark: '×', part: '夜' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 昼', T(3) + ' 夜'] });
    const r = await ok(G.sora, G.id, 'setPollVoteFromAvail', { id: 'S001', name: 'ソラ' });
    expect(sessionOf(r).votes[T(3) + ' 昼'].ソラ).toBe('◯');
    expect(sessionOf(r).votes[T(3) + ' 夜'].ソラ).toBe('×');
  });

  test('Discordの知らせと選ぶ欄にも時間帯を書く', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 昼', T(3) + ' 夜'] });
    const ctx = { ...(await loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/grp/')), buttons: true };
    const s = ctx.sessions[0]!;
    expect(pollPayload(ctx, s, '').content.split('\n')[1]).toBe('候補日: ' + label(T(3) + ' 昼') + '、' + label(T(3) + ' 夜'));
    const select = pollComponents(ctx, s)![1]!.components[0] as { options: { label: string; value: string }[] };
    expect(select.options).toEqual([{ label: label(T(3) + ' 昼'), value: T(3) + ' 昼' }, { label: label(T(3) + ' 夜'), value: T(3) + ' 夜' }]);
  });
});

describe('Discordの選ぶ欄で答える', () => {
  test('選んだ候補に ◯、選ばなかった、これからの候補に ×', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 昼', T(3) + ' 夜'] });
    const it = {
      application_id: 'app', token: 'tok', guild_id: GUILD, member: { user: { id: '400000000000000011' } },
      data: { custom_id: customId(G.id, 1, 'days'), values: [T(3) + ' 夜'] },
    };
    expect(await handleComponent(env as unknown as Bindings, it, 'https://yoki.test', new Date(), async () => {})).toBe('ソラ: 「迷宮」に、' + label(T(3) + ' 夜') + 'は ◯、ほかの日は × で答えました　全員の回答がそろいました。');
  });
});

describe('開催日を決める', () => {
  test('時間帯の付いた候補に決めると、その日になる。開始時刻がその時間帯なら残す', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 夜'], start: '20:00', end: '23:00' });
    const r = await ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(3) + ' 夜' });
    expect(r.message).toBe('日程を決めました: 迷宮（' + label(T(3) + ' 夜') + '）');
    expect(sessionOf(r)).toMatchObject({ status: '開催', date: T(3), start: '20:00', end: '23:00' });
    expect((await ok(G.admin, G.id, 'getSessionHistory', { id: 'S001' })).items[0].detail).toBe(label(T(3) + ' 夜'));
  });

  test('開始時刻がほかの時間帯なら、時間を空にして「編集」で入れてもらう。候補でない・過ぎた候補には決められない', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3) + ' 夜', T(4) + ' 昼'], start: '20:00', end: '23:00' });
    expect((await fail(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(5) + ' 昼' })).error).toBe(label(T(5) + ' 昼') + 'は「迷宮」の候補日ではありません。');
    expect((await fail(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: '?' })).error).toBe('日付が読めません: ?');
    const r = await ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(4) + ' 昼' });
    expect(r.message).toBe('日程を決めました: 迷宮（' + label(T(4) + ' 昼') + '）　時間は「編集」で入れてください。');
    expect(sessionOf(r)).toMatchObject({ date: T(4), start: '', end: '' });
  });

  test('過ぎた候補には決められない', async () => {
    await env.DB.prepare("UPDATE sessions SET candidates = ?").bind(JSON.stringify([T(-1) + ' 夜'])).run();
    expect((await fail(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(-1) + ' 夜' })).error).toBe('過ぎた候補日には決められません。');
  });
});
