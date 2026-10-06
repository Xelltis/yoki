// グループの頭文字の札（入口のグループの一覧と、上の帯のグループの切り替え）。Discordのアイコンの無いサーバーのように頭文字を出す
/** 札の色。一覧の並びの順にくり返す（入口と上の帯で同じ順に並べるので、同じグループは同じ色になる） */
const TILE = ['bg-brand', 'bg-orange', 'bg-pink', 'bg-brand-light'];

export function GroupTile({ title, index, size = 'lg' }: { title: string; index: number; size?: 'lg' | 'sm' }) {
  const box = size === 'lg' ? 'h-44 w-44 rounded-[12px] text-18' : 'h-28 w-28 rounded-[8px] text-13';
  return <span className={'grid flex-none place-items-center font-bold text-white ' + box + ' ' + TILE[index % TILE.length]} aria-hidden="true">{title.slice(0, 1)}</span>;
}
