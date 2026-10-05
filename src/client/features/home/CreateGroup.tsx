// グループを作る（POST /api/groups）。作れたら、そのグループの画面へ移る
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { CreateGroupResult, MeResponse } from '../../../shared/api';
import { Icon } from '../../ui/Icon';
import { btnPrimary, card, field, h2, hint, label, row } from './styles';

type Creatable = Extract<MeResponse, { loggedIn: true }>['creatable'];

async function createGroup(body: { guildId: string; title: string }): Promise<CreateGroupResult> {
  let res: Response, data: CreateGroupResult & { error?: string };
  try {
    res = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    data = await res.json();
  } catch {
    throw new Error('通信できませんでした。');
  }
  if (!res.ok) throw new Error(data.error || '作れませんでした。');
  return data;
}

export function CreateGroup({ creatable, closed }: { creatable: Creatable; closed: boolean }) {
  const [guildId, setGuildId] = useState(creatable[0]!.guildId);
  const [title, setTitle] = useState('');
  const create = useMutation({ mutationFn: createGroup, onSuccess: (r) => { location.href = r.url; } });
  const msg = create.isPending ? '作っています…' : create.isError ? create.error.message : '';
  return (
    <section className={card} id="create">
      <h2 className={h2}>
        <Icon name="add" />
        グループを作る
      </h2>
      <p className={hint + ' mt-0'}>グループは Discord サーバーに結びつきます。入れるのは、そのサーバーにいる人だけです。作れるのは、サーバーのオーナーか、サーバー管理の権限がある人です。作った人が最初の管理者になります。</p>
      {closed ? (
        <p className={hint} id="createClosed">今は新しいグループの受付を止めています。</p>
      ) : (
        <form id="createForm" onSubmit={(ev) => { ev.preventDefault(); create.mutate({ guildId, title }); }}>
          <div className={row}>
            <label className={label}>
              Discord サーバー
              <select className={field} id="cGuild" required value={guildId} onChange={(ev) => setGuildId(ev.target.value)}>
                {creatable.map((g) => <option key={g.guildId} value={g.guildId}>{g.name}</option>)}
              </select>
            </label>
            <label className={label}>
              <span>グループの名前 <small className="ml-4 font-normal text-muted">空ならサーバーの名前</small></span>
              <input type="text" className={field} id="cTitle" maxLength={80} value={title} onChange={(ev) => setTitle(ev.target.value)} />
            </label>
          </div>
          {/* 作れたら画面を移るので、押せないままにする */}
          <button className={btnPrimary} type="submit" id="cOk" disabled={create.isPending || create.isSuccess}>
            <Icon name="add" className="align-[0]" />
            作る
          </button>
          <span className="ml-10 text-13 text-muted" id="cMsg">{msg}</span>
        </form>
      )}
    </section>
  );
}
