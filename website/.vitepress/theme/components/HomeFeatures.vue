<!-- トップのページの特長。中身はindex.mdのpoints（icon・title・details）。VitePressの特長の並び（VPFeatures）で出す。
     特長のアイコンはHTMLの文字で渡すので、SVGの文字（~icons/…?raw。unplugin-icons）にする -->
<script setup lang="ts">
import { useData } from 'vitepress';
import { VPFeatures } from 'vitepress/theme';
import { computed } from 'vue';
import autoStories from '~icons/material-symbols/auto-stories-outline-rounded?raw';
import calendarMonth from '~icons/material-symbols/calendar-month-outline-rounded?raw';
import checklist from '~icons/material-symbols/checklist-rounded?raw';
import event from '~icons/material-symbols/event-outline-rounded?raw';
import eventAvailable from '~icons/material-symbols/event-available-outline-rounded?raw';
import howToVote from '~icons/material-symbols/how-to-vote-outline-rounded?raw';
import login from '~icons/material-symbols/login-outline-rounded?raw';
import notifications from '~icons/material-symbols/notifications-outline-rounded?raw';
import rocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded?raw';

const RAW: Record<string, string> = {
  auto_stories: autoStories, calendar_month: calendarMonth, checklist: checklist, event: event, event_available: eventAvailable, how_to_vote: howToVote, login: login, notifications: notifications, rocket_launch: rocketLaunch,
};
type Point = { icon: string; title: string; details: string };

const { frontmatter } = useData();
const features = computed(() => ((frontmatter.value.points ?? []) as Point[]).map((p) => ({ ...p, icon: RAW[p.icon] })));
</script>

<template>
  <VPFeatures v-if="features.length" class="VPHomeFeatures" :features="features" />
</template>
