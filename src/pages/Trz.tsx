import { useState, useEffect, useMemo } from 'react'
import { getColumns, getCellValues, getClients, getDropdownOptions } from '../lib/storage'
import { useAuth } from '../lib/auth'
import type { Column, CellValue, Client, DropdownOption } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex, cellKey,
  clientDisplayName, resolveDropdownText, resolveText,
} from '../lib/tableIndices'
import { statusBadgeClass } from '../lib/statusBadge'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const uc = (s: string) => s.toUpperCase()

function formatDate(v: string | null | undefined): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  return v
}

export function TrzPage() {
  const { user } = useAuth()
  const [allClients, setAllClients] = useState<Client[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [allDropdowns, setAllDropdowns] = useState<DropdownOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [softwareFilter, setSoftwareFilter] = useState<string[]>([])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [cls, cols, cells, dds] = await Promise.all([
        getClients(), getColumns(), getCellValues(), getDropdownOptions()
      ])
      setAllClients(cls)
      setAllColumns(cols)
      setAllCells(cells)
      setAllDropdowns(dds)
    } finally {
      setLoading(false)
    }
  }

  const cellIdx = useMemo(() => buildCellIndex(allCells), [allCells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(allDropdowns), [allDropdowns])

  // Намираме мастер колоните по име (устойчиво на леки разлики, като в Import).
  const trzRespCol = useMemo(() => allColumns.find(c => {
    const n = uc(c.name)
    return n.includes('ТРЗ') && !n.includes('СТАТУС') && !n.includes('СОФТУЕР')
  }), [allColumns])
  const trzStatusCol = useMemo(() => allColumns.find(c => {
    const n = uc(c.name)
    return n.includes('ТРЗ') && n.includes('СТАТУС')
  }), [allColumns])
  const vedomostCol = useMemo(() => allColumns.find(c => uc(c.name).includes('ВЕДОМОСТ')), [allColumns])
  const softwareCol = useMemo(() => allColumns.find(c => uc(c.name).includes('СОФТУЕР')), [allColumns])

  const clients = useMemo(() => {
    return [...allClients].sort((a, b) =>
      (clientDisplayName(a.id, allColumns, cellIdx) || a.id)
        .localeCompare(clientDisplayName(b.id, allColumns, cellIdx) || b.id, 'bg')
    )
  }, [allClients, allColumns, cellIdx])

  function clientName(clientId: string): string {
    return clientDisplayName(clientId, allColumns, cellIdx) || clientId.slice(0, 8)
  }

  // Текстова стойност за дадена колона (по тип) — за показване и филтриране.
  function valueText(col: Column | undefined, clientId: string): string {
    if (!col) return ''
    if (col.type === 'dropdown') return resolveDropdownText(clientId, col, cellIdx, dropdownIdx)
    if (col.type === 'date') return formatDate(cellIdx.get(cellKey(clientId, col.id))?.value_date)
    return resolveText(clientId, col, cellIdx)
  }

  const statusOptions = useMemo(() => {
    if (!trzStatusCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === trzStatusCol.id).map(d => d.value))]
  }, [allDropdowns, trzStatusCol])

  const softwareOptions = useMemo(() => {
    if (!softwareCol) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === softwareCol.id).map(d => d.value))]
  }, [allDropdowns, softwareCol])

  const hasFilters = search.trim() !== '' || statusFilter.length > 0 || softwareFilter.length > 0

  function clearFilters() {
    setSearch('')
    setStatusFilter([])
    setSoftwareFilter([])
  }

  const filteredClients = useMemo(() => {
    return clients.filter(client => {
      if (search.trim() && !clientName(client.id).toLowerCase().includes(search.trim().toLowerCase())) return false
      if (statusFilter.length > 0 && !statusFilter.includes(valueText(trzStatusCol, client.id))) return false
      if (softwareFilter.length > 0 && !softwareFilter.includes(valueText(softwareCol, client.id))) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, search, statusFilter, softwareFilter, allCells, allDropdowns, trzStatusCol, softwareCol])

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  const isFiltered = hasFilters && filteredClients.length !== clients.length
  const missingCols = !vedomostCol || !softwareCol

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Sticky title bar */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <h1 className="text-base md:text-lg font-semibold text-foreground">🧾 ТРЗ</h1>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Търсене..."
              className="h-8 pl-8 pr-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background w-44"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
              <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Изчисти</span>
            </Button>
          )}
        </div>
      </div>

      {missingCols && (
        <div className="px-3 md:px-5 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 dark:bg-amber-900/20 dark:text-amber-300">
          Колоните ВЕДОМОСТ / ТРЗ Софтуер още ги няма — пуснете <code>migration-019-trz.sql</code> в Supabase.
        </div>
      )}

      {/* Filter strip */}
      {(statusOptions.length > 0 || softwareOptions.length > 0) && (
        <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {statusOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">ТРЗ Статус:</span>
              {statusOptions.map(s => {
                const active = statusFilter.includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                    className={`px-2 py-0.5 rounded-full font-semibold transition ${
                      active ? statusBadgeClass(s) : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >{s}</button>
                )
              })}
            </div>
          )}
          {softwareOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">Софтуер:</span>
              {softwareOptions.map(s => {
                const active = softwareFilter.includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => setSoftwareFilter(prev => active ? prev.filter(x => x !== s) : [...prev, s])}
                    className={`px-2 py-0.5 rounded-full font-semibold transition ${
                      active ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >{s}</button>
                )
              })}
            </div>
          )}
          <div className="ml-auto text-muted-foreground">
            {isFiltered ? <>{filteredClients.length} от {clients.length} клиента</> : <>{clients.length} клиента</>}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="bg-navy text-white sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Фирма</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">ТРЗ</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">ТРЗ Статус</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Ведомост</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Софтуер</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-dark/40">
                  {hasFilters ? 'Няма клиенти отговарящи на филтрите' : 'Няма клиенти'}
                </td>
              </tr>
            )}
            {filteredClients.map((client, i) => {
              const status = valueText(trzStatusCol, client.id)
              return (
                <tr
                  key={client.id}
                  className={`border-b border-light/50 ${i % 2 === 0 ? 'bg-card' : 'bg-muted/20'} hover:bg-gold/5 transition-colors`}
                >
                  <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums w-10">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">{clientName(client.id)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {valueText(trzRespCol, client.id) || <span className="text-dark/20">—</span>}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {status
                      ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(status)}`}>{status}</span>
                      : <span className="text-dark/20">—</span>}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {valueText(vedomostCol, client.id) || <span className="text-dark/20">—</span>}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {valueText(softwareCol, client.id) || <span className="text-dark/20">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-navy/5 border-t-2 border-light font-semibold">
            <tr>
              <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums">{filteredClients.length}</td>
              <td className="px-3 py-1.5 text-foreground" colSpan={5}>
                Общо {isFiltered && <span className="text-xs font-normal text-muted-foreground">({filteredClients.length} от {clients.length})</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
