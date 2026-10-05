// カレンダーのタブ: 左にカレンダー、右に選んだ日の内訳と卓予定。上に、はじめの 3 ステップ
import { store, reducedMotion } from '../../../app/storage';
import { Icon } from '../../../ui/Icon';
import type { IconName } from '../../../ui/icons';
import { useStore } from '../../../ui/store';
import { openForm } from '../actions';
import { useConsole, useData } from '../context';
import { fmtJa, parseYmd } from '../model/dates';
import { active } from '../model/model';
import { useGoTab } from '../shell/nav';
import { DayDetail } from './DayDetail';
import { MonthGrid } from './MonthGrid';
import { Notices } from './Notices';
import { SetupGuide } from './SetupGuide';

/** 色の見本 */
const sw = 'inline-flex items-center gap-6';
const swatch = 'h-14 w-14 rounded-[4px] border border-line-strong max-sm:h-12 max-sm:w-12 ';

/** 「募集を始める」「日程調整を始める」。スマホでは、カレンダーが上に見えるように低くする */
const secondaryNew = 'btn xl max-sm:min-h-38 max-sm:flex-auto max-sm:px-12 max-sm:text-13 max-sm:shadow-none max-sm:[&_.material-icons]:text-18';

/** カレンダーの下のアイコンの読み方。[アイコン, 名前, 付ける印] */
const CAL_LEGEND: [IconName, string, string?][] = [['play_circle', '今日の卓'], ['campaign', '募集'], ['edit_calendar', '調整期間'], ['how_to_vote', '候補日', 'cand'], ['task_alt', '終了'], ['block', '中止'], ['sticky_note_2', 'メモ']];

