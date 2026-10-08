<!-- 試せる例: 日程調整に ◯・△・× で答える。全員が答えると、GMに知らせが届く -->
<script setup lang="ts">
import Ms from './Ms.vue';
import { computed, ref } from 'vue';
import { addDays, mdw, useMonday } from './demo';

type Vote = '◯' | '△' | '×';
const VOTERS = ['ダン', 'アリス', 'あなた'];
const first = (): Record<string, Vote>[] => [{ ダン: '◯', アリス: '◯' }, { ダン: '◯', アリス: '△' }, { ダン: '◯', アリス: '×' }];

const monday = useMonday();
const cands = computed(() => [11, 12, 13].map((n) => addDays(monday.value, n)));
const votes = ref(first());
const say = ref('あなたの行の ◯・△・× を押してください。△ は「調整すれば行ける」です。');
const complete = computed(() => votes.value.every((v) => VOTERS.every((n) => !!v[n])));
const rows = computed(() => cands.value.map((d, i) => {
  const v = votes.value[i];
  const ok = VOTERS.filter((n) => v[n] === '◯'), maybe = VOTERS.filter((n) => v[n] === '△'), ng = VOTERS.filter((n) => v[n] === '×'), no = VOTERS.filter((n) => !v[n]);
  return {
    d, i, ok, maybe, my: v['あなた'] ?? '',
    names: [ok.length ? '◯ ' + ok.join('、') : '', maybe.length ? '△ ' + maybe.join('、') : '', ng.length ? '× ' + ng.join('、') : '', no.length ? '未回答' + no.join('、') : ''].filter(Boolean).join('　'),
  };
}));

function vote(i: number, v: Vote) {
  const was = complete.value;
  const row = votes.value[i];
  if (row['あなた'] === v) delete row['あなた'];
  else row['あなた'] = v;
  say.value = complete.value && !was ? 'あなたの回答で全員がそろいました。GMにDiscordで知らせが届きます。'
    : row['あなた'] ? mdw(cands.value[i]) + 'を' + row['あなた'] + 'にしました。' : mdw(cands.value[i]) + 'の回答を取り消しました。';
}
function reset() {
  votes.value = first();
  say.value = '最初の状態に戻しました。';
}
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap try"><Ms name="touch_app" />やってみる</p>
    <div class="card-title">迷宮の底へ <span class="status">調整中</span></div>
    <div class="people"><span class="gm">GM ダン</span><span>アリス</span><span class="you">あなた</span></div>
    <div class="poll">
      <div v-for="r in rows" :key="r.i" class="poll-row" :class="{ all: r.ok.length === VOTERS.length }">
        <span class="poll-date">{{ mdw(r.d) }}<span class="cnt">◯ {{ r.ok.length }}/{{ VOTERS.length }}<template v-if="r.maybe.length">　△ {{ r.maybe.length }}</template></span></span>
        <span class="row-btns tight">
          <button type="button" class="pill-btn vote" :class="{ 'on-ok': r.my === '◯' }" :aria-pressed="r.my === '◯'" :aria-label="mdw(r.d) + 'は ◯'" @click="vote(r.i, '◯')">◯</button>
          <button type="button" class="pill-btn vote" :class="{ 'on-soft': r.my === '△' }" :aria-pressed="r.my === '△'" :aria-label="mdw(r.d) + 'は △（調整すれば行ける）'" @click="vote(r.i, '△')">△</button>
          <button type="button" class="pill-btn vote" :class="{ 'on-ng': r.my === '×' }" :aria-pressed="r.my === '×'" :aria-label="mdw(r.d) + 'は ×'" @click="vote(r.i, '×')">×</button>
        </span>
        <span class="poll-names">{{ r.names }}</span>
      </div>
    </div>
    <div v-if="complete" class="decided"><Ms name="check_circle" fill />全員の回答がそろいました。GMのダンに知らせが届き、ダンが開催日を選びます</div>
    <div class="row-btns"><button type="button" class="pill-btn" @click="reset"><Ms name="restart_alt" />最初から</button></div>
    <p class="say" aria-live="polite">{{ say }}</p>
  </figure>
</template>
