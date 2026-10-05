// 帯のメニュー。ボタンを押すと、下に項目の一覧が開く。
// 外を押す・Esc・Tab・項目を選ぶと閉じる。開いたら最初の項目へ、Esc で閉じたら開いたボタンへフォーカスを移す。↑↓・Home・End で項目を移る。
// 一覧は描いたまま hidden で開け閉めする（中の項目の ID は、e2e とスクリーンショットの道具が使う）
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { menuPanel } from './chrome';

/** 一覧の中の、いま選べる項目（hidden の項目は飛ばす） */
function items(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((el) => !el.closest('[hidden]'));
}

export function Menu({ id, buttonId, buttonClass, label, title, align = 'end', active, className = 'relative inline-flex', children, button }: {
  /** 一覧の ID */
  id: string;
  /** 開くボタンの ID */
  buttonId: string;
  buttonClass: string;
  /** 開くボタンの読み上げ名 */
  label: string;
  title?: string;
  /** 一覧をボタンのどちらの端にそろえるか */
  align?: 'start' | 'end';
  /** ボタンを押してある見た目にする（メニューの先の画面を開いているとき） */
  active?: boolean;
  /** ボタンと一覧を包む要素のクラス（一覧の位置の基準になるので relative を含める） */
  className?: string;
  /** 一覧の項目。押せるものには role="menuitem" を付ける */
  children: ReactNode;
  /** ボタンの中身 */
  button: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  /* 開いたら最初の項目へ。外を押したら閉じる */
  useEffect(() => {
    if (!open) return;
    if (panel.current) items(panel.current)[0]?.focus({ preventScroll: true });
    const onDown = (ev: PointerEvent) => { if (wrap.current && !wrap.current.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus({ preventScroll: true }); };
  const onPanelKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!panel.current) return;
    const list = items(panel.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => { ev.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (ev.key === 'ArrowDown') move(at + 1);
    else if (ev.key === 'ArrowUp') move(at - 1);
    else if (ev.key === 'Home') move(0);
    else if (ev.key === 'End') move(list.length - 1);
    else if (ev.key === 'Escape') { ev.preventDefault(); close(true); }
    else if (ev.key === 'Tab') close(false);
  };

  return (
    <span className={className} ref={wrap}>
      <button type="button" id={buttonId} ref={btn} className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={label} title={title}
        data-active={active ? '' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(ev) => { if (ev.key === 'ArrowDown' && !open) { ev.preventDefault(); setOpen(true); } }}>
        {button}
      </button>
      {/* 項目を押したら閉じる（項目の動きはそれぞれの onClick・リンクが受け持つ） */}
      <div id={id} ref={panel} role="menu" aria-label={label} hidden={!open} tabIndex={-1}
        className={menuPanel + (align === 'start' ? ' left-0' : ' right-0')}
        onKeyDown={onPanelKey}
        onClick={(ev) => { if ((ev.target as Element).closest('[role="menuitem"]')) close(false); }}>
        {children}
      </div>
    </span>
  );
}
