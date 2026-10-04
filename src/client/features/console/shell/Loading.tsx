// 読み込み中の骨組みと、読めなかったとき・グループが消えたときの案内（#loading。e2e が「見つかりません」の文を見る）
import { Icon } from '../../../ui/Icon';
import type { ConsoleSync, SyncView } from '../api/sync';

/** 骨組みの 1 本（明るさが行き来する） */
const skelBase = 'block bg-head animate-pulse motion-reduce:animate-none';
const skel = skelBase + ' rounded-sm';

export function Loading({ view, sync }: { view: SyncView; sync: ConsoleSync }) {
  if (view.phase === 'boot' || view.phase === 'ready') {
    return (
      <div className="py-8 text-muted" id="loading" role="status" aria-label="読み込み中">
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-20 max-lg:grid-cols-[minmax(0,1fr)]" aria-hidden="true">
          <div>
            <div className="mb-12 flex gap-8"><span className={skel + ' h-36 w-2/5'} /><span className={skel + ' ml-auto h-36 w-1/5'} /></div>
            <div className="grid grid-cols-7 gap-4">{Array.from({ length: 28 }, (_, i) => <i className={skel + ' h-96 max-sm:h-60'} key={i} />)}</div>
          </div>
          <div className="max-lg:hidden"><span className={skelBase + ' mb-12 h-120 rounded-lg'} /><span className={skelBase + ' mb-12 h-120 rounded-lg'} /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="py-8 text-muted" id="loading" role="status" aria-label="読み込み中">
      <div className="py-48 text-center">
        <p>{view.message}</p>
        {view.phase === 'error' && (
          <button type="button" className="btn primary" id="loadRetry" onClick={() => { sync.view.set((v) => ({ ...v, phase: 'boot' })); void sync.refresh('boot'); }}>
            <Icon name="refresh" size="sm" />もう一度読み込む
          </button>
        )}
        {view.phase === 'gone' && <a className="btn primary" href="/">入口へ</a>}
      </div>
    </div>
  );
}