/** 狭い画面では内訳がカレンダーの下に出る。画面の下のほうに隠れていたら、見える位置まで送る */
function revealDay(): void {
  if (!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
  const el = document.getElementById('dayDetail'); if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight * 0.55) return;
  el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export function CalendarTab() {
  const d = useData();
  const { ui } = useConsole();
  const u = useStore(ui);
  const goTab = useGoTab();
  const t = parseYmd(d.today);
  const view = u.view.y ? u.view : { y: t.getFullYear(), m: t.getMonth() };
  const targets = ['全員', ...active(d).map((s) => s.name), '（なし）'];
  const target = targets.indexOf(u.target) >= 0 ? u.target : '全員';
  const sel = u.selDay ? parseYmd(u.selDay) : null;
  const shift = (n: number) => ui.set((s) => {
    let { y, m } = s.view.y ? s.view : view;
    m += n;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    return { ...s, view: { y, m } };
  });
  const selectDay = (k: string) => { const p = parseYmd(k); ui.set((s) => ({ ...s, selDay: k, view: { y: p.getFullYear(), m: p.getMonth() } })); };
  const setTarget = (v: string) => { store('target', v); ui.set((s) => ({ ...s, target: v })); };
  return (
    <section id="tab-cal">
      <SetupGuide d={d} />
      {/* 左にカレンダー、右に内訳と卓予定。狭い画面では縦に並べる */}
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(300px,3fr)] items-start gap-20 max-lg:grid-cols-[minmax(0,1fr)]">
        <div>
          <div className="mb-12 flex flex-wrap items-center gap-x-12 gap-y-10">
            <div className="flex items-center gap-6 max-sm:w-full">
              <button type="button" id="prev" className="btn icon" aria-label="前の月" onClick={() => shift(-1)}><Icon name="chevron_left" /></button>
              <h1 className="m-0 min-w-[6.6em] text-center text-20 font-bold tabular-nums max-sm:min-w-0 max-sm:flex-1 max-sm:text-18" id="monthLabel">{view.y + '年' + (view.m + 1) + '月'}</h1>
              <button type="button" id="next" className="btn icon" aria-label="次の月" onClick={() => shift(1)}><Icon name="chevron_right" /></button>
              <button type="button" id="todayBtn" className="btn" onClick={() => ui.set((s) => ({ ...s, view: { y: t.getFullYear(), m: t.getMonth() } }))}><Icon name="today" size="sm" />今月</button>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-8 max-sm:ml-0 max-sm:w-full">
              <label className="flex items-center gap-8 text-13 text-muted max-sm:min-w-0 max-sm:flex-1">都合を見る卓 <select className={'max-sm:min-w-0 max-sm:flex-1' + (target !== '全員' ? ' border-accent bg-accent-soft font-semibold text-accent-text' : '')} id="target" value={target} onChange={(ev) => setTarget(ev.target.value)}>{targets.map((n) => <option value={n} key={n}>{n}</option>)}</select></label>
            </div>
            {/* 卓を登録・募集を始める・日程調整を始める。月と「都合を見る卓」の下に 1 段で並べる。スマホでは「卓を登録」を右下の丸いボタンにする */}
            <div className="flex basis-full flex-wrap gap-8 max-sm:w-full">
              <button type="button" id="newSession" className={'btn primary xl max-sm:fixed max-sm:right-[max(16px,env(safe-area-inset-right))] max-sm:bottom-[calc(var(--nav-h)+16px+env(safe-area-inset-bottom))] '
                + 'max-sm:z-(--z-fab) max-sm:min-h-56 max-sm:rounded-xl max-sm:pr-20 max-sm:pl-16 max-sm:text-15 max-sm:shadow-pop'} title={sel ? fmtJa(u.selDay) + ' の卓を登録します' : 'カレンダーで日を選んでから押すと、その日の卓になります。日付の無い卓（募集・調整中）もここから登録できます'}
                onClick={() => openForm(ui, { date: u.selDay || undefined })}>
                <Icon name="add" /><span id="newSessionLbl">{sel ? (sel.getMonth() + 1) + '/' + sel.getDate() + ' に卓を登録' : '卓を登録'}</span>
              </button>
              <button type="button" id="newRecruit" className={secondaryNew} title="状態を「募集」にした登録の窓を開きます" onClick={() => openForm(ui, { status: '募集' })}><Icon name="campaign" />募集を始める</button>
              <button type="button" id="newAdjust" className={secondaryNew} title="状態を「調整中」にした登録の窓を開きます" onClick={() => openForm(ui, { status: '調整中' })}><Icon name="edit_calendar" />日程調整を始める</button>
            </div>
          </div>
          {/* マスの色とアイコンの読み方。狭い画面では、アイコンの読み方を畳む */}
          <div className="mb-12 flex flex-wrap items-center gap-x-14 gap-y-6 text-12 text-muted max-sm:mb-10 max-sm:gap-x-10 max-sm:text-11">
            <span className={sw}><i className={swatch + 'bg-ok'} />全員空き</span><span className={sw}><i className={swatch + 'bg-soft'} />△あり</span>
            <span className={sw}><i className={swatch + 'bg-session'} />卓あり</span><span className={sw}><i className={swatch + 'bg-past'} />終わった卓</span>
            <span className={sw}><i className="inline-grid h-16 min-w-16 place-items-center rounded-full bg-accent-strong px-3 text-10 font-bold text-accent-ink not-italic max-sm:h-14 max-sm:min-w-14">{t.getDate()}</i>今日</span>
            <div className="contents sm:flex sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-2 sm:border-l sm:border-line sm:pl-14" id="iconLegend">
              <details className="group basis-full sm:hidden">
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                  <Icon name="chevron_right" size="xs" className="transition-transform duration-(--dur-fast) group-open:rotate-90" />アイコンの見方
                </summary>
                <div className="mt-4 flex flex-wrap gap-x-10 gap-y-2">{CAL_LEGEND.map(([icon, name, cls]) => <span className="inline-flex items-center gap-2 whitespace-nowrap" key={icon}><Icon name={icon} size="xs" className={cls ? 'text-accent-text' : undefined} />{name}</span>)}</div>
              </details>
              {CAL_LEGEND.map(([icon, name, cls]) => <span className="inline-flex items-center gap-2 whitespace-nowrap max-sm:hidden" key={icon}><Icon name={icon} size="xs" className={cls ? 'text-accent-text' : undefined} />{name}</span>)}
            </div>
            <span className="hint basis-full lg:hidden">日をタップすると、その日の内訳がカレンダーの下に出ます</span>
          </div>
          <MonthGrid d={d} view={view} target={target} selDay={u.selDay} onShift={shift}
            onPick={(key) => {
              const next = u.selDay === key ? '' : key;
              ui.set((s) => ({ ...s, selDay: next }));
              if (next) requestAnimationFrame(revealDay);
            }} />
        </div>
        <div className="sticky top-[calc(var(--appbar-h)+16px)] flex flex-col gap-16 max-lg:static">
          <DayDetail d={d} target={target} key={u.selDay} />
          <div className="card mb-0">
            <h3>卓予定</h3>
            <Notices d={d} onTab={goTab} onTarget={(n) => ui.set((s) => ({ ...s, target: n }))} onDay={(k) => { selectDay(k); requestAnimationFrame(revealDay); }} />
          </div>
        </div>
      </div>
    </section>
  );
}
