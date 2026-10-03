<!-- 試せる例: 募集中の卓に「参加希望」か「興味あり」を付ける -->
<script setup lang="ts">
import { computed, ref } from 'vue';

const join = ref<'' | 'want' | 'interest'>('');
const said = ref('');
const want = computed(() => (join.value === 'want' ? ['ダン', 'あなた'] : ['ダン']));
const SAY = {
  want: '<b>参加希望にしました。</b>状態が「開催」になると、そのまま参加者に入ります。',
  interest: '<b>興味ありにしました。</b>GM から声がかかったら、参加希望に切り替えれば返事になります。',
  '': '取り消しました。Discord には何も流れていません。',
};
function set(v: '' | 'want' | 'interest') {
  join.value = join.value === v ? '' : v;
  said.value = SAY[join.value];
}
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap try"><span class="ms" aria-hidden="true">touch_app</span>やってみる</p>
    <div class="card-title">星降る港の依頼</div>
    <div class="card-when">10/3（金）〜10/17（金） に開催予定</div>
    <div class="people"><span class="gm">GM カレン</span><span>アリス</span><span>ボブ</span></div>
    <dl class="kv">
      <dt>参加希望</dt>
      <dd><template v-for="(n, i) in want" :key="n">{{ i ? '、' : '' }}<b v-if="n === 'あなた'" class="you-text">あなた</b><template v-else>{{ n }}</template></template></dd>
      <dt>興味あり</dt>
      <dd><b v-if="join === 'interest'" class="you-text">あなた</b><span v-else class="muted">まだいません</span></dd>
    </dl>
    <div class="row-btns" role="group" aria-label="参加の意思">
      <button type="button" class="pill-btn" :aria-pressed="join === 'want'" @click="set('want')">参加希望</button>
      <button type="button" class="pill-btn" :aria-pressed="join === 'interest'" @click="set('interest')">興味あり</button>
      <button v-if="join" type="button" class="pill-btn" @click="set('')">取り消す</button>
    </div>
    <p v-if="said" class="say" aria-live="polite" v-html="said"></p>
    <p v-else class="say" aria-live="polite">ボタンを押すと、上の名簿に「あなた」が入ります。</p>
  </figure>
</template>
