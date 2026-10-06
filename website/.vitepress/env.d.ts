// .vueの部品をTypeScriptから読むための宣言（部品の中は組み立てのときに確かめる）
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
