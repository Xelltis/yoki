// React の画面の入口。いまは入口のページ（/）だけ（グループの画面と運営の管理画面は、まだ console/ と operator/ にある）
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './app/queryClient';
import { Home } from './features/home/Home';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  </StrictMode>,
);
