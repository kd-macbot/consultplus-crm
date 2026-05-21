import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getClients, getColumns, getCellValues, getDropdownOptions,
  getContactsWithClients, getExpenses, getOpportunities,
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
    invalidateAll: () => qc.invalidateQueries(),
  }
}
