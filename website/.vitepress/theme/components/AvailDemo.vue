<!-- 試せる例: メンバーの予定。「あなた」の行を押すと 空 → △ → × → 空。いちばん下に、全員が空いている日が出る -->
<script setup lang="ts">
import Ms from './Ms.vue';
import { computed, reactive, useId } from 'vue';
import { addDays, dowClass, md, mdw, useMonday, WD } from './demo';

type Mark = '' | '△' | '×';
const NEXT: Record<Mark, Mark> = { '': '△', '△': '×', '×': '' };
const WORD: Record<Mark, string> = { '': '空欄（参加できる）', '△': '△（調整すれば行ける）', '×': '×（行けない）' };

const monday = useMonday();
const days = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday.value, i)));
const people = reactive([
  { name: 'アリス', marks: ['', '×', '', '△', '', '', '×'] as Mark[], me: false },
  { name: 'ボブ', marks: ['△', '', '', '', '', '×', ''] as Mark[], me: false },
  { name: 'カレン', marks: ['', '', '×', '', '', '', ''] as Mark[], me: false },
  { name: 'あなた', marks: ['', '', '', '', '', '', ''] as Mark[], me: true },
]);
const states = computed(() => days.value.map((_, i) => {
  const ms = people.map((p) => p.marks[i]);
  return ms.includes('×') ? 'ng' : ms.includes('△') ? 'soft' : 'ok';
}));
const okDays = computed(() => days.value.filter((_, i) => states.value[i] === 'ok'));
const say = computed(() => (okDays.value.length ? '全員が空いている日: ' + okDays.value.map(mdw).join('、') : '全員が空いている日はありません'));
const sayId = useId();

function toggle(p: (typeof people)[number], i: number) {
  p.marks[i] = NEXT[p.marks[i]];
}
const markClass = (m: Mark) => (m === '△' ? 'm-soft' : m === '×' ? 'm-ng' : '');
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap try"><Ms name="touch_app" />やってみる</p>
    <div class="board">
      <div class="board-head"><span><b>メンバーの予定</b>（例）</span><span class="mono">{{ md(days[0]) }}〜{{ md(days[6]) }}</span></div>
      <div class="board-scroll">
        <table class="avgrid" :aria-describedby="sayId">
          <thead>
            <tr>
              <th scope="col"><span class="vh">名前</span></th>
              <th v-for="(d, i) in days" :key="i" scope="col" :class="[dowClass(d), { ok: states[i] === 'ok' }]"><span class="d">{{ md(d) }}</span><span class="w">{{ WD[d.getDay()] }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in people" :key="p.name" :class="{ me: p.me }">
              <th scope="row" class="name">{{ p.name }}</th>
              <td v-for="(m, i) in p.marks" :key="i" :class="markClass(m)">
                <button v-if="p.me" type="button" class="mk" :aria-label="mdw(days[i]) + 'あなたの予定は' + WORD[m] + '。押すと' + WORD[NEXT[m]]" @click="toggle(p, i)">
                  <template v-if="m">{{ m }}</template><span v-else class="hint">·</span>
                </button>
                <template v-else>{{ m }}</template>
              </td>
            </tr>
            <tr class="sum">
              <th scope="row" class="name">全員</th>
              <td v-for="(st, i) in states" :key="i" :class="st">{{ st === 'ok' ? '◎' : st === 'soft' ? '△' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="board-foot">
        <span :id="sayId" class="live" aria-live="polite">{{ say }}</span>
        <span><i class="sw ok"></i>全員空き</span>
        <span><i class="sw soft"></i>△ あり</span>
        <span><i class="sw ng"></i>× あり</span>
      </div>
    </div>
    <figcaption class="say">「あなた」の行を押すと、空欄 → △ → × → 空欄 と印が回ります。いちばん下の「全員」の行に、全員が空いている日が出ます。</figcaption>
  </figure>
</template>
