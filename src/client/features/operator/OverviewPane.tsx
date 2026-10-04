// 運営者の管理画面の「様子」。数・新規登録の受付・知らせの見回り（cron）・Discord への送信の失敗
import { Link } from '@tanstack/react-router';
import type { AdminOverview } from '../../../shared/admin';
import { askConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { ADMIN_READS, useAct, useAdmin } from './api';
import { ago, fmt } from './format';

function Count({ n, label, sub }: { n: number; label: string; sub?: string }) {
  return <div className="op-count"><b>{n}</b><span>{label}</span>{sub && <small>{sub}</small>}</div>;
}

export function OverviewPane() {
  const o = useAdmin<AdminOverview>(ADMIN_READS.overview.queryKey, ADMIN_READS.overview.path).data;
  const act = useAct();
  if (!o) {
    return (
      <div className="set-pane" data-pane="overview">
        <div className="op-counts" id="opCounts"></div>
        <div className="card" id="opReg"></div>
        <div className="card" id="opPatrol"></div>
        <Fails o={o} />
      </div>
    );
  }
  const c = o.counts, p = o.patrol, last = p.last;
  const state = !last ? ['bad', '記録がありません（cron がまだ一度も動いていないか、止まっています）']
    : p.stale ? ['bad', '最後の見回りが ' + ago(last.at) + 'です。cron が止まっているかもしれません']
      : !last.ok ? ['warn', '最後の見回りが失敗しました: ' + last.error]
        : ['ok', '動いています（' + ago(last.at) + '、' + last.ms + ' ミリ秒）'];
  // 新規登録の受付。止めるときだけ確かめる
  const toggleReg = () => {
    const open = !o.registrationOpen;
    const go = () => { void act('/api/admin/registration', { open }); };
    if (open) go();
    else askConfirm({ title: '新規登録の受付を止めますか？', message: '新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。', ok: '受付を止める' }, go);
  };
  return (
    <div className="set-pane" data-pane="overview">
      <div className="op-counts" id="opCounts">
        <Count n={c.groups} label="グループ" />
        <Count n={c.users} label="利用者" sub={c.bannedUsers ? '締め出し ' + c.bannedUsers + ' 人' : ''} />
        <Count n={c.logins} label="有効なログイン" />
        <Count n={c.activeSessions} label="動いている卓" sub="募集・調整中・開催" />
      </div>
      <div className="card" id="opReg">
        <h3><Icon name="person_add" size="sm" />新規登録の受付</h3>
        <p className={'op-state ' + (o.registrationOpen ? 'ok' : 'warn')}>{o.registrationOpen ? '受け付けています' : '止めています'}</p>
        <p className="hint">止めると、新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。運営者は、止めていてもログインでき、グループも作れます。</p>
        <button type="button" className="btn small" id="opRegToggle" data-open={o.registrationOpen ? '0' : '1'} onClick={toggleReg}>{o.registrationOpen ? '受付を止める' : '受け付ける'}</button>
      </div>
      <div className="card" id="opPatrol">
        <h3><Icon name="monitor_heart" size="sm" />知らせの見回り（cron、5 分おき）</h3>
        <p className={'op-state ' + state[0]}>{state[1]}</p>
        <dl className="op-dl">
          <dt>最後の見回り</dt><dd>{last ? fmt(last.at) : '—'}</dd>
          <dt>最後にうまくいった見回り</dt><dd>{fmt(p.okAt)}</dd>
          <dt>毎時の仕事（開催前の知らせ・期間前の催促・自動終了）</dt><dd>{p.hourly ? p.hourly.replace('T', ' ') + ' 時台' : '—'}</dd>
          <dt>毎日の片付け</dt><dd>{p.daily || '—'}</dd>
        </dl>
      </div>
      <Fails o={o} />
    </div>
  );
}

/** Discord への送信の失敗。グループの名前を押すと、グループの区分でそのグループを開く */
function Fails({ o }: { o: AdminOverview | undefined }) {
  return (
    <div className="card">
      <h3><Icon name="warning" size="sm" />Discord への送信の失敗 <small className="hint">送り直しても届かなかったもの・送り先が無かったもの。新しい順 50 件</small></h3>
      <p className="hint" id="opFailSum">{o ? '24 時間で ' + o.failures.day + ' 件、7 日で ' + o.failures.week + ' 件。' : ''}</p>
      <div className="wrap">
        <table id="opFails">
          {o && (
            <tbody>
              {o.failures.recent.length ? (
                <>
                  <tr><th>日時</th><th>グループ</th><th>種別</th><th>対象</th><th>結果</th></tr>
                  {o.failures.recent.map((f, i) => (
                    <tr key={i}>
                      <td className="nw">{fmt(f.at)}</td>
                      <td><Link to="/admin/$pane/" params={{ pane: 'groups' }} search={{ open: f.groupId }} data-open={f.groupId}>{f.groupTitle}</Link></td>
                      <td className="nw">{f.kind}</td><td>{f.target}</td><td>{f.result}</td>
                    </tr>
                  ))}
                </>
              ) : <tr><td className="hint">失敗はありません。</td></tr>}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
