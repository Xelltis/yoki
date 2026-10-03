<!-- カレンダーのマスの色とアイコンの読み方（アプリの画面と同じ色） -->
<template>
  <figure class="stage vp-raw">
    <p class="stage-cap"><span class="ms" aria-hidden="true">visibility</span>色とアイコン</p>
    <dl class="legend">
      <div><dt class="mono c-ok">20</dt><dd>全員空き<small>誰も印を付けていない</small></dd></div>
      <div><dt class="mono c-soft">21</dt><dd>△ あり<small>× は無いが △ の人がいる</small></dd></div>
      <div><dt class="mono c-session">18</dt><dd>卓あり<small>予定・開催の卓がある</small></dd></div>
      <div><dt class="mono c-past">12</dt><dd>終わった卓<small>終了・中止の卓だけ</small></dd></div>
    </dl>
    <div class="icons">
      <span><span class="ms" aria-hidden="true">event</span>予定</span>
      <span><span class="ms" aria-hidden="true">play_circle</span>開催</span>
      <span class="v"><span class="ms" aria-hidden="true">campaign</span>募集</span>
      <span><span class="ms" aria-hidden="true">edit_calendar</span>調整期間</span>
      <span><span class="ms" aria-hidden="true">how_to_vote</span>候補日</span>
      <span><span class="ms" aria-hidden="true">task_alt</span>終了</span>
      <span><span class="ms" aria-hidden="true">block</span>中止</span>
      <span class="v"><span class="ms" aria-hidden="true">sticky_note_2</span>メモ</span>
    </div>
  </figure>
</template>
