<!-- カレンダーのマスの色とアイコンの読み方（アプリの画面と同じ色） -->
<script setup lang="ts">
import Ms from './Ms.vue';
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap"><Ms name="visibility" />色とアイコン</p>
    <dl class="legend">
      <div><dt class="mono c-ok">20</dt><dd>全員空き<small>誰も印を付けていない</small></dd></div>
      <div><dt class="mono c-soft">21</dt><dd>△ あり<small>× は無いが △ の人がいる</small></dd></div>
      <div><dt class="mono c-session">18</dt><dd>卓あり<small>予定・開催の卓がある</small></dd></div>
      <div><dt class="mono c-past">12</dt><dd>終わった卓<small>終了・中止の卓だけ</small></dd></div>
    </dl>
    <div class="icons">
      <span><Ms name="play_circle" />今日の卓</span>
      <span class="v"><Ms name="campaign" />募集</span>
      <span><Ms name="edit_calendar" />調整期間</span>
      <span><Ms name="how_to_vote" />候補日</span>
      <span><Ms name="task_alt" />終了</span>
      <span><Ms name="block" />中止</span>
      <span class="v"><Ms name="sticky_note_2" />メモ</span>
    </div>
  </figure>
</template>
