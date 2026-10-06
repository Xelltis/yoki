<!-- 画面の上のバーの写し。時刻の横の点の色で、自動更新の様子が分かる -->
<script setup lang="ts">
import Ms from './Ms.vue';
</script>

<template>
  <figure class="stage vp-raw">
    <p class="stage-cap"><Ms name="visibility" />画面の上のバー</p>
    <div class="bar-peek"><span class="at">22:10時点</span><span class="rl"><Ms name="refresh" />更新</span><span class="me">ダン</span></div>
    <ul class="dots">
      <li><i class="d-ok"></i>緑の点: 自動更新が動いている</li>
      <li><i class="d-off"></i>灰色の点: 自動更新をしない設定</li>
      <li><i class="d-err"></i>赤い点: 読み込めなかった。通信を確かめる</li>
    </ul>
  </figure>
</template>
