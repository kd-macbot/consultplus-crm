import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getContactsWithClients, getExpenses, getOpportunities,
  getTags, getClientTags, getStaff, getAllContacts,
  getMonthlyWork, getTrzWork, getArt55EntriesForPeriod, getChecklist,
  getClientProfiles, getPaymentConfigs, getPaymentStatuses,
  getAbsences, getVacationQuotas,
} from './storage'
import { timed } from './perf'

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
}

export function useClients() {
  return useQuery({ queryKey: qk.clients, queryFn: () => timed('clients', getClients) })
}
export function useColumns() {
  return useQuery({ queryKey: qk.columns, queryFn: () => timed('columns', getColumns) })
}
export function useCellValues() {
  return useQuery({ queryKey: qk.cells, queryFn: () => timed('cells (всички)', () => getCellValues()) })
}
export function useDropdownOptions() {
  return useQuery({ queryKey: qk.dropdowns, queryFn: () => timed('dropdowns', () => getDropdownOptions()) })
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
    invalidatePaymentStatuses: (year: number) =>
      qc.invalidateQueries({ queryKey: ['paymentStatuses', year] }),
    invalidateAbsences: (year: number) =>
      qc.invalidateQueries({ queryKey: ['absences', year] }),
    invalidateVacationQuotas: (year: number) =>
      qc.invalidateQueries({ queryKey: ['vacationQuotas', year] }),
    invalidateMonthlyWork: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['monthlyWork', year, month] }),
    invalidateTrzWork: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['trzWork', year, month] }),
    invalidateArt55: (year: number, months: number[]) =>
      qc.invalidateQueries({ queryKey: ['art55Entries', year, months.join(',')] }),
    invalidateChecklist: (year: number, month: number) =>
      qc.invalidateQueries({ queryKey: ['checklist', year, month] }),
    invalidateAll: () => qc.invalidateQueries(),
  }
}
