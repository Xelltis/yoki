// 知らせのチャンネル（管理画面の「知らせ」）。Bot がサーバーにいるかと、送り先に選べるチャンネルの一覧を、
// サーバー（getDiscordChannels）から読む。Discord に問い合わせるので、区分を開いたときと「読み直す」のときだけ読む
import type { DiscordChannelsResult } from '../../shared/api';
import { api } from './api';
import { $, esc } from './dom';
import { fillSeriesChannel } from './series-notify';
import { D } from './state';

/** 読んだ一覧（まだ読んでいなければ null） */
let list: DiscordChannelsResult | null = null;
let loading = false;
let failed = '';

/** チャンネルの名前（「#卓の知らせ」）。一覧に無ければ ID のまま。空なら空 */
export function channelLabel(id: string): string {
  if (!id) return '';
  const c = list && list.channels.filter((x) => x.id === id)[0];
  return '#' + (c ? c.name : id);
}

/**
 * チャンネルの選択を作り直す。頭に empty（「基本のチャンネルと同じ」など）を置き、カテゴリーごとに並べる。
 * 選びかけ（data-dirty）は、読み直しても消さない。一覧に無いいまの設定は「（いまの設定）」として残す
 */
export function fillChannelSelect(id: string, current: string, empty: string): void {
  const sel = $<HTMLSelectElement>(id);
  const keep = sel.dataset.dirty ? sel.value : current;
  const chans = list ? list.channels : [];
  let h = '<option value="">' + esc(empty) + '</option>', cat: string | null = null;
  chans.forEach((c) => {
    if (c.category !== cat) { h += (cat !== null ? '</optgroup>' : '') + '<optgroup label="' + esc(c.category || 'カテゴリーなし') + '">'; cat = c.category; }
    h += '<option value="' + esc(c.id) + '">#' + esc(c.name) + '</option>';
  });
  if (cat !== null) h += '</optgroup>';
  if (keep && !chans.some((c) => c.id === keep)) h += '<option value="' + esc(keep) + '">' + esc(channelLabel(keep)) + '（いまの設定）</option>';
  sel.innerHTML = h;
  sel.value = keep;
  // 一覧が無い（Bot がいない・まだ読んでいない）ときは、選べない
  sel.disabled = !(list && list.inGuild);
}

/** 選んだら「選びかけ」にする（読み直しで消さないため）。保存のときに外す */
export function markDirty(id: string, on: boolean): void {
  const sel = $(id);
  if (on) sel.dataset.dirty = '1'; else delete sel.dataset.dirty;
}

function renderBotState(): void {
  const inv = $<HTMLAnchorElement>('botInvite');
  inv.hidden = !D.bot.inviteUrl;
  inv.href = D.bot.inviteUrl || '#';
  $('botReload').disabled = loading || !D.bot.ready;
  const state = !D.bot.ready ? '卓予定を公開している運営者が、Bot をまだ設定していません。Discord への知らせは送れません。'
    : loading ? 'Bot とチャンネルの一覧を読んでいます…'
      : failed ? 'チャンネルの一覧を読めませんでした: ' + failed
        : !list ? '「読み直す」を押すと、Bot がサーバーにいるかと、チャンネルの一覧を確かめます。'
          : !list.inGuild ? 'Bot がまだこのサーバーにいません。「Bot をサーバーに招く」から招いて、「読み直す」を押してください。'
            : 'Bot はサーバーにいます。送り先に選べるチャンネルは ' + list.channels.length + ' 個です。';
  $('botState').textContent = state;
  $('botState').classList.toggle('bad', !D.bot.ready || !!failed || !!(list && !list.inGuild));
}

/** Bot の状態と、チャンネルの選択を描き直す（画面のデータが変わったときと、一覧を読んだとき） */
export function renderChannels(): void {
  renderBotState();
  const st = D.settings;
  fillChannelSelect('stChannel', st.channelId, '（選んでいません）');
  fillChannelSelect('kwRemind', st.remindChannelId, '基本のチャンネルと同じ');
  fillChannelSelect('kwRecruit', st.recruitChannelId, '基本のチャンネルと同じ');
  // チャンネルを選べないあいだは、保存も押せない（シリーズの保存は日時も保存するので、そのまま）
  ['stChannel', 'kwRemind', 'kwRecruit'].forEach((id) => { $(id + 'Save').disabled = $(id).disabled; });
  fillSeriesChannel();
}

/** Bot とチャンネルの一覧を読む。Bot が設定されていなければ読まない */
export function loadChannels(): void {
  if (!D.bot.ready || loading) { renderBotState(); return; }
  loading = true; failed = '';
  renderBotState();
  api<DiscordChannelsResult>()
    .withSuccessHandler((r) => { loading = false; list = r; renderChannels(); })
    .withFailureHandler((e) => { loading = false; failed = e.message; renderChannels(); })
    .getDiscordChannels();
}

/** まだ読んでいなければ読む（「知らせ」の区分を開いたとき） */
export function ensureChannels(): void {
  if (!list && !failed) loadChannels();
}

export function init(): void {
  $('botReload').onclick = loadChannels;
}
