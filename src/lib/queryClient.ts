import { QueryClient } from '@tanstack/react-query'

// Глобален QueryClient.
// retry: false — storage слоят вече прави retry с exponential backoff
// (виж withRetry), затова тук не дублираме.
// staleTime: 30s — данните се смятат за свежи 30 сек → навигацията между
// страници не прави нов fetch (мигновено), но при focus/refetch се обновяват.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  },
})
