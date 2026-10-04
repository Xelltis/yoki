// 読み込み中の骨組みと、読めなかったとき・グループが消えたときの案内（#loading。e2e が「見つかりません」の文を見る）
import { Icon } from '../../../ui/Icon';
import type { ConsoleSync, SyncView } from '../api/sync';

export function Loading({ view, sync }: { view: SyncView; sync: ConsoleSync }) {
  if (view.phase === 'boot' || view.phase === 'ready') {
    return (
      <div id="loading" role="status" aria-label="読み込み中">
        <div className="skel-frame" aria-hidden="true">
          <div>
            <div className="skel-bar"><span className="skel" style={{ width: '40%' }} /><span className="skel" style={{ width: '20%', marginLeft: 'auto' }} /></div>
            <div className="skel-grid">{Array.from({ length: 28 }, (_, i) => <i className="skel" key={i} />)}</div>
          </div>
          <div className="skel-side"><span className="skel" /><span className="skel" /></div>
        </div>
      </div>
    );
  }
  return (
    <div id="loading" role="status" aria-label="読み込み中">
      <div className="msg">
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
