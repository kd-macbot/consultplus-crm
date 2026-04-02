import { useState, useMemo, useEffect } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import type { Column, CellValue, DropdownOption } from '../../lib/types'
import { getColumns, getClients, getCellValues, getDropdownOptions, softDeleteClient } from '../../lib/storage'
import { useAuth } from '../../lib/auth'
import { CellEditor } from './CellEditor'

interface ClientRow {
  clientId: string
  assignedTo?: string
  [columnId: string]: string | number | boolean | undefined
}

interface Props {
  refreshKey: number
  onRefresh: () => void
}

function getCellDisplay(col: Column, cell: CellValue | undefined, dropdowns: DropdownOption[]): string {
  if (!cell) return ''
  if (col.type === 'number') {
    if (cell.value_number == null) return ''
    if (col.name === 'Хонорар') return `${cell.value_number.toLocaleString('bg-BG')} €`
    return cell.value_number.toString()
  }
  if (col.type === 'dropdown') {
    const opt = dropdowns.find(d => d.id === cell.value_dropdown)
    return opt?.value ?? ''
  }
  if (col.type === 'checkbox') return cell.value_bool ? '✓' : ''
  if (col.type === 'date') return cell.value_date ?? ''
  return cell.value_text ?? ''
}

export function DataTable({ refreshKey, onRefresh }: Props) {
  const { user } = useAuth()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [editCell, setEditCell] = useState<{ clientId: string; columnId: string } | null>(null)
  const [loading, setLoading] = useState(true)

  // Async data state
  const [columns, setColumnsState] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [allDropdowns, setAllDropdowns] = useState<DropdownOption[]>([])
  const [allClients, setAllClients] = useState<any[]>([])

  useEffect(() => {
    loadData()
  }, [refreshKey])

  async function loadData() {
    setLoading(true)
    try {
      const [cols, clients, cells, dropdowns] = await Promise.all([
        getColumns(), getClients(), getCellValues(), getDropdownOptions()
      ])
      setColumnsState(cols)
      setAllClients(clients)
      setAllCells(cells)
      setAllDropdowns(dropdowns)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Filter by assignment for employees
  const clients = useMemo(() => {
    if (user?.role === 'employee') {
      return allClients.filter((c: any) => c.assigned_to === user.id)
    }
    return allClients
  }, [allClients, user])

  // Build row data
  const data: ClientRow[] = useMemo(() => {
    return clients.map((client: any) => {
      const row: ClientRow = { clientId: client.id, assignedTo: client.assigned_to }
      const clientCells = allCells.filter(cv => cv.client_id === client.id)
      for (const col of columns) {
        const cell = clientCells.find(cv => cv.column_id === col.id)
        row[col.id] = getCellDisplay(col, cell, allDropdowns)
      }
      return row
    })
  }, [clients, columns, allCells, allDropdowns])

  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const canDelete = user?.role === 'admin'

  const tableColumns: ColumnDef<ClientRow>[] = useMemo(() => {
    const cols: ColumnDef<ClientRow>[] = [
      {
        id: '_index',
        header: '#',
        cell: info => info.row.index + 1,
        size: 50,
        enableSorting: false,
        enableColumnFilter: false,
      },
      ...columns.map((col): ColumnDef<ClientRow> => ({
        id: col.id,
        accessorKey: col.id,
        header: col.name,
        size: col.type === 'number' ? 100 : 180,
        cell: info => {
          const clientId = info.row.original.clientId
          const isEditing = editCell?.clientId === clientId && editCell?.columnId === col.id
          
          if (isEditing && canEdit) {
            const cellData = allCells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
            return (
              <CellEditor
                column={col}
                clientId={clientId}
                cell={cellData}
                onSave={() => { setEditCell(null); onRefresh() }}
                onCancel={() => setEditCell(null)}
              />
            )
          }
          
          const val = info.getValue() as string
          return (
            <div
              className={`truncate ${canEdit ? 'cursor-pointer hover:bg-navy/5 px-1 rounded' : ''}`}
              onClick={() => canEdit && setEditCell({ clientId, columnId: col.id })}
              title={val}
            >
              {val || <span className="text-dark/20">—</span>}
            </div>
          )
        },
        filterFn: 'includesString',
      })),
    ]

    if (canDelete) {
      cols.push({
        id: '_actions',
        header: '',
        size: 60,
        cell: info => (
          <button
            onClick={async () => {
              if (confirm('Изтриване на клиент?')) {
                await softDeleteClient(info.row.original.clientId)
                onRefresh()
              }
            }}
            className="text-red-500 hover:text-red-700 text-xs"
          >
            🗑️
          </button>
        ),
        enableSorting: false,
      })
    }

    return cols
  }, [columns, editCell, canEdit, canDelete, allCells, allDropdowns, onRefresh])

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  })

  if (loading) {
    return <div className="p-6 text-dark/50">Зареждане на данни...</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-4 border-b border-light flex items-center gap-4">
        <input
          type="text"
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="🔍 Търсене..."
          className="px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy w-64"
        />
        <span className="text-sm text-dark/50">
          {table.getFilteredRowModel().rows.length} от {data.length} клиента
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse min-w-[1200px]">
          <thead className="bg-navy text-white sticky top-0 z-10">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
            {/* Column filters */}
            <tr className="bg-navy-light">
              {table.getHeaderGroups()[0]?.headers.map(header => (
                <th key={header.id + '_filter'} className="px-2 py-1">
                  {header.column.getCanFilter() ? (
                    <input
                      type="text"
                      value={(header.column.getFilterValue() as string) ?? ''}
                      onChange={e => header.column.setFilterValue(e.target.value)}
                      placeholder="Филтър..."
                      className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white/90 text-dark placeholder-dark/30 focus:outline-none"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr key={row.id} className={`border-b border-light/50 ${i % 2 === 0 ? 'bg-white' : 'bg-light/30'} hover:bg-gold/5 transition-colors`}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-1.5 text-sm" style={{ maxWidth: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-light flex items-center justify-between bg-white text-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="px-3 py-1 rounded border border-light disabled:opacity-30 hover:bg-light transition">
            ← Назад
          </button>
          <span className="text-dark/60">
            Страница {table.getState().pagination.pageIndex + 1} от {table.getPageCount()}
          </span>
          <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="px-3 py-1 rounded border border-light disabled:opacity-30 hover:bg-light transition">
            Напред →
          </button>
        </div>
        <select
          value={table.getState().pagination.pageSize}
          onChange={e => table.setPageSize(Number(e.target.value))}
          className="px-2 py-1 border border-light rounded text-sm"
        >
          {[25, 50, 100, 200].map(size => (
            <option key={size} value={size}>Покажи {size}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
