// この端末に控える（localStorage。キーの頭に taku. を付ける。使えない端末では何もしない）

export function store(k: string, v: string): void {
  try { localStorage.setItem('taku.' + k, v); } catch { /* 使えない端末 */ }
}

export function load(k: string): string {
  try { return localStorage.getItem('taku.' + k) || ''; } catch { return ''; }
}

export function reducedMotion(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** 前に見ていたタブを、グループごとに控えるキー（グループを開いたら、そのタブへ移る。router.tsx） */
export const lastTabKey = (groupId: string) => 'tab:' + groupId;
