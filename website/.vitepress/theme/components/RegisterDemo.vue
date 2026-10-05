<!-- 試せる例: カレンダーで日を選んでから「卓を登録」を押すと、その日の卓になる -->
<script setup lang="ts">
import Ms from './Ms.vue';
import { computed, ref } from 'vue';
import { addDays, dowClass, md, mdw, useMonday, WD } from './demo';

const monday = useMonday();
const days = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday.value, i)));
const sel = ref(-1);
const opened = ref(false);
const say = ref('日を押してから「卓を登録」を押してください。もう一度押すと選択が外れます。');
const picked = computed(() => (sel.value >= 0 ? days.value[sel.value] : null));
const ymd = (d: Date) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');

function pick(i: number) {
  sel.value = sel.value === i ? -1 : i;
  opened.value = false;
  say.value = picked.value ? mdw(picked.value) + ' を選びました。ボタンの名前が変わりました。' : '選択を外しました。';
}
function open() {
  opened.value = true;
  say.value = picked.value ? '登録の窓が開き、開催日に ' + mdw(picked.value) + ' が入りました。' : '日を選ばずに押したので、開催日は空のまま開きました。';
}
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap try"><Ms name="touch_app" />やってみる</p>
    <div class="week" role="group" aria-label="日を選ぶ">
      <button v-for="(d, i) in days" :key="i" type="button" class="day" :class="dowClass(d)" :aria-pressed="sel === i" @click="pick(i)">
        <span class="w">{{ WD[d.getDay()] }}</span><span class="d">{{ md(d) }}</span>
      </button>
    </div>
    <div class="row-btns">
      <button type="button" class="pill-btn primary" @click="open"><Ms name="add" />{{ picked ? md(picked) + ' に卓を登録' : '卓を登録' }}</button>
    </div>
    <div v-if="opened" class="form-peek">
      <div class="t">卓を登録</div>
      <div class="field"><span>開催日</span><span v-if="picked">{{ ymd(picked) }}</span><span v-else><span class="empty">空のまま</span></span></div>
      <div class="field"><span>卓の名前</span><span><span class="empty">ここから入力</span></span></div>
    </div>
    <p class="say" aria-live="polite">{{ say }}</p>
  </figure>
</template>
