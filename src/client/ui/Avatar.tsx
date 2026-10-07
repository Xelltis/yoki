// ログインした人のDiscordのアイコン（入口の右上と、グループの画面の上の帯）。アイコンを決めていない人には、Discordと同じ既定のアイコンを出す。
// 読み込めないとき（手元で外につながらないときなど）は、名前の頭の1文字を出す
import { useState } from 'react';

export type AvatarUser = { id: string; name: string; avatar: string | null };

/** DiscordのアイコンのURL。決めていなければ既定のアイコン（IDから6つのどれか。Discordと同じ選び方） */
export function avatarUrl(user: AvatarUser, size = 64): string {
  if (user.avatar) return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=' + size;
  let n = 0;
  try {
    n = Number((BigInt(user.id) >> 22n) % 6n);
  } catch {
    // 数字でないIDは、いちばん目の既定のアイコン
  }
  return 'https://cdn.discordapp.com/embed/avatars/' + n + '.png';
}

/** className には大きさ（h-30 w-30 など）を渡す。飾りなので読み上げない（名前は横か、ボタンの名前で伝える） */
export function Avatar({ user, className }: { user: AvatarUser; className: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return <span className={className + ' grid flex-none place-items-center rounded-full bg-linear-135 from-orange to-pink text-13 font-bold text-white'} aria-hidden="true">{user.name.slice(0, 1)}</span>;
  }
  return <img className={className + ' flex-none rounded-full'} src={avatarUrl(user)} alt="" onError={() => setBroken(true)} />;
}
