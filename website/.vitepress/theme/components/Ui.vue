<!-- アプリの画面にあるボタンやタブの名前。本文の中で「どれを押すか」を見た目で示す -->
<script setup lang="ts">
defineProps<{ icon?: string; primary?: boolean }>();
</script>

<template>
  <span class="ui" :class="{ primary }"><span v-if="icon" class="ms" aria-hidden="true">{{ icon }}</span><slot /></span>
</template>
