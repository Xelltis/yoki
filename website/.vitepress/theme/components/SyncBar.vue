<!-- 画面の上のバーの写し。時刻の横の点の色で、自動更新の様子が分かる -->
<template>
  <figure class="stage vp-raw">
    <p class="stage-cap"><span class="ms" aria-hidden="true">visibility</span>画面の上のバー</p>
    <div class="bar-peek"><span class="at">22:10 時点</span><span class="rl"><span class="ms" aria-hidden="true">refresh</span>更新</span><span class="me">ダン</span></div>
    <ul class="dots">
      <li><i class="d-ok"></i>緑の点: 自動更新が動いている</li>
      <li><i class="d-off"></i>灰色の点: 自動更新をしない設定</li>
      <li><i class="d-err"></i>赤い点: 読み込めなかった。通信を確かめる</li>
    </ul>
  </figure>
</template>
