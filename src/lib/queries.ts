import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getContactsWithClients, getExpenses, getOpportunities,
  getTags, getClientTags, getStaff, getAllContacts,
  getMonthlyWork, getTrzWork, getArt55EntriesForPeriod, getCashLoanEntriesForPeriod, getChecklist,
  getClientProfiles, getPaymentConfigs, getPaymentStatuses,
  getAbsences, getVacationQuotas, getForm76Overrides, getEvents, getNews,
  getBankAccess, getTasks, getMyOpenTaskCount, getMonthReviewers,
  getClientMessages, getMessageTemplates,
  getFinancialClosings, getFinancialSettings,
  getCashRegisters, getCashTurnover, getCashFirmMonthly,
  getContracts, getContractTemplates, getContractBody,
  getNotifications, getNotificationSettings, getNotifyStaff,
} from './storage'
import { timed } from './perf'
import { useRealtimeHealthy } from './realtimeHealth'

// Централизирани query ключове — ползвай ги за invalidate след мутации.
export const qk = {
  clients: ['clients'] as const,
  columns: ['columns'] as const,
  cells: ['cells'] as const,
  dropdowns: ['dropdowns'] as const,
  contacts: ['contacts'] as const,
  expenses: ['expenses'] as const,
  opportunities: ['opportunities'] as const,
  tags: ['tags'] as const,
  clientTags: ['clientTags'] as const,
  staff: ['staff'] as const,
  allContacts: ['allContacts'] as const,
  clientProfiles: ['clientProfiles'] as const,
  paymentConfigs: ['paymentConfigs'] as const,
  contracts: ['contracts'] as const,
  contractTemplates: ['contractTemplates'] as const,
  contractBody: ['contractBody'] as const,
  notifications: ['notifications'] as const,
  notificationSettings: ['notificationSettings'] as const,
  notifyStaff: ['notifyStaff'] as const,
}

/**
 * Мастър данните (клиенти, колони, клетки, dropdown опции) се четат от почти
 * всяка страница, а клетките са НАЙ-СКЪПАТА заявка в приложението (беше ~45%
 * от времето му в базата).
 *
 * Затова staleTime им е 30 минути, а не общите 5: свежестта вече не зависи от
 * изтичане на кеша, а от споделения realtime абонамент в Layout
 * (useCrmMasterRealtime), който invalidate-ва при реална промяна. Периодът
 * остава само като предпазна мрежа, ако realtime връзката падне тихо.
 *
 * НЕ вдигай това, без абонаментът да е активен — иначе промени от колеги ще
 * се виждат чак след половин час.
 */
const MASTER_STALE = 30 * 60_000
/** Докато realtime не е потвърден — поведението отпреди: 5 минути. */
const MASTER_STALE_FALLBACK = 5 * 60_000

/**
 * Дългият staleTime важи САМО докато абонаментът е жив. Ако падне (заспал
 * лаптоп, паднала мрежа, изтекъл токен), допускането „промените идват като
 * събитие" вече не важи и кешът се връща към 5 минути, докато връзката се
 * възстанови. Без това колега би гледал стари данни половин час, без да
 * подозира.
 */
function useMasterStale() {
  return useRealtimeHealthy() ? MASTER_STALE : MASTER_STALE_FALLBACK
}

export function useClients() {
  return useQuery({ queryKey: qk.clients, queryFn: () => timed('clients', getClients), staleTime: useMasterStale() })
}
export function useColumns() {
  return useQuery({ queryKey: qk.columns, queryFn: () => timed('columns', getColumns), staleTime: useMasterStale() })
}
export function useCellValues() {
  return useQuery({ queryKey: qk.cells, queryFn: () => timed('cells (всички)', () => getCellValues()), staleTime: useMasterStale() })
}
export function useDropdownOptions() {
  return useQuery({ queryKey: qk.dropdowns, queryFn: () => timed('dropdowns', () => getDropdownOptions()), staleTime: useMasterStale() })
}
export function useContactsWithClients() {
  return useQuery({ queryKey: qk.contacts, queryFn: getContactsWithClients })
}
export function useExpenses() {
  return useQuery({ queryKey: qk.expenses, queryFn: getExpenses })
}
export function useOpportunities() {
  return useQuery({ queryKey: qk.opportunities, queryFn: getOpportunities })
}
export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: getTags })
}
export function useClientTags() {
  return useQuery({ queryKey: qk.clientTags, queryFn: getClientTags })
}
export function useStaff() {
  return useQuery({ queryKey: qk.staff, queryFn: () => getStaff() })
}
export function useAllContacts() {
  return useQuery({ queryKey: qk.allContacts, queryFn: getAllContacts })
}
export function useClientProfiles() {
  return useQuery({ queryKey: qk.clientProfiles, queryFn: getClientProfiles })
}
export function usePaymentConfigs() {
  return useQuery({ queryKey: qk.paymentConfigs, queryFn: getPaymentConfigs })
}
export function usePaymentStatuses(year: number) {
  return useQuery({
    queryKey: ['paymentStatuses', year] as const,
    queryFn: () => getPaymentStatuses(year),
    enabled: year > 0,
  })
}
export function useAbsences(year: number) {
  return useQuery({
    queryKey: ['absences', year] as const,
    queryFn: () => getAbsences(year),
    enabled: year > 0,
  })
}
export function useVacationQuotas(year: number) {
  return useQuery({
    queryKey: ['vacationQuotas', year] as const,
    queryFn: () => getVacationQuotas(year),
    enabled: year > 0,
  })
}
export function useForm76Overrides(year: number, month: number) {
  return useQuery({
    queryKey: ['form76Overrides', year, month] as const,
    queryFn: () => getForm76Overrides(year, month),
    enabled: year > 0 && month > 0,
  })
}
export function useEvents(year: number) {
  return useQuery({
    queryKey: ['events', year] as const,
    queryFn: () => getEvents(year),
    enabled: year > 0,
  })
}
export function useNews() {
  return useQuery({
    queryKey: ['news'] as const,
    queryFn: () => getNews(30),
  })
}
export function useBankAccess() {
  return useQuery({
    queryKey: ['bankAccess'] as const,
    queryFn: getBankAccess,
  })
}
export function useTasks() {
  return useQuery({
    queryKey: ['tasks'] as const,
    queryFn: getTasks,
  })
}
/**
 * Броят мои отворени задачи за баджа. Ключът започва с 'tasks', затова
 * invalidateTasks() (префиксен match) освежава и него.
 */
