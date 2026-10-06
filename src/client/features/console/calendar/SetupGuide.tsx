// はじめの 3 ステップ。仲間が入って卓ができるまで、カレンダーの上に出す。閉じたら次からも出さない（ヘルプのメニューから、いつでも出し直せる）。
// 1. 仲間を招く（URL を Discord に貼る） 2. 卓を登録する 3. Discord に知らせる（無くても使えるので「任意」。管理者がする）
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { openForm } from '../actions';
import { useConsole } from '../context';
import { isActive } from '../model/model';
import { closeGuide, guideShown, useGoPane } from '../shell/nav';

type StepState = 'done' | 'now' | '';

function Step({ n, state, title, optional = false, text, children }: { n: number; state: StepState; title: string; optional?: boolean; text: string; children: ReactNode }) {
  // 番号の丸。いまの段は青、済んだ段は緑
  const num = state === 'now' ? 'bg-accent-strong text-accent-ink' : state === 'done' ? 'bg-ok text-ok-text' : 'bg-head text-muted';
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-10" data-step={n} data-state={state || 'later'}>
      <span className={'inline-flex h-30 w-30 items-center justify-center rounded-[50%] text-14 font-bold ' + num}>{state === 'done' ? <Icon name="check" size="sm" /> : n}</span>
      <div>
        <b className="text-15">{title}</b>
        {optional && <span className="ml-6 inline-block rounded-full border border-line px-6 text-11 leading-[18px] font-semibold text-muted align-[1px]">任意</span>}
        <p className="hint mt-2 mb-8">{text}</p>
        {children}
      </div>
    </li>
  );
}

/** グループの URL を写す。写せない端末では、URL を吹き出しに出す */
function copyUrl(url: string): void {
  void navigator.clipboard.writeText(url).then(
    () => toast('グループの URL を写しました。Discord のチャンネルに貼ってください'),
    () => toast('写せませんでした。この URL を貼ってください: ' + url),
  );
}

export function SetupGuide({ d }: { d: ConsoleData }) {
  const { ui, groupId } = useConsole();
  const { guide, guideFocus, selDay } = useStore(ui);
  const goPane = useGoPane();
  const ref = useRef<HTMLDivElement>(null);
  // 上の帯のボタンで出し直したら、ここへフォーカスを移す
  useEffect(() => { if (guideFocus) ref.current?.focus({ preventScroll: true }); }, [guideFocus]);
  if (!guideShown(d, guide)) return <div className="card border-accent-line" id="setupGuide" hidden />;
  const others = d.members.length - 1, nActive = d.sessions.filter(isActive).length, hasDiscord = !!d.channelSet;
  // いまの段は、まだ済んでいない最初の段だけ
  const done = [others > 0, nActive > 0, hasDiscord];
  const now = done.indexOf(false);
  const state = (i: number): StepState => (done[i] ? 'done' : i === now ? 'now' : '');
  return (
    <div className="card border-accent-line" id="setupGuide" ref={ref} tabIndex={guideFocus ? -1 : undefined}>
      <h3 className="flex items-center gap-6">
        <Icon name="flag" size="sm" />はじめの 3 ステップ
        <button type="button" className="btn icon ml-auto" data-go="close" aria-label="はじめの 3 ステップを閉じる" title="閉じる（ヘルプのメニューから、また出せます）" onClick={() => closeGuide(ui, groupId)}><Icon name="close" /></button>
      </h3>
      <ol className="m-0 grid list-none grid-cols-3 gap-x-24 gap-y-16 p-0 max-md:grid-cols-[minmax(0,1fr)]">
        <Step n={1} state={state(0)} title="仲間を招く" text="グループの URL を、Discord サーバーのチャンネルに貼ります。開いてログインした人は、自動でメンバーになります（入れるのは、サーバーにいる人だけ）。">
          {others > 0 && <span className="hint mr-6">{'あなたのほかに ' + others + ' 人がいます'}</span>}
          <div className="btns mt-2 gap-6">
            <button type="button" className={'btn ' + (others > 0 ? 'small' : 'primary')} data-go="copy" onClick={() => copyUrl(d.appUrl)}><Icon name="link" size="sm" />URL を写す</button>
            {d.isAdmin && <button type="button" className="btn small" data-go="members" title="まだ開いていない人を、名前と Discord の ID で先に足す" onClick={() => goPane('members')}>メンバーを先に足す</button>}
          </div>
        </Step>
        <Step n={2} state={state(1)} title="卓を登録する" text="カレンダーで日を選んで「卓を登録」を押します。日が決まっていなければ、「募集を始める」か「日程調整を始める」から。">
          {nActive > 0 && <span className="hint mr-6">{nActive + ' 件の卓があります'}</span>}
          <button type="button" className={'btn mt-2 ' + (nActive > 0 ? 'small' : now === 1 ? 'primary' : '')} data-go="new" onClick={() => openForm(ui, { date: selDay || undefined })}><Icon name="add" size="sm" />卓を登録</button>
        </Step>
        <Step n={3} state={state(2)} title="Discord に知らせる" optional text="卓予定の Bot を Discord サーバーに招き、知らせのチャンネルを選ぶと、卓の案内と開催前の知らせが届きます。無くても使えます。">
          {hasDiscord && <span className="hint mr-6">設定してあります</span>}
          {d.isAdmin
            ? <button type="button" className={'btn mt-2 ' + (hasDiscord ? 'small' : now === 2 ? 'primary' : '')} data-go="discord" onClick={() => goPane('notify')}><Icon name="notifications" size="sm" />{hasDiscord ? '開く' : 'Discord を設定'}</button>
            : !hasDiscord && <span className="hint">管理者が、管理画面の「知らせ」で設定します</span>}
        </Step>
      </ol>
    </div>
  );
}
