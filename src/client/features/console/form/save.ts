// 卓の保存と削除（登録の窓と変更の窓で共通）。
// 押した瞬間にカレンダーへ仮に出して窓を閉じ、返事が来たら本物に置き換える。失敗したらonFailで窓に戻す
import type { ConsoleSession, RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { toast } from '../../../ui/toast';
import { openPoll } from '../actions';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { winLabel } from '../model/dates';
import { byId, hasPoll, isRecruit, me, splitNames, STATUS_PROMOTE } from '../model/model';
import { isTmp, TMP, withoutSession, withoutTmp, withSessions } from '../model/optimistic';
import type { SessionForm } from './model';
import { splitWant } from '../../../../shared/waitlist';

export function useSessionSave() {
  const d = useData();
  const { ui, sync } = useConsole();
  const close = () => ui.set((st) => ({ ...st, form: null }));

  /** 保存の返事で新しい卓が画面のデータに入ってから、候補日を選ぶ窓を開く */
  const openPollWhenReady = (id: string, n = 20) => {
    const x = byId(sync.data()!, id), u = ui.get();
    if (x && !isTmp(x.id) && !u.form && !u.poll) { openPoll(ui, id); return; }
    if (n > 0) setTimeout(() => openPollWhenReady(id, n - 1), 250);
  };

  /** 保存する（確かめは済ませておく）。promotedは、募集から移すときに参加者にする興味ありの人 */
  const save = (form: SessionForm, promoted: string[] | null, onFail: (message: string) => void) => {
    const prev = byId(d, form.id);
    if (promoted) promoted.forEach((n) => { if (form.members.indexOf(n) < 0) form.members.push(n); });
    // 押した瞬間にカレンダーへ仮に出す。予定にするなら参加希望の人も参加者に入れておく
    const tmpMembers = form.members.concat(splitNames(form.extra)), toDated = STATUS_PROMOTE.indexOf(form.status) >= 0;
    // 募集から移すときは、参加希望（定員の中）の人だけ。キャンセル待ちの人は並んだまま残る
    const pw = prev ? splitWant(prev) : { want: [], wait: [] };
    if (prev && toDated && isRecruit(prev)) pw.want.forEach((n) => { if (tmpMembers.indexOf(n) < 0 && n !== form.gm.trim()) tmpMembers.push(n); });
    const tmp: ConsoleSession = {
      id: form.id || TMP, name: form.name.trim(), gm: form.gm.trim(), members: tmpMembers,
      date: form.date, start: form.start, end: form.end, status: form.status as ConsoleSession['status'], place: form.place.trim(), memo: form.memo.trim(), notified: '', editor: form.me,
      want: !prev ? [] : !toDated ? prev.want : (isRecruit(prev) ? pw.wait : prev.want).filter((n) => tmpMembers.indexOf(n) < 0), interest: prev ? prev.interest : [], series: form.series, seriesEnd: form.seriesEnd, asked: '',
      window: '', windowFrom: form.windowFrom, windowTo: form.windowTo, windowLabel: winLabel(form.windowFrom, form.windowTo), windowKey: form.windowFrom || '',
      candidates: prev && form.status === '調整中' ? (prev.candidates || []) : [], votes: prev ? (prev.votes || {}) : {},
      pollDue: prev && form.status === '調整中' ? prev.pollDue : '',
      scenarioId: form.scenarioId,
      // 準備（HO・キャラシ）は卓の窓では変えないので、今のまま
      prep: prev ? prev.prep : { sheetDue: '', slots: [], sheets: {} },
      capacity: +form.capacity || 0, recruitDue: form.recruitDue,
      // 行けなくなった印は、開催日がそのままで開催のままなら残る（外した参加者の分は消える）
      absent: prev && prev.date === form.date && form.status === '開催' ? prev.absent.filter((a) => form.members.indexOf(a.name) >= 0) : [],
      // 記録は卓の窓では変えないので、今のまま
      record: prev ? prev.record : { logUrl: '', recap: '' },
    };
    let tmps = [tmp];
    if (form.dates) {
      // 何日かまとめて。名前は末尾の数字を進める（サーバーと同じ決まり）
      const base = tmp.name, mm = /^(.*?)(\d+)(\D*)$/.exec(base);
      tmps = form.dates.map((dt, i) => ({ ...tmp, id: TMP + i, date: dt, name: i === 0 ? base : mm ? mm[1]! + (Number(mm[2]) + i) + mm[3]! : base + ' #' + (i + 1) }));
    }
    if (form.date) ui.set((x) => ({ ...x, selDay: form.date }));
    // 窓は押した瞬間に閉じる。カレンダーには仮に出ている。結果は吹き出しで知らせる
    close();
    toast('保存しています…');
    const wantNotify = form.notify, wasEdit = !!form.id, wantPoll = form.status === '調整中' && !(prev && hasPoll(prev));
    form.notify = false;   // Discordへは、保存が終わってから画面側が送る
    sync.write<RpcResult>('saveSession', form, { optimistic: (cur) => withSessions(cur, tmps), rollback: withoutTmp }).then((res) => {
      toast(res.message);
      if (wantPoll && res.id) openPollWhenReady(res.id);
      if (!wantNotify) return;
      const r = res.ids && res.ids.length > 1 ? { kind: 'bulk', names: res.names, ids: res.ids, label: '登録', series: form.series, me: me(d) } : { kind: 'change', id: res.id, verb: wasEdit ? '変更' : '登録', me: me(d) };
      void discordSend(sync, r, (t) => toast(t)).then(({ ok, r: sr }) => { toast(ok ? 'Discordに送りました: ' + res.message.replace(/^.*?: /, '') : failToast(sr)); });
    }, (err: Error) => {
      // 失敗したら、入力を残したまま窓を開き直す
      onFail(err.message); toast('保存できませんでした');
      void sync.refresh('quiet');
    });
  };

  /** 削除する。確かめてから、押した瞬間にカレンダーから消し、窓を閉じる */
  const remove = (form: SessionForm, onFail: (message: string) => void) => {
    if (!form.id) return;
    askConfirm({ title: '卓を削除しますか？', message: '「' + form.name + '」を消します。元に戻せません。', ok: '削除する', danger: true }, () => {
      close();
      toast('削除しています…');
      sync.write<RpcResult>('deleteSession', { id: form.id, me: form.me, notify: false }, { optimistic: (cur) => withoutSession(cur, form.id) }).then((res) => {
        toast(res.message);
        if (!form.notify) return;
        void discordSend(sync, { kind: 'delete', name: form.name, series: form.series, status: form.status, me: me(d) }, (t) => toast(t))
          .then(({ ok, r }) => { toast(ok ? 'Discordに送りました: ' + form.name : failToast(r)); });
      }, (err: Error) => { onFail(err.message); toast('削除できませんでした'); void sync.refresh('quiet'); });
    });
  };

  /** 募集から開催・調整中に移すとき、興味ありの人がいれば、先に参加者にするかを確かめる */
  const needsPromote = (form: SessionForm): ConsoleSession | null => {
    const prev = byId(d, form.id);
    return prev && isRecruit(prev) && STATUS_PROMOTE.indexOf(form.status) >= 0 && prev.interest.length ? prev : null;
  };

  return { save, remove, needsPromote };
}
