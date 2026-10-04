import { QueryClient } from '@tanstack/react-query';

/** サーバーのデータの入れ物（TanStack Query）。読み直しの時機は画面ごとに決めるので、既定では自動で読み直さず、失敗しても繰り返さない */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
});
