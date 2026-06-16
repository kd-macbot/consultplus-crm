import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getContactsWithClients, getExpenses, getOpportunities,
  getTags, getClientTags, getStaff, getAllContacts,
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
    invalidateAll: () => qc.invalidateQueries(),
  }
}
