// 募集・調整のタブ。募集中の卓（参加希望・興味あり）と、調整中の卓（日程調整の回答・開催日を決める）
import type { ConsoleSession } from '../../shared/api';
import { api, discordSend, failToast, refetch, takeData } from './api';
import { renderCal, revealDay, selectDay } from './calendar';
import { fmtJa, holidayName, parseYmd, timeRange } from './dates';
import { $, esc, hit, mi, store, toast } from './dom';
import { fillForm, openForm, openNewWithStatus, syncStatusUi } from './form';
import { askConfirm } from './modal';
import { byId, hasPoll, isAdjusting, isAdmin, isRecruit, me, peopleOf, periodOfSession, pollPending, pollVoters, sortSessions } from './model';
import { renderNotices } from './notices';
import { hookFor } from './notify';
import { renderOps } from './ops';
import { notifyDecided, notifyReady, openPoll } from './poll';
import { D } from './state';
import { showTab } from './tabs';

/** 卓の人の札（GM と参加者。メンバーに無い人は印を付ける） */
function peopleHtml(s: ConsoleSession, none: string): string {
  return '<div class="people">' + peopleOf(s).map((p) => {
    const isGm = p === s.gm, known = D.members.some((m) => m.name === p);
    return '<span class="' + (isGm ? 'gm' : '') + (known ? '' : ' no') + '">' + (isGm ? 'GM ' : '') + esc(p) + '</span>';
  }).join('') + (peopleOf(s).length ? '' : '<span class="no">' + none + '</span>') + '</div>';
}

