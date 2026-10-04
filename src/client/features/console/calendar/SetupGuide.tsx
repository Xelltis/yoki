// はじめの 3 ステップ。メンバーと卓がそろうまで、カレンダーの上に出す。「使い方」の隣のボタンで、いつでも出し直せる
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { openForm } from '../actions';
import { useConsole } from '../context';
import { isActive } from '../model/model';
import { guideShown, useGoPane } from '../shell/nav';

function Step({ n, state, title, text, children }: { n: number; state: string; title: string; text: string; children: ReactNode }) {
  return (
    <li className={state}>
      <span className="n">{state === 'done' ? <Icon name="check" size="sm" /> : n}</span>
      <div><b>{title}</b><p className="hint">{text}</p>{children}</div>
    </li>
  );
}

export function SetupGuide({ d }: { d: ConsoleData }) {
  const { ui } = useConsole();
  const { guide, guideFocus, selDay } = useStore(ui);
  const goPane = useGoPane();
  const ref = useRef<HTMLDivElement>(null);
  // 上の帯のボタンで出し直したら、ここへフォーカスを移す
  useEffect(() => { if (guideFocus) ref.current?.focus({ preventScroll: true }); }, [guideFocus]);
  const hasMembers = d.members.length > 0, hasSession = d.sessions.some(isActive), hasDiscord = !!d.channelSet;
  if (!guideShown(d, guide)) return <div className="card setup-card" id="setupGuide" hidden />;
  // メンバーの登録と Discord の設定は、管理者が管理画面でする。管理者でない人には、頼むように出す
  const ask = <span className="hint">管理者に頼んでください</span>;
  const admin = (pane: 'members' | 'notify') => { if (!d.isAdmin) { toast('メンバーの登録と Discord の設定は、管理者が管理画面でします'); return; } goPane(pane); };
  const nActive = d.sessions.filter(isActive).length;
  return (
    <div className="card setup-card" id="setupGuide" ref={ref} tabIndex={guideFocus ? -1 : undefined}>
      <h3>
        <Icon name="flag" size="sm" />はじめの 3 ステップ
        <button type="button" className="btn icon close-guide" data-go="close" aria-label="はじめの 3 ステップを閉じる" onClick={() => ui.set((s) => ({ ...s, guide: 'closed' }))}><Icon name="close" /></button>
      </h3>
      <ol className="setup">
        <Step n={1} state={hasMembers ? 'done' : 'now'} title="メンバーを登録する" text="卓に出る人の名前を入れます。ここで入れた名前が、予定表の列と参加者の候補になります。">
          {hasMembers
            ? <><span className="hint">{d.members.length} 人を登録しています</span>{d.isAdmin && <>{' '}<button type="button" className="btn small" data-go="members" onClick={() => admin('members')}>開く</button></>}</>
            : d.isAdmin ? <button type="button" className="btn primary" data-go="members" onClick={() => admin('members')}><Icon name="person_add" size="sm" />メンバーを登録</button> : ask}
        </Step>
        <Step n={2} state={hasDiscord ? 'done' : hasMembers ? 'now' : ''} title="Discord を登録する" text="管理画面の「知らせ」で卓予定の Bot を Discord サーバーに招き、知らせのチャンネルを選ぶと、卓の案内と開催前の知らせがそのチャンネルに届きます。知らせが要らないなら飛ばせます。">
          {hasDiscord
            ? <><span className="hint">登録してあります</span>{d.isAdmin && <>{' '}<button type="button" className="btn small" data-go="discord" onClick={() => admin('notify')}>開く</button></>}</>
            : d.isAdmin ? <button type="button" className="btn" data-go="discord" onClick={() => admin('notify')}><Icon name="notifications" size="sm" />Discord を登録</button> : ask}
        </Step>
        <Step n={3} state={!hasMembers ? '' : hasSession ? 'done' : 'now'} title="予定を登録する" text="カレンダーで日を選んで「卓を登録」を押します。日が決まっていなければ、状態を「募集」か「調整中」にします。">
          {hasMembers
            ? <>{hasSession && <><span className="hint">{nActive} 件の卓があります</span>{' '}</>}<button type="button" className={'btn ' + (hasSession ? 'small' : 'primary')} data-go="new" onClick={() => openForm(ui, { date: selDay || undefined })}><Icon name="add" size="sm" />卓を登録</button></>
            : <span className="hint">先にメンバーを登録します</span>}
        </Step>
      </ol>
    </div>
  );
}
