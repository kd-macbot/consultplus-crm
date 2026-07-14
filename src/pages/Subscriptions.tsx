import { useState, useEffect, useMemo } from 'react'
import { addColumn, deleteColumn } from '../lib/storage'
import { useClients, useColumns, useCellValues, useDropdownOptions, useInvalidateCrm, qk } from '../lib/queries'
import { queryClient } from '../lib/queryClient'
import { CellEditor } from '../components/table/CellEditor'
import { useAuth } from '../lib/auth'
import type { Column, ColumnType, CellValue, Client } from '../lib/types'
import {
  buildCellIndex, buildDropdownIndex, cellKey,
  clientDisplayName, resolveDropdownText, resolveNumber,
} from '../lib/tableIndices'
import { statusBadgeClass } from '../lib/statusBadge'
import { type AmountBucket, BUCKET_LABEL, inBucket } from '../lib/subscriptionBuckets'
import { exportRowsToExcel } from '../lib/export'
import { Plus, Search, X, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

const SUB_MARKER = '__sub__'

/** Стойност на клетка за Excel: числата остават числа, останалото — текст. */
function exportCellValue(col: Column, cell?: CellValue): string | number {
  if (!cell) return ''
  if (col.type === 'number') return cell.value_number ?? ''
  if (col.type === 'checkbox') return cell.value_bool ? 'Да' : 'Не'
  if (col.type === 'date') return cell.value_date ?? ''
  return cell.value_text ?? ''
}

export function SubscriptionsPage() {
  const { user } = useAuth()
  // Master данните идват от споделения React Query кеш — повторно отваряне
  // на страницата е МИГНОВЕНО (без fetch, кешираните данни от localStorage).
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const { invalidateColumns, invalidateCells } = useInvalidateCrm()

  const allClients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const allColumns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const allCells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const allDropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])
  const loading = !clientsQ.data || !columnsQ.data || !cellsQ.data || !dropdownsQ.data

  const [editCell, setEditCell] = useState<{ clientId: string; columnId: string } | null>(null)
  const [showAddCol, setShowAddCol] = useState(false)
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<Column | null>(null)
  const [search, setSearch] = useState('')
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [amountBucket, setAmountBucket] = useState<AmountBucket>('all')
  const [markedClients, setMarkedClients] = useState<Set<string>>(new Set())

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  // refresh: след добавяне/изтриване на колона → invalidate, без full reload.
  async function refresh() {
    await Promise.all([invalidateColumns(), invalidateCells()])
  }

  // O(1) индекси — изграждат се веднъж при промяна на данните.
  const cellIdx = useMemo(() => buildCellIndex(allCells), [allCells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(allDropdowns), [allDropdowns])

  const clients = useMemo(() => {
    const sorted = user?.role === 'employee'
      ? allClients.filter(c => c.assigned_to === user.id)
      : [...allClients]
    return sorted.sort((a, b) =>
      (clientDisplayName(a.id, allColumns, cellIdx) || a.id)
        .localeCompare(clientDisplayName(b.id, allColumns, cellIdx) || b.id, 'bg')
    )
  }, [allClients, allColumns, cellIdx, user])

  const honorarColumn = useMemo(() => allColumns.find(c => c.name === 'Хонорар'), [allColumns])
  const statusColumn = useMemo(() => allColumns.find(c => c.name === 'Статус'), [allColumns])
  const subColumns = useMemo(() => allColumns.filter(c => c.staff_department === SUB_MARKER), [allColumns])

  function clientStatus(clientId: string): string {
    return resolveDropdownText(clientId, statusColumn, cellIdx, dropdownIdx)
  }

  function clientHonorar(clientId: string): number {
    return resolveNumber(clientId, honorarColumn, cellIdx) ?? 0
  }

  const statusOptions = useMemo(() => {
    if (!statusColumn) return [] as string[]
    return [...new Set(allDropdowns.filter(d => d.column_id === statusColumn.id).map(d => d.value))]
  }, [allDropdowns, statusColumn])

  const tableColumns = useMemo(() => {
    const cols: Column[] = []
    if (honorarColumn) cols.push(honorarColumn)
    cols.push(...subColumns)
    return cols
  }, [honorarColumn, subColumns])

  function clientName(clientId: string): string {
    return clientDisplayName(clientId, allColumns, cellIdx) || clientId.slice(0, 8)
  }

  function getCell(clientId: string, columnId: string): CellValue | undefined {
    return cellIdx.get(cellKey(clientId, columnId))
  }

  function displayCell(col: Column, cell?: CellValue): string {
    if (!cell) return ''
    if (col.type === 'number') return cell.value_number != null ? cell.value_number.toLocaleString('bg-BG', { minimumFractionDigits: 2 }) : ''
    if (col.type === 'checkbox') return cell.value_bool ? '✓' : ''
    if (col.type === 'date') return cell.value_date ?? ''
    return cell.value_text ?? ''
  }

  const hasFilters = search.trim() !== '' || Object.values(colFilters).some(v => v !== '') || statusFilter.length > 0 || amountBucket !== 'all'

  function clearFilters() {
    setSearch('')
    setColFilters({})
    setStatusFilter([])
    setAmountBucket('all')
  }

  function setColFilter(colId: string, value: string) {
    setColFilters(prev => ({ ...prev, [colId]: value }))
  }

  const filteredClients = useMemo(() => {
    return clients.filter(client => {
      const name = clientName(client.id)

      if (search.trim() && !name.toLowerCase().includes(search.trim().toLowerCase())) return false

      // Статус филтър
      if (statusFilter.length > 0) {
        const s = clientStatus(client.id)
        if (!statusFilter.includes(s)) return false
      }

      // Bucket филтър по хонорар
      if (amountBucket !== 'all') {
        if (!inBucket(clientHonorar(client.id), amountBucket)) return false
      }

      for (const [colId, filterVal] of Object.entries(colFilters)) {
        if (!filterVal) continue
        const col = tableColumns.find(c => c.id === colId)
        if (!col) continue
        const cell = getCell(client.id, colId)

        if (col.type === 'checkbox') {
          const checked = cell?.value_bool ?? false
          if (filterVal === 'true' && !checked) return false
          if (filterVal === 'false' && checked) return false
        } else {
          const display = displayCell(col, cell)
          if (!display.toLowerCase().includes(filterVal.toLowerCase())) return false
        }
      }
      return true
    })
  }, [clients, search, colFilters, tableColumns, allCells, statusFilter, amountBucket, statusColumn, honorarColumn, allDropdowns])

  const totalHonorar = useMemo(() => {
    if (!honorarColumn) return 0
    return clients.reduce((sum, c) => sum + (resolveNumber(c.id, honorarColumn, cellIdx) ?? 0), 0)
  }, [clients, cellIdx, honorarColumn])

  const filteredTotalHonorar = useMemo(() => {
    if (!honorarColumn) return 0
    return filteredClients.reduce((sum, c) => sum + (resolveNumber(c.id, honorarColumn, cellIdx) ?? 0), 0)
  }, [filteredClients, cellIdx, honorarColumn])

  function toggleClient(clientId: string) {
    setMarkedClients(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  // Сбор на хонорара на маркираните клиенти.
  const markedSum = useMemo(() => {
    if (!honorarColumn) return 0
    let s = 0
    for (const c of clients) {
      if (markedClients.has(c.id)) s += resolveNumber(c.id, honorarColumn, cellIdx) ?? 0
    }
    return s
  }, [markedClients, clients, cellIdx, honorarColumn])

  // Остатък = общият Хонорар (всички клиенти) минус маркираните клиенти.
  const remainingHonorar = totalHonorar - markedSum

  // Чекбоксът в хедъра маркира/размаркира всички видими (филтрирани) клиенти.
  const allFilteredMarked = filteredClients.length > 0 && filteredClients.every(c => markedClients.has(c.id))
  function toggleAllFiltered() {
    setMarkedClients(prev => {
      const next = new Set(prev)
      if (allFilteredMarked) filteredClients.forEach(c => next.delete(c.id))
      else filteredClients.forEach(c => next.add(c.id))
      return next
    })
  }

  async function exportRows(rowsClients: Client[], suffix: string) {
    if (rowsClients.length === 0) { toast.error('Няма редове за експорт'); return }
    const headers = ['Клиент', ...(statusColumn ? ['Статус'] : []), ...tableColumns.map(c => c.name)]
    const rows: (string | number)[][] = rowsClients.map(c => {
      const row: (string | number)[] = [clientName(c.id)]
      if (statusColumn) row.push(clientStatus(c.id))
      for (const col of tableColumns) row.push(exportCellValue(col, getCell(c.id, col.id)))
      return row
    })
    // Финален ред „Общо" със сбора на хонорара (както в таблицата).
    if (honorarColumn) {
      const sum = rowsClients.reduce((s, c) => s + (resolveNumber(c.id, honorarColumn, cellIdx) ?? 0), 0)
      const totalRow: (string | number)[] = [`Общо (${rowsClients.length})`]
      if (statusColumn) totalRow.push('')
      for (const col of tableColumns) totalRow.push(col.id === honorarColumn.id ? sum : '')
      rows.push(totalRow)
    }
    const date = new Date().toISOString().slice(0, 10)
    try {
      await exportRowsToExcel({
        headers, rows,
        sheetName: 'Абонаменти',
        fileName: `ConsultPlus_Абонаменти${suffix}_${date}.xlsx`,
      })
      toast.success(`Експортирани ${rowsClients.length} реда`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при експорт')
    }
  }

  async function handleAddColumn(name: string, type: ColumnType) {
    await addColumn(name, type, false, user?.id, { userId: user?.id, userName: user?.full_name ?? '' }, SUB_MARKER)
    setShowAddCol(false)
    toast.success(`Колона "${name}" е добавена`)
    await refresh()
  }

  async function handleDeleteColumn(col: Column) {
    await deleteColumn(col.id, { userId: user?.id, userName: user?.full_name ?? '', columnName: col.name })
    setConfirmDeleteCol(null)
    setColFilter(col.id, '')
    toast.success(`Колона "${col.name}" е изтрита`)
    await refresh()
  }

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  const isFiltered = hasFilters && filteredClients.length !== clients.length

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      {/* Sticky title bar — както в Клиенти */}
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <h1 className="text-base md:text-lg font-semibold text-foreground">💶 Абонаменти</h1>
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
          <Button variant="outline" size="sm" onClick={() => exportRows(filteredClients, isFiltered ? '_филтрирани' : '')} className="gap-1">
            <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Експорт</span>
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAddCol(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Колона</span>
            </Button>
          )}
        </div>
      </div>

      {/* Summary strip (компактен под title bar-а) */}
      <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">
            {isFiltered ? `Филтр. хонорари (${filteredClients.length}/${clients.length})` : 'Общо хонорари'}
          </span>
          <span className="font-bold text-green-600">
            {filteredTotalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
          </span>
          {isFiltered && (
            <span className="text-xs text-muted-foreground ml-2">
              (всичко: {totalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €)
            </span>
          )}
        </div>

        {markedClients.size > 0 && (
          <div className="flex flex-wrap items-center gap-4 pl-4 border-l border-border">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">
                Маркирани ({markedClients.size})
              </span>
              <span className="font-bold text-amber-600">
                {markedSum.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">
                Остатък от хонорара
              </span>
              <span className={`font-bold ${remainingHonorar < 0 ? 'text-red-600' : 'text-foreground'}`}>
                {remainingHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
              </span>
            </div>
            <button
              onClick={() => exportRows(clients.filter(c => markedClients.has(c.id)), '_маркирани')}
              className="text-xs text-amber-600 hover:text-amber-700 underline"
            >
              експорт
            </button>
            <button
              onClick={() => setMarkedClients(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              изчисти
            </button>
          </div>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {isFiltered ? <>{filteredClients.length} от {clients.length} клиента</> : <>{clients.length} клиента</>}
        </div>
      </div>

      {/* Status + Amount filter strip */}
      {(statusOptions.length > 0 || honorarColumn) && (
        <div className="px-3 md:px-5 py-2 border-b border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {statusOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">Статус:</span>
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
          {honorarColumn && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wider font-semibold">Хонорар:</span>
              {(['all', 'zero', 'low', 'mid', 'high'] as AmountBucket[]).map(b => (
                <button
                  key={b}
                  onClick={() => setAmountBucket(b)}
                  className={`px-2 py-0.5 rounded-full font-semibold transition ${
                    amountBucket === b ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >{BUCKET_LABEL[b]}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table — full height scrollable */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="bg-navy text-white sticky top-0 z-10">
            {/* Main header */}
            <tr>
              <th className="px-2 py-2 text-center w-9">
                <input
                  type="checkbox"
                  checked={allFilteredMarked}
                  onChange={toggleAllFiltered}
                  title="Маркирай всички видими"
                  className="h-3.5 w-3.5 cursor-pointer accent-amber-500 align-middle"
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Клиент</th>
              {statusColumn && (
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">Статус</th>
              )}
              {tableColumns.map(col => (
                <th key={col.id} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span>{col.name}</span>
                    {isAdmin && col.staff_department === SUB_MARKER && (
                      <button
                        onClick={() => setConfirmDeleteCol(col)}
                        className="text-white/50 hover:text-white ml-1 text-base leading-none"
                        title="Изтрий колона"
                      >×</button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
            {/* Filter row */}
            <tr className="bg-navy-light">
              <th className="px-2 py-1" />
              <th className="px-2 py-1" />
              <th className="px-2 py-1">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Филтър..."
                  className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 placeholder:text-slate-500 focus:outline-none"
                />
              </th>
              {statusColumn && <th className="px-2 py-1" />}
              {tableColumns.map(col => (
                <th key={col.id + '_f'} className="px-2 py-1">
                  {col.type === 'checkbox' ? (
                    <select
                      value={colFilters[col.id] ?? ''}
                      onChange={e => setColFilter(col.id, e.target.value)}
                      className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 focus:outline-none"
                    >
                      <option value="">Всички</option>
                      <option value="true">✓ Отметнати</option>
                      <option value="false">— Без отметка</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={colFilters[col.id] ?? ''}
                      onChange={e => setColFilter(col.id, e.target.value)}
                      placeholder="Филтър..."
                      className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 placeholder:text-slate-500 focus:outline-none"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={tableColumns.length + 3 + (statusColumn ? 1 : 0)} className="px-4 py-8 text-center text-dark/40">
                  {hasFilters ? 'Няма клиенти отговарящи на филтрите' : 'Няма клиенти'}
                </td>
              </tr>
            )}
            {filteredClients.map((client, i) => {
              const marked = markedClients.has(client.id)
              return (
              <tr
                key={client.id}
                className={`border-b border-border ${marked ? 'bg-amber-100/60 dark:bg-amber-900/20' : i % 2 === 0 ? 'bg-card' : 'bg-muted/20'} hover:bg-gold/5 transition-colors`}
              >
                <td className="px-2 py-2 text-center w-9">
                  <input
                    type="checkbox"
                    checked={marked}
                    onChange={() => toggleClient(client.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-amber-500 align-middle"
                  />
                </td>
                <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums w-10">
                  {i + 1}
                </td>
                <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">
                  {clientName(client.id)}
                </td>
                {statusColumn && (
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {(() => {
                      const s = clientStatus(client.id)
                      return s ? (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(s)}`}>{s}</span>
                      ) : <span className="text-dark/20">—</span>
                    })()}
                  </td>
                )}
                {tableColumns.map(col => {
                  const cell = getCell(client.id, col.id)
                  const isEditing = editCell?.clientId === client.id && editCell?.columnId === col.id

                  if (isEditing && canEdit) {
                    return (
                      <td key={col.id} className="px-2 py-1">
                        <CellEditor
                          column={col}
                          clientId={client.id}
                          clientName={clientName(client.id)}
                          cell={cell}
                          oldDisplay={displayCell(col, cell)}
                          onSave={(patch) => {
                            setEditCell(null)
                            // Оптимистичен update в споделения React Query кеш
                            // → всички страници (Dashboard, Клиенти, …) виждат веднага.
                            queryClient.setQueryData<CellValue[]>(qk.cells, (prev) => {
                              if (!prev) return prev
                              const idx = prev.findIndex(cv => cv.client_id === client.id && cv.column_id === col.id)
                              if (idx >= 0) return prev.map((cv, i) => i === idx ? { ...cv, ...patch } : cv)
                              return [...prev, { id: '', client_id: client.id, column_id: col.id, ...patch } as CellValue]
                            })
                          }}
                          onCancel={() => setEditCell(null)}
                        />
                      </td>
                    )
                  }

                  const display = displayCell(col, cell)
                  return (
                    <td
                      key={col.id}
                      className={`px-3 py-1.5 ${canEdit ? 'cursor-pointer hover:bg-navy/5 rounded' : ''}`}
                      onClick={() => canEdit && setEditCell({ clientId: client.id, columnId: col.id })}
                    >
                      {col.type === 'number' && cell?.value_number != null
                        ? <span className="font-medium text-foreground">{display} €</span>
                        : display || <span className="text-dark/20">—</span>
                      }
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-navy/5 border-t-2 border-border font-semibold">
            <tr>
              <td className="px-2 py-2" />
              <td className="px-3 py-2 text-dark/30 text-xs text-right tabular-nums">
                {filteredClients.length}
              </td>
              <td className="px-3 py-1.5 text-foreground font-semibold">
                Общо {isFiltered && <span className="text-xs font-normal text-muted-foreground">({filteredClients.length} от {clients.length})</span>}
              </td>
              {statusColumn && <td />}
              {tableColumns.map(col => (
                <td key={col.id} className="px-3 py-1.5">
                  {col.id === honorarColumn?.id
                    ? <span className="text-green-600 font-semibold">{filteredTotalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €</span>
                    : ''
                  }
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <AddColumnModal open={showAddCol} onAdd={handleAddColumn} onClose={() => setShowAddCol(false)} />

      <ConfirmDialog
        open={!!confirmDeleteCol}
        title={`Изтриване на колона "${confirmDeleteCol?.name}"?`}
        description="Всички данни в тази колона ще бъдат загубени."
        confirmLabel="Изтрий"
        destructive
        onConfirm={() => confirmDeleteCol && handleDeleteColumn(confirmDeleteCol)}
        onCancel={() => setConfirmDeleteCol(null)}
      />
    </div>
  )
}

function AddColumnModal({
  open,
  onAdd,
  onClose,
}: {
  open: boolean
  onAdd: (name: string, type: ColumnType) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ColumnType>('text')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) { setName(''); setType('text') } }, [open])

  async function handleSubmit() {
    if (!name.trim()) return
    setSaving(true)
    try { await onAdd(name.trim(), type) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Нова колона</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Наименование *</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoFocus
              placeholder="напр. ДДС регистрация..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Тип</Label>
            <select
              value={type}
              onChange={e => setType(e.target.value as ColumnType)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="text">Текст</option>
              <option value="number">Число</option>
              <option value="date">Дата</option>
              <option value="checkbox">Отметка</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отказ</Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? 'Добавяне...' : 'Добави'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