export function useMyOpenTaskCount(staffId: string | null | undefined) {
  return useQuery({
    queryKey: ['tasks', 'openCount', staffId ?? null] as const,
    queryFn: () => getMyOpenTaskCount(staffId as string),
    enabled: !!staffId,
  })
}
export function useMonthReviewers(year: number, month: number) {
  return useQuery({
    queryKey: ['monthReviewers', year, month] as const,
    queryFn: () => getMonthReviewers(year, month),
    enabled: year > 0 && month > 0,
  })
}

// Месечни / годишни данни — параметризирани по year/month, така че RQ кешира
// всеки месец отделно. След като user е посетил месец веднъж, повторното
// посещение е МИГНОВЕНО от persisted кеша.
export function useMonthlyWork(year: number, month: number) {
  return useQuery({
    queryKey: ['monthlyWork', year, month] as const,
    queryFn: () => getMonthlyWork(year, month),
    enabled: year > 0 && month > 0,
  })
}
export function useTrzWork(year: number, month: number) {
  return useQuery({
    queryKey: ['trzWork', year, month] as const,
    queryFn: () => getTrzWork(year, month),
    enabled: year > 0 && month > 0,
  })
}
export function useArt55Entries(year: number, months: number[]) {
  return useQuery({
    queryKey: ['art55Entries', year, months.join(',')] as const,
    queryFn: () => getArt55EntriesForPeriod(year, months),
    enabled: year > 0 && months.length > 0,
  })
}
export function useClientMessages() {
  return useQuery({ queryKey: ['clientMessages'] as const, queryFn: () => getClientMessages() })
}
export function useMessageTemplates() {
  return useQuery({ queryKey: ['messageTemplates'] as const, queryFn: getMessageTemplates })
}
// Известия — само страницата „Известия" ги ползва (admin). Кратък
// staleTime: дневникът се променя от cron-а извън браузъра, тоест
// realtime не помага толкова, колкото едно свежо отваряне.
export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: () => getNotifications() })
}
export function useNotificationSettings() {
  return useQuery({ queryKey: qk.notificationSettings, queryFn: getNotificationSettings })
}
export function useNotifyStaff() {
  return useQuery({ queryKey: qk.notifyStaff, queryFn: getNotifyStaff })
}
export function useContracts() {
  return useQuery({ queryKey: qk.contracts, queryFn: getContracts })
}
/**
 * Текстът на един договор. Тегли се чак при отваряне за преглед и остава в
 * кеша — повторното кликване по същия ред не праща нова заявка.
 * Snapshot е (не се променя след записа), затова не остарява.
 */
export function useContractBody(id: string | null) {
  return useQuery({
    queryKey: [...qk.contractBody, id],
    queryFn: () => getContractBody(id as string),
    enabled: !!id,
    staleTime: Infinity,
  })
}
export function useContractTemplates() {
  return useQuery({ queryKey: qk.contractTemplates, queryFn: getContractTemplates })
}
export function useCashRegisters() {
  return useQuery({ queryKey: ['cashRegisters'] as const, queryFn: getCashRegisters })
}
export function useCashTurnover(year: number) {
  return useQuery({ queryKey: ['cashTurnover', year] as const, queryFn: () => getCashTurnover(year), enabled: year > 0 })
}
export function useCashFirmMonthly(year: number) {
  return useQuery({ queryKey: ['cashFirmMonthly', year] as const, queryFn: () => getCashFirmMonthly(year), enabled: year > 0 })
}
export function useFinancialClosings(year: number) {
  return useQuery({
    queryKey: ['financialClosings', year] as const,
    queryFn: () => getFinancialClosings(year),
    enabled: year > 0,
  })
}
export function useFinancialSettings() {
  return useQuery({ queryKey: ['financialSettings'] as const, queryFn: getFinancialSettings })
}
export function useCashLoanEntries(year: number, months: number[]) {
  return useQuery({
    queryKey: ['cashLoanEntries', year, months.join(',')] as const,
    queryFn: () => getCashLoanEntriesForPeriod(year, months),
    enabled: year > 0 && months.length > 0,
  })
}
export function useChecklist(year: number, month: number) {
  return useQuery({
    queryKey: ['checklist', year, month] as const,
    queryFn: () => getChecklist(year, month),
    enabled: year > 0 && month > 0,
  })
}