export function renderRecruit(): void {
  const list = sortSessions(D.sessions.filter(isRecruit)), mine = me();
  const adjList = sortSessions(D.sessions.filter(isAdjusting));
  let html = '';
  $('recruitCount').textContent = list.length + adjList.length ? String(list.length + adjList.length) : '';
  if (!list.length) html = '<div class="card empty"><p class="hint">募集中の卓はありません。状態を「募集」にして登録すると、ここに並びます。</p><button type="button" class="btn primary" data-new-recruit>' + mi('add') + '募集を始める</button></div>';
  list.forEach((s) => {
    const level = s.want.indexOf(mine) >= 0 ? 'want' : s.interest.indexOf(mine) >= 0 ? 'interest' : 'none';
    const member = !!mine && peopleOf(s).indexOf(mine) >= 0;
    html += '<div class="rc" data-id="' + esc(s.id) + '"><h3>' + esc(s.name) + '</h3><div class="when">' + esc(periodOfSession(s)) + '</div>' + (s.series ? '<div class="hint">シリーズ: ' + esc(s.series) + '</div>' : '');
    html += peopleHtml(s, 'GM・参加者 未定');
    html += '<div class="lists"><div><b>参加希望</b>' + (s.want.length ? esc(s.want.join('、')) : '<span class="hint">まだいません</span>') + '</div>' +
      '<div><b>興味あり</b>' + (s.interest.length ? esc(s.interest.join('、')) : '<span class="hint">まだいません</span>') + '</div></div>';
    if (s.place) html += '<div class="row2">場所: ' + esc(s.place) + '</div>';
    if (s.memo) html += '<div class="row2 hint">' + esc(s.memo) + '</div>';
    if (s.gm === mine) html += '<p class="next">' + mi('arrow_forward', 'sm') + '<span>集まったら「編集」で状態を「開催」（日が決まっている）か「調整中」（みんなで日を選ぶ）にします。参加希望の人はそのまま参加者に入ります。</span></p>';
    html += '<div class="btns">';
    if (member) html += '<span class="hint">あなたはこの卓の' + (s.gm === mine ? ' GM ' : '参加者') + 'です</span>';
    else {
      html += '<button type="button" class="btn small' + (level === 'want' ? ' on' : '') + '" aria-pressed="' + (level === 'want') + '" data-level="want" data-id="' + esc(s.id) + '">参加希望</button>';
      html += '<button type="button" class="btn small' + (level === 'interest' ? ' on' : '') + '" aria-pressed="' + (level === 'interest') + '" data-level="interest" data-id="' + esc(s.id) + '">興味あり</button>';
      if (level !== 'none') html += '<button type="button" class="btn small" data-level="none" data-id="' + esc(s.id) + '">取り消す</button>';
    }
    html += '<button type="button" class="btn small" data-edit="' + esc(s.id) + '" style="margin-left:auto">編集</button>';
    html += '<span class="res" data-rres="' + esc(s.id) + '"></span></div>';
    // GM 向け: 興味ありの人に Discord で聞く。返事は各自が募集タブの「参加希望」で
    const askTitle = !hookFor(s.series, 'recruit') ? 'チャンネル未設定' : !s.interest.length ? '興味ありの人がいません' : '興味ありの人にメンションして、参加できるか Discord で聞く';
    html += '<div class="btns gm"><button type="button" class="btn small primary" data-hold="' + esc(s.id) + '" title="状態を「開催」にした登録の窓を開きます">' + mi('event', 'sm') + '開催にする</button>';
    html += '<button type="button" class="btn small" data-ask="' + esc(s.id) + '"' + (hookFor(s.series, 'recruit') && s.interest.length ? '' : ' disabled') + ' title="' + esc(askTitle) + '">興味ありの人に聞く</button>';
    html += '<span class="res" data-ares="' + esc(s.id) + '">' + (s.asked ? '確認文を送りました（' + esc(s.asked) + '）' : '') + '</span></div>';
    html += '</div>';
  });
  $('recruitList').innerHTML = html;
  // 日程調整中: 候補の期間を見せ、カレンダーで候補日を選べるようにする
  let ah = '';
  if (!adjList.length) ah = '<div class="card empty"><p class="hint">日程を調整している卓はありません。状態を「調整中」にして候補の期間を入れると、ここに並びます。</p><button type="button" class="btn" data-new-adjust>' + mi('add') + '日程調整を始める</button></div>';
  adjList.forEach((s) => {
    ah += '<div class="rc adj" data-id="' + esc(s.id) + '"><h3>' + esc(s.name) + '</h3><div class="when">' + esc(s.windowLabel ? s.windowLabel + ' のどこか' : '候補の期間は未定') + '</div>' + (s.series ? '<div class="hint">シリーズ: ' + esc(s.series) + '</div>' : '');
    ah += peopleHtml(s, 'GM・参加者 未定');
    if (s.place) ah += '<div class="row2">場所: ' + esc(s.place) + '</div>';
    if (s.memo) ah += '<div class="row2 hint">' + esc(s.memo) + '</div>';
    const poll = hasPoll(s), who = me(), voters = pollVoters(s), isVoter = !!who && voters.indexOf(who) >= 0;
    // 開催日を選べるのは GM と管理者
    const canDecide = (!!who && who === s.gm) || isAdmin();
    if (poll) {
      const futureDays = s.candidates.filter((k) => k >= D.today);
      const allOk = isVoter && futureDays.length > 0 && futureDays.every((k) => ((s.votes || {})[k] || {})[who] === '◯');
      ah += '<div class="poll"><div class="poll-h">' + mi('how_to_vote', 'sm') + '日程調整中' + (s.start || s.end ? '<span class="poll-time">' + esc(timeRange(s)) + '</span>' : '') + '<span class="hint">全員が答えたら、GM が開催日を選びます</span>' +
        (isVoter && futureDays.length ? '<button type="button" class="btn small any' + (allOk ? ' on' : '') + '" data-any="' + esc(s.id) + '" aria-pressed="' + allOk + '" title="' + (allOk ? 'いまは「どの日でもいい」です。押すと回答を取り消します' : 'これからの候補日すべてに ◯ を付けます') + '">' + mi('check', 'sm') + 'どの日でもいい' + '</button>' : '') + '</div>';
      s.candidates.forEach((k) => {
        const v = (s.votes || {})[k] || {}, past = k < D.today, dow = parseYmd(k).getDay(), hol = holidayName(k);
        const ok = voters.filter((n) => v[n] === '◯'), ng = voters.filter((n) => v[n] === '×'), no = voters.filter((n) => !v[n]);
        ah += '<div class="poll-row' + (past ? ' past' : '') + '" data-day="' + k + '"><div class="poll-date"><b class="' + (dow === 0 || hol ? 'sun' : dow === 6 ? 'sat' : '') + '">' + fmtJa(k) + '</b><span class="poll-cnt">◯ ' + ok.length + '/' + voters.length + '</span></div>';
        if (isVoter && !past) {
          const my = v[who] || '';
          ah += '<div class="poll-btns">' +
            '<button type="button" class="btn small vote' + (my === '◯' ? ' on-ok' : '') + '" data-vote="◯" data-id="' + esc(s.id) + '" data-day="' + k + '" aria-pressed="' + (my === '◯') + '" aria-label="' + fmtJa(k) + ' は ◯">◯</button>' +
            '<button type="button" class="btn small vote' + (my === '×' ? ' on-ng' : '') + '" data-vote="×" data-id="' + esc(s.id) + '" data-day="' + k + '" aria-pressed="' + (my === '×') + '" aria-label="' + fmtJa(k) + ' は ×">×</button></div>';
        }
        ah += '<div class="poll-names hint">' + [ok.length ? '◯ ' + esc(ok.join('、')) : '', ng.length ? '× ' + esc(ng.join('、')) : '', no.length ? '未回答 ' + esc(no.join('、')) : ''].filter(Boolean).join('　') + '</div>';
        if (canDecide && !past) ah += '<div class="poll-decide"><button type="button" class="btn small' + (ok.length === voters.length ? ' primary' : '') + '" data-decide="' + esc(s.id) + '" data-day="' + k + '">' + mi('event_available', 'sm') + 'この日に決める</button></div>';
        ah += '</div>';
      });
      if (canDecide && !pollPending(s).length) ah += '<p class="next">' + mi('arrow_forward', 'sm') + '<span>全員の回答がそろいました。開催日を「この日に決める」で選んでください。</span></p>';
      // 回答は本人だけが入れる。ゲストと、Discord の ID の無いメンバーは答えられないので数えない
      const cant = peopleOf(s).filter((n) => voters.indexOf(n) < 0);
      if (cant.length) ah += '<p class="hint">' + esc(cant.join('、')) + ' は Discord で入らないので、回答できません（数えません）。</p>';
      if (!isVoter) ah += '<p class="hint">' + esc(who) + ' はこの卓の GM でも参加者でもないので、回答できません。</p>';
      ah += '</div>';
    }
    if (!poll) ah += '<p class="next">' + mi('arrow_forward', 'sm') + '<span>' + (s.members.length ? '次は「日程を調整する」で候補日を選び、参加者に聞きます。' : '次は「編集」で参加者を入れてから、「日程を調整する」で候補日を選びます。') + '</span></p>';
    ah += '<div class="btns">' +
      (poll ? '<button type="button" class="btn small" data-poll="' + esc(s.id) + '">' + mi('edit_calendar', 'sm') + '候補日を選び直す</button><button type="button" class="btn small danger" data-poll-cancel="' + esc(s.id) + '" style="margin-left:0">調整をやめる</button>'
        : '<button type="button" class="btn small primary" data-poll="' + esc(s.id) + '">' + mi('how_to_vote', 'sm') + '日程を調整する</button>') +
      '<button type="button" class="btn small" data-win="' + esc(s.id) + '" title="カレンダーの「都合を見る卓」をこの卓にして、候補の日に枠を付ける">' + mi('date_range', 'sm') + '候補日をカレンダーで見る</button>' +
      '<button type="button" class="btn small" data-edit="' + esc(s.id) + '" style="margin-left:auto">編集</button></div></div>';
  });
  $('adjustList').innerHTML = ah;
}

