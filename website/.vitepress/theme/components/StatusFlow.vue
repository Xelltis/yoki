<!-- 卓の状態の流れ（順番に意味がある） -->
<script setup lang="ts">
import Ms from './Ms.vue';
</script>

<template>
  <div class="vp-raw">
    <ol class="track" aria-label="卓の状態の流れ">
      <li><span class="dot"><Ms name="campaign" /></span><b>募集</b><p>参加者を集める。日の代わりに「10/3〜10/17」のような開きたい期間を持つ。参加者はまだ書かない</p></li>
      <li><span class="dot"><Ms name="edit_calendar" /></span><b>調整中</b><p>参加者は決まり、候補の期間や候補日から開催日を選ぶ</p></li>
      <li><span class="dot"><Ms name="event" /></span><b>開催</b><p>開催日が決まった。決めた日時（既定は前日の 20 時台）に Discord へ知らせが届く</p></li>
      <li><span class="dot"><Ms name="task_alt" /></span><b>終了</b><p>開催日を過ぎると自動で変わる。カレンダーには灰色で残る</p></li>
    </ol>
    <p class="aside-note"><Ms name="block" /><span>開かないと決まった卓は「中止」にします。どの状態からでも選べ、カレンダーには取り消し線付きで残ります。</span></p>
  </div>
</template>
