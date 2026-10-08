// 運営者の管理画面の「様子」。新しい版の知らせ・Botのトークンの知らせ・数・新規登録の受付・Discordのボタン・運営者への知らせ・知らせの見回り（cron）・Discordへの送信の失敗
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
        <div className="card" id="opButtons"></div>
        <div className="card" id="opNotice"></div>
        <div className="card" id="opPatrol"></div>
        <Fails o={o} />
      </div>
    );
  }
  const c = o.counts, p = o.patrol, last = p.last;
  const state = !last ? ['bad', '記録がありません（cronがまだ一度も動いていないか、止まっています）']
    : p.stale ? ['bad', '最後の見回りが' + ago(last.at) + 'です。cronが止まっているかもしれません']
      : !last.ok ? ['warn', '最後の見回りが失敗しました' + ((last.fails ?? 1) > 1 ? '（' + last.fails + '回続けて）' : '') + ': ' + last.error]
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
      {/* Botのトークンが使えなければ、いちばん上で知らせる（BotからのDMも届かないため） */}
      {o.notices.bot.state === 'bad' && (
        <p className={stateCls('bad') + ' mt-0 mb-14'} id="opBotBad">
          {'YokiのBotのトークンが使えません（' + fmt(o.notices.bot.since) + 'から）。Discordへの知らせが届いていません。DiscordのDeveloper PortalでBotのトークンを作り直し、WorkerのsecretのDISCORD_BOT_TOKENを入れ直してください。'}
        </p>
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
      <div className="card" id="opButtons">
        <h3><Icon name="touch_app" size="sm" />Discordのボタン</h3>
        <p className={stateCls(o.discordButtons ? 'ok' : 'warn')}>{o.discordButtons ? '日程調整と募集の知らせにボタンを付けています' : '付けていません'}</p>
        <p className="hint">入れると、日程調整と募集の知らせにボタンが付き、Discordのまま「予定表から答える」「どの日でもいい」「行ける日を選ぶ」「参加希望」「興味あり」を押せます。入れるときは、YokiのBotのトークンで、DiscordアプリのInteractions Endpoint URLにこのYokiのアドレスを入れます。公開のアドレスで開いた、この画面から入れてください。</p>
        <button type="button" className="btn small" id="opButtonsToggle" data-on={o.discordButtons ? '0' : '1'} onClick={() => { void act('/api/admin/discord-buttons', { on: !o.discordButtons }); }}>{o.discordButtons ? 'ボタンを付けない' : 'ボタンを付ける'}</button>
      </div>
      <NoticeCard n={o.notices} />
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

/** 運営者への知らせ（BotからのDM）。止める・使う、自分に試しに送る */
function NoticeCard({ n }: { n: AdminOverview['notices'] }) {
  const act = useAct();
  const b = n.bot, last = n.last;
  const bot = b.state === 'ok' ? '使えます（' + fmt(b.at) + 'に確かめました）'
    : b.state === 'bad' ? '使えません（' + fmt(b.since) + 'から。' + fmt(b.at) + 'に確かめました）'
      : b.state === 'missing' ? 'ありません（WorkerのsecretのDISCORD_BOT_TOKEN）'
        : 'まだ確かめていません（見回りが毎時確かめます）';
  const lastText = !last ? '—'
    : fmt(last.at) + '・' + last.kind + '・' + (last.failed ? '届いた' + last.sent + '人、届かなかった' + last.failed + '人（' + last.error + '）' : last.sent + '人に届きました');
  return (
    <div className="card" id="opNotice">
      <h3><Icon name="notifications" size="sm" />運営者への知らせ（DiscordのDM）</h3>
      <p className={stateCls(n.on && n.operators ? 'ok' : 'warn')}>
        {!n.on ? '止めています' : !n.operators ? '送る相手がいません（WorkerのsecretのOPERATOR_IDSに、運営者のDiscordのユーザーIDを書きます）' : '運営者' + n.operators + '人に送ります'}
      </p>
      <p className="hint">YokiのBotから、新しいバージョンが出たとき（毎日10時台に見ます）・知らせの見回りが3回続けて失敗したとき・Botのトークンが使えなかったあとで直ったときに、DMを送ります。DMが届くのは、Botと同じDiscordサーバーにいて、サーバーのメンバーからのDMを許している人だけです。</p>
      <dl className={dl}>
        <dt className={dt}>Botのトークン</dt><dd className={dd} id="opBotState">{bot}</dd>
        <dt className={dt}>最後の知らせ</dt><dd className={dd} id="opNoticeLast">{lastText}</dd>
        <dt className={dt}>最後に知らせたバージョン</dt><dd className={dd}>{n.version ? 'v' + n.version : '—'}</dd>
      </dl>
      <div className="btns">
        <button type="button" className="btn small" id="opNoticeToggle" data-on={n.on ? '0' : '1'} onClick={() => { void act('/api/admin/operator-notice', { on: !n.on }); }}>{n.on ? '知らせを止める' : '知らせを送る'}</button>
        <button type="button" className="btn small" id="opNoticeTest" onClick={() => { void act('/api/admin/operator-notice/test', {}); }}>自分に試しに送る</button>
      </div>
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