/** 「どの日でもいい」。これからの候補日すべてに ◯ を付ける。もう一度押すと、自分の回答をすべて取り消す */
function castAny(id: string, off: boolean): void {
  const name = me(); if (!name) return;
  const s = byId(id); if (!s) return;
  const days = s.candidates.filter((k) => k >= D.today);
  if (!days.length) { toast('これからの候補日がありません'); return; }
  const ng = days.filter((k) => ((s.votes || {})[k] || {})[name] === '×');
  const go = () => {
    s.votes = s.votes || {};
    days.forEach((k) => {
      if (!s.votes[k]) s.votes[k] = {};
      if (off) delete s.votes[k][name]; else s.votes[k][name] = '◯';
    });
    renderRecruit(); renderNotices(); renderCal();
    api().withSuccessHandler((res) => {
      takeData(res); toast(res.message);
      if (res.ready && res.notified === false && res.id) notifyReady(res.id, res.message);
    }).withFailureHandler((e) => { toast(e.message); refetch(); })
      .setPollVoteAll({ id, name, vote: off ? '' : '◯' });
  };
  if (off) askConfirm({ title: '回答を取り消しますか？', message: '「' + s.name + '」に付けた ◯ を、これからの候補日すべてで消します。', ok: '取り消す', danger: true }, go);
  else if (ng.length) askConfirm({ title: 'どの日でもいい、にしますか？', message: '× を付けた ' + ng.length + ' 日も ◯ に変わります。候補日 ' + days.length + ' 日すべてに ◯ を付けます。', ok: '◯ を付ける' }, go);
  else go();
}
/** 回答。同じ印をもう一度押すと取り消す。押した瞬間に画面へ出し、返事で確定する */
function castVote(id: string, k: string, mark: string): void {
  const name = me(); if (!name) return;
  const s = byId(id); if (!s) return;
  s.votes = s.votes || {};
  if (!s.votes[k]) s.votes[k] = {};
  const cur = s.votes[k][name] || '', next = cur === mark ? '' : mark;
  if (next) s.votes[k][name] = next; else delete s.votes[k][name];
  renderRecruit(); renderNotices(); renderCal();
  api().withSuccessHandler((res) => {
    takeData(res);
    toast(res.message);
    if (res.ready && res.notified === false && res.id) notifyReady(res.id, res.message);
  }).withFailureHandler((e) => { toast(e.message); refetch(); })
    .setPollVote({ id, ymd: k, name, vote: next });
}

