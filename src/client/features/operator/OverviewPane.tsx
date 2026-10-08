// 運営者の管理画面の「様子」。新しい版の知らせ・数・新規登録の受付・知らせの見回り（cron）・Discordへの送信の失敗
import { Link } from '@tanstack/react-router';
import type { AdminOverview, AdminUpdate } from '../../../shared/admin';
import { askConfirm } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { ADMIN_READS, useAct, useAdmin } from './api';
import { ago, fmt } from './format';
import { dd, dl, dt, state as stateCls } from './styles';

/** 数の箱を並べる */
const counts = 'mb-14 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-12';

function Count({ n, label, sub }: { n: number; label: string; sub?: string }) {
  // op-countはe2eが探す印
  return (
    <div className="op-count flex flex-col gap-2 rounded-lg border border-line bg-card px-16 py-14">
      <b className="text-28 leading-[1.2] tabular-nums">{n}</b><span className="text-13 font-semibold">{label}</span>{sub && <small className="text-12 text-muted">{sub}</small>}
    </div>
  );
}

export function OverviewPane() {
  const o = useAdmin<AdminOverview>(ADMIN_READS.overview.queryKey, ADMIN_READS.overview.path).data;
  const up = useAdmin<AdminUpdate>(ADMIN_READS.update.queryKey, ADMIN_READS.update.path).data;
  const act = useAct();
  if (!o) {
    return (
      <div data-pane="overview">
        <div className={counts} id="opCounts"></div>
        <div className="card" id="opReg"></div>
        <div className="card" id="opPatrol"></div>
        <Fails o={o} />
      </div>
    );
  }
  const c = o.counts, p = o.patrol, last = p.last;
  const state = !last ? ['bad', '記録がありません（cronがまだ一度も動いていないか、止まっています）']
    : p.stale ? ['bad', '最後の見回りが' + ago(last.at) + 'です。cronが止まっているかもしれません']
      : !last.ok ? ['warn', '最後の見回りが失敗しました: ' + last.error]
        : ['ok', '動いています（' + ago(last.at) + '、' + last.ms + 'ミリ秒）'];
  // 新規登録の受付。止めるときだけ確かめる
  const toggleReg = () => {
    const open = !o.registrationOpen;
    const go = () => { void act('/api/admin/registration', { open }); };
    if (open) go();
    else askConfirm({ title: '新規登録の受付を止めますか？', message: '新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。', ok: '受付を止める' }, go);
  };
  return (
    <div data-pane="overview">
      {/* 新しいバージョンがあれば、いちばん上で知らせる。押すと「更新」の区分へ */}
      {up && up.available && up.latest && (
        <Link className={stateCls('warn') + ' mt-0 mb-14 flex items-center gap-8 no-underline hover:underline'} id="opUpdateNotice" to="/admin/$pane/" params={{ pane: 'update' }}>
          <Icon name="upgrade" size="sm" />{'新しいバージョンv' + up.latest.version + 'があります（いまはv' + up.current + '）。更新の区分で、変わったことを見て更新できます'}
          <Icon name="chevron_right" size="sm" className="ml-auto" />
        </Link>
      )}
      <div className={counts} id="opCounts">
        <Count n={c.groups} label="グループ" />
        <Count n={c.users} label="利用者" sub={c.bannedUsers ? '締め出し' + c.bannedUsers + '人' : ''} />
        <Count n={c.logins} label="有効なログイン" sub="ブラウザ・端末ごとに数える" />
        <Count n={c.activeSessions} label="動いている卓" sub="募集・調整中・開催" />
      </div>
      <div className="card" id="opReg">
        <h3><Icon name="person_add" size="sm" />新規登録の受付</h3>
        <p className={stateCls(o.registrationOpen ? 'ok' : 'warn')}>{o.registrationOpen ? '受け付けています' : '止めています'}</p>
        <p className="hint">止めると、新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。運営者は、止めていてもログインでき、グループも作れます。</p>
        <button type="button" className="btn small" id="opRegToggle" data-open={o.registrationOpen ? '0' : '1'} onClick={toggleReg}>{o.registrationOpen ? '受付を止める' : '受け付ける'}</button>
      </div>
      <div className="card" id="opPatrol">
        <h3><Icon name="monitor_heart" size="sm" />知らせの見回り（cron、5分おき）</h3>
        <p className={stateCls(state[0]!)}>{state[1]}</p>
        <dl className={dl}>
          <dt className={dt}>最後の見回り</dt><dd className={dd}>{last ? fmt(last.at) : '—'}</dd>
          <dt className={dt}>最後にうまくいった見回り</dt><dd className={dd}>{fmt(p.okAt)}</dd>
          <dt className={dt}>毎時の仕事（開催前の知らせ・期間前の催促・自動終了）</dt><dd className={dd}>{p.hourly ? p.hourly.replace('T', ' ') + '時台' : '—'}</dd>
          <dt className={dt}>毎日の片付け</dt><dd className={dd}>{p.daily || '—'}</dd>
        </dl>
      </div>
      <Fails o={o} />
    </div>
  );
}

/** Discordへの送信の失敗。グループの名前を押すと、グループの区分でそのグループを開く */
function Fails({ o }: { o: AdminOverview | undefined }) {
  return (
    <div className="card">
      <h3><Icon name="warning" size="sm" />Discordへの送信の失敗 <small className="hint">送り直しても届かなかったもの・送り先が無かったもの。新しい順50件</small></h3>
      <p className="hint" id="opFailSum">{o ? '24時間で' + o.failures.day + '件、7日で' + o.failures.week + '件。' : ''}</p>
      <div className="wrap">
        <table id="opFails">
          {o && (
            <tbody>
              {o.failures.recent.length ? (
                <>
                  <tr><th>日時</th><th>グループ</th><th>種別</th><th>結果</th></tr>
                  {o.failures.recent.map((f, i) => (
                    <tr key={i}>
                      <td className="nw">{fmt(f.at)}</td>
                      <td><Link to="/admin/$pane/" params={{ pane: 'groups' }} search={{ open: f.groupId }} data-open={f.groupId}>{f.groupTitle}</Link></td>
                      <td className="nw">{f.kind}</td><td>{f.result}</td>
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
