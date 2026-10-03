<!-- トップのページの、見出しの下の画面（PC とスマホを重ねる） -->
<script setup lang="ts">
import Shot from './Shot.vue';
</script>

<template>
  <div class="home-shots">
    <Shot class="pc" name="pc-calendar" themed alt="PC で開いた卓予定。カレンダーに卓の予定と、全員が空いている日の色が並ぶ" />
    <Shot class="phone" name="phone-calendar" themed phone alt="スマホで開いた卓予定のカレンダー" />
  </div>
</template>
