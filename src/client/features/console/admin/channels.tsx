// 知らせのチャンネル（管理画面の「知らせ」）。Bot がサーバーにいるかと、送り先に選べるチャンネルの一覧を、
// サーバー（getDiscordChannels）から読む。Discord に問い合わせるので、区分を開いたときと「読み直す」のときだけ読む
import type { ConsoleData, DiscordChannelsResult } from '../../../../shared/api';
import { createStore, useStore } from '../../../ui/store';
import type { ConsoleSync } from '../api/sync';
import { useConsole } from '../context';

/** 読んだ一覧（まだ読んでいなければ null）。group はどのグループの一覧か */
type ChannelState = { group: string; list: DiscordChannelsResult | null; loading: boolean; failed: string };
const EMPTY = { list: null, loading: false, failed: '' };
const channelStore = createStore<ChannelState>({ group: '', ...EMPTY });

/** いまのグループの一覧（ほかのグループの一覧は見せない） */
export function useChannels(): ChannelState {
  const { sync } = useConsole();
  const s = useStore(channelStore);
  return s.group === sync.groupId ? s : { group: sync.groupId, ...EMPTY };
}

/** Bot とチャンネルの一覧を読む。Bot が設定されていなければ読まない */
export function loadChannels(sync: ConsoleSync): void {
  const d = sync.data(), group = sync.groupId, cur = channelStore.get();
  if (!d || !d.bot.ready || (cur.group === group && cur.loading)) return;
  channelStore.set({ ...(cur.group === group ? cur : EMPTY), group, loading: true, failed: '' });
  // 読んでいるあいだにほかのグループへ移ったら、返事は捨てる
  const done = (s: Partial<ChannelState>) => { if (channelStore.get().group === group) channelStore.set({ ...channelStore.get(), ...s, loading: false }); };
  sync.call<DiscordChannelsResult>('getDiscordChannels').then((r) => done({ list: r }), (e: Error) => done({ failed: e.message }));
}
/** まだ読んでいなければ読む（「知らせ」の区分を開いたとき） */
export function ensureChannels(sync: ConsoleSync): void {
  const s = channelStore.get();
  if (s.group !== sync.groupId || (!s.list && !s.failed)) loadChannels(sync);
}

/** チャンネルの名前（「#卓の知らせ」）。一覧に無ければ ID のまま。空なら空 */
export function channelLabel(list: DiscordChannelsResult | null, id: string): string {
  if (!id) return '';
  const c = list && list.channels.filter((x) => x.id === id)[0];
  return '#' + (c ? c.name : id);
}

/** チャンネルを選べるか（Bot がサーバーにいて、一覧を読めた） */
export function canPick(s: ChannelState): boolean { return !!(s.list && s.list.inGuild); }

/** Bot の様子の文。読めないときや、Bot がサーバーにいないときは bad */
export function botStateText(d: ConsoleData, s: ChannelState): { text: string; bad: boolean } {
  const { list, loading, failed } = s;
  const text = !d.bot.ready ? '卓予定を公開している運営者が、Bot をまだ設定していません。Discord への知らせは送れません。'
    : loading ? 'Bot とチャンネルの一覧を読んでいます…'
      : failed ? 'チャンネルの一覧を読めませんでした: ' + failed
        : !list ? '「読み直す」を押すと、Bot がサーバーにいるかと、チャンネルの一覧を確かめます。'
          : !list.inGuild ? 'Bot がまだこのサーバーにいません。「Bot をサーバーに招く」から招いて、「読み直す」を押してください。'
            : 'Bot はサーバーにいます。送り先に選べるチャンネルは ' + list.channels.length + ' 個です。';
  return { text, bad: !d.bot.ready || !!failed || !!(list && !list.inGuild) };
}

/**
 * チャンネルを選ぶ欄。頭に empty（「基本のチャンネルと同じ」など）を置き、カテゴリーごとに並べる。
 * 一覧に無いいまの設定は「（いまの設定）」として残す。一覧が無い（Bot がいない・まだ読んでいない）ときは選べない。
 * value は選んでいる値（選びかけか、いまの設定）
 */
export function ChannelSelect({ id, value, empty, onChange }: { id: string; value: string; empty: string; onChange: (v: string) => void }) {
  const st = useChannels();
  const chans = st.list ? st.list.channels : [];
  const groups: { category: string; items: typeof chans }[] = [];
  chans.forEach((c) => {
    const last = groups[groups.length - 1];
    if (last && last.category === c.category) last.items.push(c); else groups.push({ category: c.category, items: [c] });
  });
  return (
    <select id={id} value={value} disabled={!canPick(st)} onChange={(ev) => onChange(ev.target.value)}>
      <option value="">{empty}</option>
      {groups.map((g, i) => (
        <optgroup label={g.category || 'カテゴリーなし'} key={i}>
          {g.items.map((c) => <option value={c.id} key={c.id}>{'#' + c.name}</option>)}
        </optgroup>
      ))}
      {value && !chans.some((c) => c.id === value) && <option value={value}>{channelLabel(st.list, value) + '（いまの設定）'}</option>}
    </select>
  );
}