/* 興味ありの人に聞く。一言を添える窓を出してから送る */
let askId = '';
function openAsk(id: string): void {
  const sa = byId(id); if (!sa) return;
  askId = id;
  $('askTitle').textContent = '「' + sa.name + '」に興味ありの人に聞く';
  $('askWho').textContent = sa.interest.join('、') + ' さんに、参加できそうかを Discord で聞きます。' + '返事は「募集・調整」タブの「参加希望」を押してもらいます。';
  $('askText').value = '';
  $('askModal').hidden = false; $('askText').focus();
}

export function init(): void {
  $('adjustList').addEventListener('click', (ev) => {
    if (hit(ev, '[data-new-adjust]')) { openNewWithStatus('調整中'); return; }
    const db = hit<HTMLButtonElement>(ev, 'button[data-decide]');
    if (db) {
      const sdc = byId(db.dataset.decide); if (!sdc) return;
      const dk = db.dataset.day!, dv = (sdc.votes || {})[dk] || {}, dvs = peopleOf(sdc);
      const dng = dvs.filter((n) => dv[n] !== '◯');
      askConfirm({ title: fmtJa(dk) + ' に決めますか？', message: '「' + sdc.name + '」の開催日を ' + fmtJa(dk) + ' にして、状態を「開催」にします。候補日とみんなの回答は消えます。' + (dng.length ? '　◯ でない人: ' + dng.join('、') : ''), ok: 'この日に決める' }, () => {
        db.disabled = true;
        api().withSuccessHandler((res) => { toast(res.message); takeData(res); if (res.notified === false && res.id) notifyDecided(res.id, res.message); })
          .withFailureHandler((e) => { db.disabled = false; toast(e.message); })
          .decidePoll({ id: sdc.id, ymd: dk, me: me() });
      });
      return;
    }
    const ab = hit(ev, 'button[data-any]');
    if (ab) { castAny(ab.dataset.any!, ab.getAttribute('aria-pressed') === 'true'); return; }
    const ed = hit(ev, 'button[data-edit]');
    if (ed) { fillForm(ed.dataset.edit!); openForm(); return; }
    const vb = hit(ev, 'button[data-vote]');
    if (vb) { castVote(vb.dataset.id!, vb.dataset.day!, vb.dataset.vote!); return; }
    const pb = hit(ev, 'button[data-poll]');
    if (pb) { openPoll(pb.dataset.poll!); return; }
    const pc = hit<HTMLButtonElement>(ev, 'button[data-poll-cancel]');
    if (pc) {
      const sc = byId(pc.dataset.pollCancel); if (!sc) return;
      askConfirm({ title: '日程調整をやめますか？', message: '「' + sc.name + '」の候補日とみんなの回答は消えます。卓は調整中のまま残ります。', ok: '調整をやめる', danger: true }, () => {
        pc.disabled = true;
        api().withSuccessHandler((res) => { toast(res.message); takeData(res); })
          .withFailureHandler((e) => { pc.disabled = false; toast(e.message); })
          .cancelPoll({ id: sc.id });
      });
      return;
    }
    const w = hit(ev, 'button[data-win]'); if (!w) return;
    const s = byId(w.dataset.win); if (!s) return;
    $('target').value = s.name; store('target', s.name);
    showTab('cal');
    const firstDay = hasPoll(s) ? (s.candidates.filter((k) => k >= D.today)[0] || s.candidates[0]) : s.windowFrom;
    if (firstDay) { selectDay(firstDay); revealDay(); } else renderCal();
  });

  $('recruitList').addEventListener('click', (ev) => {
    if (hit(ev, '[data-new-recruit]')) { openNewWithStatus('募集'); return; }
    const hb = hit(ev, 'button[data-hold]');
    if (hb) { fillForm(hb.dataset.hold!); $('status').value = '開催'; syncStatusUi(); openForm(); $('date').focus(); return; }
    const ed = hit(ev, 'button[data-edit]');
    if (ed) { fillForm(ed.dataset.edit!); openForm(); return; }
    const ask = hit(ev, 'button[data-ask]');
    if (ask) { openAsk(ask.dataset.ask!); return; }
    const b = hit(ev, 'button[data-level]'); if (!b) return;
    const name = me(); if (!name) return;
    const s = byId(b.dataset.id); if (!s) return;
    const level = b.dataset.level!;
    // 押した瞬間に付け替える。失敗したら読み直す
    s.want = s.want.filter((n) => n !== name); s.interest = s.interest.filter((n) => n !== name);
    if (level === 'want') s.want.push(name); else if (level === 'interest') s.interest.push(name);
    renderRecruit(); renderOps(); renderNotices();
    const el = document.querySelector('.res[data-rres="' + s.id + '"]'); if (el) el.textContent = '保存しています…';
    api().withSuccessHandler((res) => { toast(res.message); takeData(res); })
      .withFailureHandler((e) => { toast(e.message); refetch(); })
      .setInterest({ id: s.id, name, level });
  });

  $('askCancel').onclick = () => { $('askModal').hidden = true; };
  $('askForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const sa = byId(askId); if (!sa) return;
    const text = $('askText').value.trim();
    $('askModal').hidden = true;
    const btn = document.querySelector<HTMLButtonElement>('button[data-ask="' + sa.id + '"]'); if (btn) btn.disabled = true;
    const setA = (t: string) => { const el = document.querySelector('.res[data-ares="' + sa.id + '"]'); if (el) el.textContent = t; };
    discordSend({ kind: 'ask', id: sa.id, me: me(), message: text }, setA, (ok, r) => {
      if (btn) btn.disabled = false;
      toast(ok ? 'Discord に送りました: ' + sa.name : failToast(r));
      if (r.data) takeData(r);
    });
  });
}
