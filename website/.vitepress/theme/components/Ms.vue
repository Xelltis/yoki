<!-- アイコン 1 つ（SVG。theme/icons.ts）。飾りなので読み上げない。大きさは文字の大きさ（1em）、色は文字の色。fill は塗りつぶした形 -->
<script setup lang="ts">
import { FILLED, ICONS, type IconName } from '../icons';

defineProps<{ name: IconName; fill?: boolean }>();
</script>

<template>
  <component :is="(fill && FILLED[name]) || ICONS[name]" class="ms" aria-hidden="true" focusable="false" />
</template>
