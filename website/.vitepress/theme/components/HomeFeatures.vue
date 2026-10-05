<!-- トップのページの特長。中身は index.md の points（icon・title・details）。VitePress の特長の並び（VPFeatures）で出す。
     特長のアイコンは HTML の文字で渡すので、SVG の文字（~icons/…?raw。unplugin-icons）にする -->
<script setup lang="ts">
import { useData } from 'vitepress';
import { VPFeatures } from 'vitepress/theme';
import { computed } from 'vue';
import eventAvailable from '~icons/material-symbols/event-available-outline-rounded?raw';
import howToVote from '~icons/material-symbols/how-to-vote-outline-rounded?raw';
import login from '~icons/material-symbols/login-outline-rounded?raw';
import notifications from '~icons/material-symbols/notifications-outline-rounded?raw';

const RAW: Record<string, string> = { event_available: eventAvailable, how_to_vote: howToVote, login: login, notifications: notifications };
type Point = { icon: string; title: string; details: string };

const { frontmatter } = useData();
const features = computed(() => ((frontmatter.value.points ?? []) as Point[]).map((p) => ({ ...p, icon: RAW[p.icon] })));
</script>

<template>
  <VPFeatures v-if="features.length" class="VPHomeFeatures" :features="features" />
</template>
