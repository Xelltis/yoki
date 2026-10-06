<!-- アプリのスクリーンショット（public/screenshots/。npm run screenshotsで撮る）。
     themedを付けると、サイトの見た目（ライト／ダーク）に合わせて -light・-darkを出し分ける -->
<script setup lang="ts">
import { withBase } from 'vitepress';

const props = defineProps<{ name: string; alt: string; themed?: boolean; phone?: boolean }>();
const size = props.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const src = (theme?: string) => withBase('/screenshots/' + props.name + (theme ? '-' + theme : '') + '.png');
</script>

<template>
  <figure class="shot vp-raw" :class="{ phone }">
    <template v-if="themed">
      <img class="light-only" :src="src('light')" :alt="alt" v-bind="size" loading="lazy" decoding="async">
      <img class="dark-only" :src="src('dark')" :alt="alt" v-bind="size" loading="lazy" decoding="async">
    </template>
    <img v-else :src="src()" :alt="alt" v-bind="size" loading="lazy" decoding="async">
  </figure>
</template>