/**
 * Връща функция за invalidate на споделените данни — викай я след мутация
 * (запис/изтриване), за да се презаредят кешираните данни в другите екрани.
 */
export function useInvalidateCrm() {
  const qc = useQueryClient()
  return {
    invalidateClients: () => qc.invalidateQueries({ queryKey: qk.clients }),
    invalidateColumns: () => qc.invalidateQueries({ queryKey: qk.columns }),
    invalidateCells: () => qc.invalidateQueries({ queryKey: qk.cells }),
    invalidateDropdowns: () => qc.invalidateQueries({ queryKey: qk.dropdowns }),
    invalidateContacts: () => qc.invalidateQueries({ queryKey: qk.contacts }),
    invalidateExpenses: () => qc.invalidateQueries({ queryKey: qk.expenses }),
    invalidateOpportunities: () => qc.invalidateQueries({ queryKey: qk.opportunities }),
    invalidateTags: () => qc.invalidateQueries({ queryKey: qk.tags }),
    invalidateClientTags: () => qc.invalidateQueries({ queryKey: qk.clientTags }),
    invalidateStaff: () => qc.invalidateQueries({ queryKey: qk.staff }),
    invalidateAllContacts: () => qc.invalidateQueries({ queryKey: qk.allContacts }),
    invalidateClientProfiles: () => qc.invalidateQueries({ queryKey: qk.clientProfiles }),
    invalidatePaymentConfigs: () => qc.invalidateQueries({ queryKey: qk.paymentConfigs }),
    invalidateContracts: () => qc.invalidateQueries({ queryKey: qk.contracts }),
    invalidateContractTemplates: () => qc.invalidateQueries({ queryKey: qk.contractTemplates }),
    invalidatePaymentStatuses: (year: number) =>
      qc.invalidateQueries({ queryKey: ['paymentStatuses', year] }),
    invalidateAbsences: (year: number) =>
      qc.invalidateQueries({ queryKey: ['absences', year] }),
    invalidateVacationQuotas: (year: number) =>
      qc.invalidateQueries({ queryKey: ['vacationQuotas', year] }),
    invalidateForm76Overrides: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['form76Overrides', year, month] }),
    invalidateEvents: (year: number) =>
      qc.invalidateQueries({ queryKey: ['events', year] }),
    invalidateNews: () => qc.invalidateQueries({ queryKey: ['news'] }),
    invalidateBankAccess: () => qc.invalidateQueries({ queryKey: ['bankAccess'] }),
    invalidateTasks: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    invalidateMonthReviewers: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['monthReviewers', year, month] }),
    invalidateMonthlyWork: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['monthlyWork', year, month] }),
    invalidateTrzWork: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['trzWork', year, month] }),
    invalidateArt55: (year: number, months: number[]) =>
      qc.invalidateQueries({ queryKey: ['art55Entries', year, months.join(',')] }),
    // Каси и заеми: инвалидира ВСИЧКИ периоди (месечният от Работния лист
    // и целогодишният от „Каси и заеми" ползват различни ключове).
    invalidateCashLoan: () =>
      qc.invalidateQueries({ queryKey: ['cashLoanEntries'] }),
    invalidateCashRegisters: () =>
      qc.invalidateQueries({ queryKey: ['cashRegisters'] }),
    invalidateCashTurnover: () =>
      qc.invalidateQueries({ queryKey: ['cashTurnover'] }),
    invalidateCashFirmMonthly: () =>
      qc.invalidateQueries({ queryKey: ['cashFirmMonthly'] }),
    invalidateFinancialClosings: () =>
      qc.invalidateQueries({ queryKey: ['financialClosings'] }),
    invalidateFinancialSettings: () =>
      qc.invalidateQueries({ queryKey: ['financialSettings'] }),
    invalidateClientMessages: () =>
      qc.invalidateQueries({ queryKey: ['clientMessages'] }),
    invalidateMessageTemplates: () =>
      qc.invalidateQueries({ queryKey: ['messageTemplates'] }),
    invalidateNotifications: () => qc.invalidateQueries({ queryKey: qk.notifications }),
    invalidateNotificationSettings: () => qc.invalidateQueries({ queryKey: qk.notificationSettings }),
    invalidateNotifyStaff: () => qc.invalidateQueries({ queryKey: qk.notifyStaff }),
    invalidateChecklist: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['checklist', year, month] }),
    invalidateAll: () => qc.invalidateQueries(),
  }
}
