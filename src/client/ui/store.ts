// 小さな状態の入れ物。Reactの外（読み直しの仕組み・window.yokiなど）からも読み書きでき、ReactはuseStoreで見る
import { useSyncExternalStore } from 'react';

export type Store<T> = {
  get(): T;
  set(next: T | ((s: T) => T)): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const v = typeof next === 'function' ? (next as (s: T) => T)(state) : next;
      if (Object.is(v, state)) return;
      state = v;
      listeners.forEach((f) => f());
    },
    subscribe(f) {
      listeners.add(f);
      return () => { listeners.delete(f); };
    },
  };
}

/** 入れ物の中身を見る（変わったら描き直す） */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
