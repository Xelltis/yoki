// 卓の場所。URLだけなら、押すと新しいタブで開くリンクにする（ボイスチャンネルやオンセのルームのURLを書くことが多いため）
const URL_ONLY = /^https?:\/\/\S+$/;

export function Place({ place, className }: { place: string; className?: string }) {
  const url = URL_ONLY.test(place.trim()) ? place.trim() : '';
  return (
    <div className={className}>
      {'場所: '}
      {url ? <a className="wrap-anywhere" href={url} target="_blank" rel="noopener noreferrer">{url}</a> : place}
    </div>
  );
}
