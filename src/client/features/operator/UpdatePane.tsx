// 運営者の管理画面の「更新」。動いている卓予定の版と、元のリポジトリの最新の版・変わったこと・表の変更があるかを出す。
// 更新は、公開しているリポジトリの更新のワークフロー（GitHubのActions）がする。トークンがあればボタンで動かし、無ければGitHubの画面を開く
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminUpdate, AdminUpdateRun } from '../../../shared/admin';
import { askConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { ADMIN_READS, adminCall, useAct, useAdmin } from './api';
import { ago, fmt } from './format';
import { dd, dl, dt, state as stateCls } from './styles';

type Section = { title: string; items: string[] };

/** 箇条書きの1行を文字だけにする（範囲の印 **client:**・末尾のコミットの印・リンクを外す） */
const clean = (t: string) => t
  .replace(/^\*\*[^*]+:\*\*\s*/, '')
  .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .trim();

/** Releaseの本文（semantic-releaseがConventional Commitsから書くMarkdown）を、見出しと箇条書きに分ける */
export function parseNotes(md: string): Section[] {
  const out: Section[] = [];
  for (const line of md.split('\n')) {
    const h = /^#{3,4}\s+(.+)$/.exec(line);
    if (h) { out.push({ title: h[1]!.trim(), items: [] }); continue; }
    const li = /^\s*[*-]\s+(.+)$/.exec(line);
    if (!li) continue;
    if (!out.length) out.push({ title: '', items: [] });
    out[out.length - 1]!.items.push(clean(li[1]!));
  }
  return out.filter((s) => s.items.length);
}

/** 実行の様子（GitHubのstatus・conclusionを言葉に） */
function runState(r: AdminUpdateRun): [string, string] {
  if (r.status !== 'completed') return ['warn', r.status === 'queued' || r.status === 'waiting' || r.status === 'pending' ? '待っています' : '進んでいます'];
  if (r.conclusion === 'success') return ['ok', '済み'];
  if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return ['warn', '取り消し'];
  return ['bad', '失敗（取り込みでぶつかったときは、PRができています）'];
}

export function UpdatePane() {
  const u = useAdmin<AdminUpdate>(ADMIN_READS.update.queryKey, ADMIN_READS.update.path).data;
  const act = useAct();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const recheck = () => {
    setBusy(true);
    adminCall<AdminUpdate>(ADMIN_READS.update.path + '?refresh=1').then(
      (r) => { qc.setQueryData(ADMIN_READS.update.queryKey, r); setBusy(false); toast(r.error || (r.available ? '新しい版v' + r.latest!.version + 'があります' : '最新です')); },
      (e: Error) => { setBusy(false); toast(e.message); },
    );
  };
  if (!u) return <div data-pane="update"><div className="card" id="opUpdate" /></div>;
  const latest = u.latest, notes = latest ? parseNotes(latest.notes) : [];
  const start = () => askConfirm({
    title: 'v' + latest!.version + 'に更新しますか？',
    message: 'GitHubのActionsが、元のリポジトリのv' + latest!.version + 'を取り込んで公開します。数分かかります。'
      + (u.migrations ? '表（D1）の変更を含みます。変える前の地点を控えるので、戻すときはそこへ戻せます。' : ''),
    ok: '更新する',
  }, () => { setBusy(true); void act('/api/admin/update', {}).then(() => setBusy(false)); });
  const [tone, say] = u.available ? ['warn', '新しい版v' + latest!.version + 'があります']
    : latest ? ['ok', '最新です'] : u.error ? ['bad', '新しい版を確かめられませんでした'] : ['ok', 'まだ版が出ていません'];
  return (
    <div data-pane="update">
      <div className="card" id="opUpdate">
        <h3><Icon name="upgrade" size="sm" />卓予定の版</h3>
        <p className={stateCls(tone)} id="opUpdateState">{say}</p>
        {u.error && <p className="hint text-err-text" id="opUpdateError">{u.error}</p>}
        <dl className={dl}>
          <dt className={dt}>動いている版</dt><dd className={dd} id="opVersion">{'v' + u.current}</dd>
          <dt className={dt}>最新の版</dt><dd className={dd} id="opLatest">{latest ? 'v' + latest.version + (latest.publishedAt ? '（' + fmt(latest.publishedAt) + '）' : '') : '—'}</dd>
          <dt className={dt}>元のリポジトリ</dt><dd className={dd}><a href={'https://github.com/' + u.upstream} target="_blank" rel="noopener">{u.upstream}</a></dd>
          <dt className={dt}>確かめた時刻</dt><dd className={dd}>{fmt(u.checkedAt) + (u.checkedAt ? '（' + ago(u.checkedAt) + '）' : '')}</dd>
        </dl>
        {u.available && notes.length > 0 && (
          <div className="mt-14" id="opNotes">
            {notes.map((s) => (
              <div key={s.title} className="mt-8">
                {s.title && <b className="text-13">{s.title}</b>}
                <ul className="mt-4 mb-0 pl-20 text-13 leading-[1.7]">{s.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {u.available && !notes.length && latest!.notes && <p className="mt-14 text-13 whitespace-pre-wrap">{latest!.notes}</p>}
        {u.available && u.migrations && (
          <p className={stateCls('warn') + ' text-13'} id="opMigrations">表（D1）の変更を含みます。公開のときに、変える前の地点（D1のTime Travel）を控えます。戻すときは、その地点へ戻します。</p>
        )}
        <div className="btns mt-12">
          {u.available && u.canDispatch && (
            <button type="button" className="btn primary" id="opUpdateStart" disabled={busy} onClick={start}><Icon name="upgrade" size="sm" />{'v' + latest!.version + 'に更新する'}</button>
          )}
          {u.available && !u.canDispatch && u.workflowUrl && (
            <a className="btn primary" id="opUpdateGitHub" href={u.workflowUrl} target="_blank" rel="noopener"><Icon name="open_in_new" size="sm" />GitHubで更新する</a>
          )}
          {latest && <a className="btn" href={latest.url} target="_blank" rel="noopener"><Icon name="open_in_new" size="sm" />Releaseを見る</a>}
          <button type="button" className="btn" id="opUpdateCheck" disabled={busy} onClick={recheck}><Icon name="refresh" size="sm" />確かめ直す</button>
        </div>
        {u.available && !u.canDispatch && (
          <p className="hint">
            {u.workflowUrl ? 'GitHubの画面で「Run workflow」を押すと、最新の版を取り込んで公開します。' : '公開しているリポジトリが分かりません（公開のワークフローで入ります）。'}
            WorkerのsecretにUPDATE_DISPATCH_TOKENを入れると、ここのボタンで更新できます（READMEの「新しい版に上げる」）。
          </p>
        )}
        <p className="hint">更新は、公開しているリポジトリのGitHubのActions（更新のワークフロー）が、元のリポジトリの版を取り込んで公開します。コードを直しているときなど、取り込みでぶつかったら、mainを変えずにPRを作って止まります。</p>
      </div>
      {u.canDispatch && (
        <div className="card" id="opRuns">
          <h3><Icon name="history" size="sm" />更新の記録 <small className="hint">新しい順5件</small></h3>
          {u.runs.length ? (
            <ul className="m-0 list-none p-0">
              {u.runs.map((r) => {
                const [t, s] = runState(r);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-12 gap-y-4 border-t border-line py-8 text-13 first:border-t-0">
                    <span className="tabular-nums">{fmt(r.createdAt)}</span>
                    <span className={stateCls(t) + ' my-0 px-8 py-2 text-12'}>{s}</span>
                    <a className="ml-auto" href={r.url} target="_blank" rel="noopener">GitHubで見る</a>
                  </li>
                );
              })}
            </ul>
          ) : <p className="hint">まだ更新していません。</p>}
        </div>
      )}
    </div>
  );
}
