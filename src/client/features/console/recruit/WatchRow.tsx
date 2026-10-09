// 開催・調整中の卓の見学（参加はしないが見る人。定員にも参加者にも数えない）。卓のGMと参加者でなければ、自分で付け外しできる
import type { ConsoleSession, RpcResult } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { me, peopleOf } from '../model/model';
import { withSession } from '../model/optimistic';

export function WatchRow({ s }: { s: ConsoleSession }) {
  const d = useData();
  const { sync } = useConsole();
  const mine = me(d);
  // これから開く卓と、調整中の卓だけ
  const open = s.status === '調整中' || (s.status === '開催' && !!s.date && s.date >= d.today);
  const watching = s.watch.indexOf(mine) >= 0, canWatch = open && !!mine && peopleOf(s).indexOf(mine) < 0 && s.want.indexOf(mine) < 0;
  if (!s.watch.length && !canWatch) return null;
  const set = (on: boolean) => {
    sync.write<RpcResult>('setInterest', { id: s.id, name: mine, level: on ? 'watch' : 'none' }, {
      optimistic: (cur) => withSession(cur, s.id, (x) => ({ ...x, watch: x.watch.filter((n) => n !== mine).concat(on ? [mine] : []) })),
    }).then((r) => toast(r.message), (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 text-13" data-watch-of={s.id}>
      <b className="font-semibold text-muted">見学</b>
      <span>{s.watch.length ? s.watch.join('、') : <span className="hint">まだいません</span>}</span>
      {canWatch && (
        <button type="button" className={'btn small' + (watching ? ' on' : '')} data-watch={s.id} aria-pressed={watching} onClick={() => set(!watching)}>
          <Icon name="visibility" size="sm" />{watching ? '見学をやめる' : '見学する'}
        </button>
      )}
    </div>
  );
}
