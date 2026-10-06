// サイトの見た目。VitePressの既定のテーマに、アプリの色と、本文で使う部品を足す
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import AvailDemo from './components/AvailDemo.vue';
import CalendarLegend from './components/CalendarLegend.vue';
import HomeFeatures from './components/HomeFeatures.vue';
import HomeShots from './components/HomeShots.vue';
import JoinDemo from './components/JoinDemo.vue';
import Ms from './components/Ms.vue';
import RegisterDemo from './components/RegisterDemo.vue';
import Shot from './components/Shot.vue';
import StatusFlow from './components/StatusFlow.vue';
import SyncBar from './components/SyncBar.vue';
import Ui from './components/Ui.vue';
import VoteDemo from './components/VoteDemo.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  // トップのページは、見出しのすぐ下にアプリの画面を出し、その下に特長を並べる
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-after': () => h(HomeShots), 'home-features-before': () => h(HomeFeatures) }),
  enhanceApp({ app }) {
    // 本文（Markdown）から使う部品
    const parts = { AvailDemo, CalendarLegend, JoinDemo, Ms, RegisterDemo, Shot, StatusFlow, SyncBar, Ui, VoteDemo };
    for (const [name, c] of Object.entries(parts)) app.component(name, c);
  },
} satisfies Theme;
