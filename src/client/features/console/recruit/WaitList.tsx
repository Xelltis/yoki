// 開催・調整中の卓のキャンセル待ち（並び方はsrc/shared/waitlist.ts）。GMと管理者は「繰り上げる」で参加者にでき、並んでいる本人は「やめる」ができる
import type { ConsoleSession, RpcResult } from '../../../../shared/api';
import { splitWant } from '../../../../shared/waitlist';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { me } from '../model/model';
import { withSession } from '../model/optimistic';

export function WaitList({ s }: { s: ConsoleSession }) {
  const d = useData();
  const { sync } = useConsole();
  const mine = me(d);
  const wait = splitWant(s).wait;
  if (!wait.length || (s.status !== '開催' && s.status !== '調整中')) return null;
  const canPromote = !!mine && (s.gm === mine || d.isAdmin);
  /** 押した瞬間に付け替える。失敗したら読み直す */
  const run = (fn: 'promoteWaiter' | 'setInterest', form: object, change: (x: ConsoleSession) => ConsoleSession) => {
    sync.write<RpcResult>(fn, form, { optimistic: (cur) => withSession(cur, s.id, change) })
      .then((r) => toast(r.message), (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };
  const promote = (name: string) => run('promoteWaiter', { id: s.id, name }, (x) => ({ ...x, members: x.members.concat(name), want: x.want.filter((n) => n !== name) }));
  const leave = () => run('setInterest', { id: s.id, name: mine, level: 'none' }, (x) => ({ ...x, want: x.want.filter((n) => n !== mine) }));
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 text-13" data-wait-of={s.id}>
      <b className="font-semibold text-muted">キャンセル待ち</b>
      {wait.map((n, i) => (
        <span className="inline-flex items-center gap-4" key={n}>
          {i + 1}. {n}
          {canPromote && (
            <button type="button" className="btn small" data-promote={s.id} data-name={n} title={n + 'を参加者にして、Discordで知らせます'} onClick={() => promote(n)}>
              <Icon name="person_add" size="sm" />繰り上げる
            </button>
          )}
          {n === mine && <button type="button" className="btn small" data-leave-wait={s.id} onClick={leave}>やめる</button>}
        </span>
      ))}
    </div>
  );
}
