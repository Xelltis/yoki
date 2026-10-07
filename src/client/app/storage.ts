// この端末に控える（localStorage。キーの頭にtaku. を付ける。使えない端末では何もしない）

export function store(k: string, v: string): void {
  try { localStorage.setItem('taku.' + k, v); } catch { /* 使えない端末 */ }
}

export function load(k: string): string {
  try { return localStorage.getItem('taku.' + k) || ''; } catch { return ''; }
}

export function reducedMotion(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** ログアウトしても残す、この端末の好み（見た目・文字の大きさ・自動更新の間隔・折りたたみ・並べ方） */
const DEVICE_KEYS = ['theme', 'font', 'autoRefresh', 'sortByLoad'];
const DEVICE_PREFIXES = ['fold.'];

/**
 * ログアウトの前に、この端末の控えのうち人に結びつくもの（グループのデータ・開いていたタブ・絞り込みなど）を、どのグループのものも消す。
 * 共用の端末で、次の人に前の人のグループの中身が残らないように
 */
export function forgetPerson(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('taku.')) continue;
      const name = k.slice('taku.'.length);
      if (DEVICE_KEYS.includes(name) || DEVICE_PREFIXES.some((p) => name.startsWith(p))) continue;
      localStorage.removeItem(k);
    }
    sessionStorage.removeItem('taku.relogin');
  } catch { /* 使えない端末 */ }
}

/** 前に見ていたタブを、グループごとに控えるキー（グループを開いたら、そのタブへ移る。router.tsx） */
export const lastTabKey = (groupId: string) => 'tab:' + groupId;
