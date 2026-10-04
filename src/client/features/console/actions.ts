// 窓を開く頼み（卓の登録の窓・候補日を選ぶ窓）。窓の部品は外枠に置き、頼みは画面の状態（ui）に入れる。
// 頼みには、閉じても戻らない通し番号を付ける（窓は、番号が変わったら入力を作り直す。同じ頼みでも開き直す）
import type { Store } from '../../ui/store';
import type { ConsoleUi, FormReq } from './context';

let seq = 0;

/** 卓の登録の窓を開く */
export function openForm(ui: Store<ConsoleUi>, req: FormReq = {}): void {
  ui.set((s) => ({ ...s, form: { seq: ++seq, req } }));
}

/** 候補日を選ぶ窓を開く（日程調整を始める・候補日を選び直す） */
export function openPoll(ui: Store<ConsoleUi>, id: string): void {
  ui.set((s) => ({ ...s, poll: { seq: ++seq, id } }));
}
