// React の画面の入口。道（router.tsx）に合わせて、ページの部品を分けて読む。
// いまは入口のページ（/）だけ（グループの画面と運営の管理画面は、まだ console/ と operator/ にある）
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './app/queryClient';
import { router } from './router';

// 公開し直して古い JS が無くなったまま開いていたタブは、分けた JS を読めない。1 分に 1 度まで、読み直して新しい JS にする
window.addEventListener('vite:preloadError', (ev) => {
  const KEY = 'taku.chunkReloadAt';
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; sessionStorage.setItem(KEY, String(Date.now())); } catch { /* 使えない端末 */ }
  if (Date.now() - last < 60_000) return;
  ev.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
