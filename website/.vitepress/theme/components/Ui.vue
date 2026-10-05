<!-- アプリの画面にあるボタンやタブの名前。本文の中で「どれを押すか」を見た目で示す -->
<script setup lang="ts">
import type { IconName } from '../icons';
import Ms from './Ms.vue';

defineProps<{ icon?: IconName; primary?: boolean }>();
</script>

<template>
  <span class="ui" :class="{ primary }"><Ms v-if="icon" :name="icon" /><slot /></span>
</template>
