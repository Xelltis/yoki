// 試せる例で使う日付。例の日付は、いつ開いても先の日になるよう「次の月曜」から数える（見る人の手元の暦で）。
// 組み立てのとき（SSR）は決まった日で描き、ブラウザで開いたら今日から数え直す（組み立てた HTML と食い違わないように）
import { onMounted, ref } from 'vue';

export const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
/** 10/5 */
export const md = (d: Date) => d.getMonth() + 1 + '/' + d.getDate();
/** 10/5（月） */
export const mdw = (d: Date) => md(d) + '（' + WD[d.getDay()] + '）';
/** 日曜・土曜の色の印 */
export const dowClass = (d: Date) => (d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '');

/** 例の基準にする月曜 */
export function useMonday() {
  const monday = ref(new Date(2026, 9, 5));
  onMounted(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.value = addDays(today, (8 - today.getDay()) % 7 || 7);
  });
  return monday;
}
