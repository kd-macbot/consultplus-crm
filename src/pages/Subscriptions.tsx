import { useState, useEffect, useMemo } from 'react'
import { getColumns, getCellValues, getClients, addColumn, deleteColumn } from '../lib/storage'
import { CellEditor } from '../components/table/CellEditor'
import { useAuth } from '../lib/auth'
import type { Column, CellValue, Client, ColumnType } from '../lib/types'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const SUB_MARKER = '__sub__'

export function SubscriptionsPage() {
  const { user } = useAuth()
  const [allClients, setAllClients] = useState<Client[]>([])
  const [allColumns, setAllColumns] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [loading, setLoading] = useState(true)
  const [editCell, setEditCell] = useState<{ clientId: string; columnId: string } | null>(null)
  const [showAddCol, setShowAddCol] = useState(false)

  const isAdmin = user?.role === 'admin'
  const canEdit = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [cls, cols, cells] = await Promise.all([
        getClients(), getColumns(), getCellValues()
      ])
      setAllClients(cls)
      setAllColumns(cols)
      setAllCells(cells)
    } finally {
      setLoading(false)
    }
  }

  const clients = useMemo(() => {
    const sorted = user?.role === 'employee'
      ? allClients.filter(c => c.assigned_to === user.id)
      : [...allClients]
    return sorted.sort((a, b) => clientName(a.id, allColumns, allCells).localeCompare(clientName(b.id, allColumns, allCells), 'bg'))
  }, [allClients, allColumns, allCells, user])

  const nameColumn = useMemo(() => allColumns.find(c => c.type === 'text'), [allColumns])
  const honorarColumn = useMemo(() => allColumns.find(c => c.name === 'Хонорар'), [allColumns])
  const subColumns = useMemo(() => allColumns.filter(c => c.staff_department === SUB_MARKER), [allColumns])

  const tableColumns = useMemo(() => {
    const cols: Column[] = []
    if (honorarColumn) cols.push(honorarColumn)
    cols.push(...subColumns)
    return cols
  }, [honorarColumn, subColumns])

  function clientName(clientId: string, cols = allColumns, cells = allCells): string {
    const nc = cols.find(c => c.type === 'text')
    if (!nc) return clientId.slice(0, 8)
    const cell = cells.find(cv => cv.client_id === clientId && cv.column_id === nc.id)
    return cell?.value_text || clientId.slice(0, 8)
  }

  function getCell(clientId: string, columnId: string): CellValue | undefined {
    return allCells.find(cv => cv.client_id === clientId && cv.column_id === columnId)
  }

  function displayCell(col: Column, cell?: CellValue): string {
    if (!cell) return ''
    if (col.type === 'number') return cell.value_number != null ? cell.value_number.toLocaleString('bg-BG', { minimumFractionDigits: 2 }) : ''
    if (col.type === 'checkbox') return cell.value_bool ? '✓' : ''
    if (col.type === 'date') return cell.value_date ?? ''
    return cell.value_text ?? ''
  }

  const totalHonorar = useMemo(() => {
    if (!honorarColumn) return 0
    return clients.reduce((sum, c) => {
      const cell = allCells.find(cv => cv.client_id === c.id && cv.column_id === honorarColumn.id)
      return sum + (cell?.value_number ?? 0)
    }, 0)
  }, [clients, allCells, honorarColumn])

  async function handleAddColumn(name: string, type: ColumnType) {
    await addColumn(name, type, false, user?.id, { userId: user?.id, userName: user?.full_name ?? '' }, SUB_MARKER)
    setShowAddCol(false)
    await loadData()
  }

  async function handleDeleteColumn(col: Column) {
    if (!confirm(`Изтриване на колона "${col.name}"?`)) return
    await deleteColumn(col.id, { userId: user?.id, userName: user?.full_name ?? '', columnName: col.name })
    await loadData()
  }

  if (loading) return <div className="p-6 text-dark/50">Зареждане...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-navy">💶 Абонаменти</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowAddCol(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Добави колона</span>
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-sm text-dark/50">Общо хонорари</p>
          <p className="text-2xl font-bold text-green-600">
            {totalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-navy">
          <p className="text-sm text-dark/50">Брой клиенти</p>
          <p className="text-2xl font-bold text-navy">{clients.length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-navy text-white">
              <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Клиент</th>
              {tableColumns.map(col => (
                <th key={col.id} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span>{col.name}</span>
                    {isAdmin && col.staff_department === SUB_MARKER && (
                      <button
                        onClick={() => handleDeleteColumn(col)}
                        className="text-white/50 hover:text-white ml-1 text-base leading-none"
                        title="Изтрий колона"
                      >×</button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={tableColumns.length + 1} className="px-4 py-8 text-center text-dark/40">
                  Няма клиенти
                </td>
              </tr>
            )}
            {clients.map((client, i) => (
              <tr
                key={client.id}
                className={`border-b border-light/50 ${i % 2 === 0 ? 'bg-white' : 'bg-light/20'} hover:bg-gold/5 transition-colors`}
              >
                <td className="px-4 py-2 font-medium text-navy whitespace-nowrap">
                  {clientName(client.id)}
                </td>
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
                          onSave={() => { setEditCell(null); loadData() }}
                          onCancel={() => setEditCell(null)}
                        />
                      </td>
                    )
                  }

                  const display = displayCell(col, cell)
                  return (
                    <td
                      key={col.id}
                      className={`px-4 py-2 ${canEdit ? 'cursor-pointer hover:bg-navy/5 rounded' : ''}`}
                      onClick={() => canEdit && setEditCell({ clientId: client.id, columnId: col.id })}
                    >
                      {col.type === 'number' && cell?.value_number != null
                        ? <span className="font-medium">{display} €</span>
                        : display || <span className="text-dark/20">—</span>
                      }
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-navy/5 border-t-2 border-light font-semibold">
            <tr>
              <td className="px-4 py-2 text-navy">Общо</td>
              {tableColumns.map(col => (
                <td key={col.id} className="px-4 py-2">
                  {col.id === honorarColumn?.id
                    ? <span>{totalHonorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €</span>
                    : ''
                  }
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <AddColumnModal open={showAddCol} onAdd={handleAddColumn} onClose={() => setShowAddCol(false)} />
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
