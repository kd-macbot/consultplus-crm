import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'

// Глобален QueryClient.
// retry: false — storage слоят вече прави retry с exponential backoff
// (виж withRetry), затова тук не дублираме.
// staleTime: 30s — данните се смятат за свежи 30 сек → навигацията между
// страници не прави нов fetch (мигновено), но при focus/refetch се обновяват.
// gcTime: 24ч — кешът трябва да живее поне колкото persist-а долу, иначе
// заявките се изхвърлят от паметта и няма какво да се запише/възстанови.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: true,
    },
  },
})

// Persist на кеша в localStorage: при отваряне данните се възстановяват
// мигновено от диска (екранът се рисува веднага), а понеже staleTime е 30s,
// React Query тихо ги опреснява фоново. Така повторните отваряния са моментални.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'consultplus-rq-cache',
})

// Buster — при нов билд (нов VITE_BUILD_ID) старият кеш в браузърите на хората
// се инвалидира автоматично. Така промяна във формата на данните не чупи нищо.
const CACHE_BUSTER = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev'

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 24 * 60 * 60_000,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    // Записваме само успешните заявки — без грешки/висящи заявки.
    shouldDehydrateQuery: (query) => query.state.status === 'success',
  },
}
