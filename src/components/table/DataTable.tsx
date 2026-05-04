import { useState, useMemo, useEffect, useRef } from 'react'
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
  type Header,
} from '@tanstack/react-table'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { Column, CellValue, DropdownOption, Tag, ClientTag, Client } from '../../lib/types'
import { getColumns, getClients, getCellValues, getDropdownOptions, softDeleteClient, getTags, getClientTags, updateColumnPositions } from '../../lib/storage'
import { useAuth } from '../../lib/auth'
import { toast } from 'sonner'
import { CellEditor } from './CellEditor'
import { TagEditor } from '../tags/TagEditor'
import { ConfirmDialog } from '@/components/ui/alert-dialog'

const DROPDOWN_STATUS_COLORS: Record<string, string> = {
  'Активна': '#16a34a',
  'Нулево': '#2563eb',
  'БЕЗ ДДС': '#ca8a04',
  'без дейност': '#6b7280',
}

interface ClientRow {
  clientId: string
  clientName: string
  assignedTo?: string
  tagIds: string[]
  [columnId: string]: string | number | boolean | string[] | undefined
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
    if (col.staff_department) return cell.value_text ?? ''
    const opt = dropdowns.find(d => d.id === cell.value_dropdown)
    return opt?.value ?? ''
  }
  if (col.type === 'checkbox') return cell.value_bool ? '✓' : ''
  if (col.type === 'date') return cell.value_date ?? ''
  return cell.value_text ?? ''
}

function resolveClientName(clientId: string, columns: Column[], allCells: CellValue[]): string {
  const clientCells = allCells.filter(cv => cv.client_id === clientId)
  for (const col of columns) {
    if (col.type === 'text') {
      const cell = clientCells.find(cv => cv.column_id === col.id)
      if (cell?.value_text) return cell.value_text
    }
  }
  return ''
}

function DraggableHeader({ header }: { header: Header<ClientRow, unknown> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: header.id })

  return (
    <th
      ref={setNodeRef}
      style={{
        width: header.getSize(),
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
      }}
      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap select-none"
    >
      <div className="flex items-center gap-1">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/70 shrink-0 touch-none"
          title="Влачи за да размести"
        >
          <GripVertical className="h-3 w-3" />
        </span>
        <div
          className="flex items-center gap-1 cursor-pointer"
          onClick={header.column.getToggleSortingHandler()}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
        </div>
      </div>
    </th>
  )
}

export function DataTable({ refreshKey, onRefresh }: Props) {
  const { user } = useAuth()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [editCell, setEditCell] = useState<{ clientId: string; columnId: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [columnOrder, setColumnOrder] = useState<string[]>([])

  const [columns, setColumnsState] = useState<Column[]>([])
  const [allCells, setAllCells] = useState<CellValue[]>([])
  const [allDropdowns, setAllDropdowns] = useState<DropdownOption[]>([])
  const [allClients, setAllClients] = useState<Client[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [allClientTags, setAllClientTags] = useState<ClientTag[]>([])
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<ClientRow | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScrollPos = useRef<{ top: number; left: number } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => { loadData() }, [refreshKey])

  useEffect(() => {
    if (!loading && savedScrollPos.current && scrollRef.current) {
      scrollRef.current.scrollTop = savedScrollPos.current.top
      scrollRef.current.scrollLeft = savedScrollPos.current.left
      savedScrollPos.current = null
    }
  }, [loading])

  async function loadData() {
    if (scrollRef.current) {
      savedScrollPos.current = {
        top: scrollRef.current.scrollTop,
        left: scrollRef.current.scrollLeft,
      }
    }
    setLoading(true)
    try {
      const [cols, clients, cells, dropdowns, tags, clientTags] = await Promise.all([
        getColumns(), getClients(), getCellValues(), getDropdownOptions(), getTags(), getClientTags()
      ])
      const filtered = cols.filter((c: Column) => c.name !== 'Хонорар' && c.staff_department !== '__sub__')
      setColumnsState(filtered)
      setColumnOrder(filtered.map((c: Column) => c.id))
      setAllClients(clients)
      setAllCells(cells)
      setAllDropdowns(dropdowns)
      setAllTags(tags)
      setAllClientTags(clientTags)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = columnOrder.indexOf(active.id as string)
    const newIndex = columnOrder.indexOf(over.id as string)
    const newOrder = arrayMove(columnOrder, oldIndex, newIndex)
    setColumnOrder(newOrder)

    try {
      await updateColumnPositions(newOrder)
    } catch {
      setColumnOrder(columnOrder)
      toast.error('Грешка при записване на реда')
    }
  }

  const clients = useMemo(() => {
    if (user?.role === 'employee') {
      return allClients.filter(c => c.assigned_to === user.id)
    }
    return allClients
  }, [allClients, user])

  const orderedColumns = useMemo(() => {
    return columnOrder
      .map(id => columns.find(c => c.id === id))
      .filter((c): c is Column => !!c)
  }, [columnOrder, columns])

  const data: ClientRow[] = useMemo(() => {
    return clients.map(client => {
      const row: ClientRow = {
        clientId: client.id,
        clientName: resolveClientName(client.id, columns, allCells),
        assignedTo: client.assigned_to,
        tagIds: allClientTags.filter(ct => ct.client_id === client.id).map(ct => ct.tag_id),
      }
      const clientCells = allCells.filter(cv => cv.client_id === client.id)
      for (const col of columns) {
        const cell = clientCells.find(cv => cv.column_id === col.id)
        row[col.id] = getCellDisplay(col, cell, allDropdowns)
      }
      return row
    })
  }, [clients, columns, allCells, allDropdowns, allClientTags])

  const filteredByTags = useMemo(() => {
    if (tagFilter.length === 0) return data
    return data.filter(row => tagFilter.some(tid => row.tagIds.includes(tid)))
  }, [data, tagFilter])

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
      ...orderedColumns.map((col): ColumnDef<ClientRow> => ({
        id: col.id,
        accessorKey: col.id,
        header: col.name,
        size: col.type === 'number' ? 100 : 180,
        cell: info => {
          const clientId = info.row.original.clientId
          const clientName = info.row.original.clientName
          const isEditing = editCell?.clientId === clientId && editCell?.columnId === col.id

          if (isEditing && canEdit) {
            const cellData = allCells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
            const oldDisplay = getCellDisplay(col, cellData, allDropdowns)
            return (
              <CellEditor
                column={col}
                clientId={clientId}
                clientName={clientName}
                cell={cellData}
                oldDisplay={oldDisplay}
                onSave={() => { setEditCell(null); onRefresh() }}
                onCancel={() => setEditCell(null)}
              />
            )
          }

          const val = info.getValue() as string

          if (col.type === 'dropdown' && !col.staff_department) {
            const cellData = allCells.find(cv => cv.client_id === clientId && cv.column_id === col.id)
            const opt = allDropdowns.find(d => d.id === cellData?.value_dropdown)
            const color = opt?.color || DROPDOWN_STATUS_COLORS[val]
            return (
              <div
                className={canEdit ? 'cursor-pointer' : ''}
                onClick={() => canEdit && setEditCell({ clientId, columnId: col.id })}
              >
                {val ? (
                  color ? (
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                      style={{ backgroundColor: color + '22', color }}
                    >
                      {val}
                    </span>
                  ) : (
                    <span className="text-dark/70 text-sm">{val}</span>
                  )
                ) : (
                  <span className="text-dark/20">—</span>
                )}
              </div>
            )
          }

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
        filterFn: col.type === 'dropdown'
          ? (row, columnId, filterValue) => {
              const cellVal = row.getValue(columnId) as string
              if (filterValue === '__empty__') return !cellVal
              return cellVal === filterValue
            }
          : 'includesString',
      })),
      {
        id: '_tags',
        header: 'Тагове',
        size: 180,
        enableSorting: false,
        enableColumnFilter: false,
        cell: info => {
          const row = info.row.original
          const assigned = allTags.filter(t => row.tagIds.includes(t.id))
          return (
            <TagEditor
              clientId={row.clientId}
              clientName={row.clientName}
              assignedTags={assigned}
              allTags={allTags}
              onUpdate={onRefresh}
            />
          )
        },
      },
    ]

    if (canDelete) {
      cols.push({
        id: '_actions',
        header: '',
        size: 60,
        cell: info => (
          <button
            onClick={() => setConfirmDeleteRow(info.row.original)}
            className="text-red-500 hover:text-red-700 text-xs"
          >
            🗑️
          </button>
        ),
        enableSorting: false,
      })
    }

    return cols
  }, [orderedColumns, editCell, canEdit, canDelete, allCells, allDropdowns, allTags, allClientTags, onRefresh, user])

  const fullColumnOrder = useMemo(
    () => ['_index', ...columnOrder, '_tags', ...(canDelete ? ['_actions'] : [])],
    [columnOrder, canDelete]
  )

  const table = useReactTable({
    data: filteredByTags,
    columns: tableColumns,
    state: { sorting, columnFilters, globalFilter, columnOrder: fullColumnOrder },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnOrderChange: () => {},
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
      {/* Search + Tag Filter */}
      <div className="p-3 md:p-4 border-b border-light flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="🔍 Търсене..."
          className="px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy w-full sm:w-64"
        />
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-dark/40">Тагове:</span>
            {allTags.map(tag => {
              const active = tagFilter.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  onClick={() => {
                    setTagFilter(prev =>
                      active ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
                    )
                  }}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium transition ${
                    active ? 'text-white ring-2 ring-navy' : 'opacity-50 hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: active ? tag.color : 'transparent',
                    color: active ? 'white' : tag.color,
                    border: active ? 'none' : `1.5px solid ${tag.color}`,
                  }}
                >
                  {tag.name}
                </button>
              )
            })}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])} className="text-xs text-red-400 hover:text-red-600 ml-1">✕</button>
            )}
          </div>
        )}
        <span className="text-sm text-dark/50 ml-auto">
          {table.getFilteredRowModel().rows.length} от {filteredByTags.length} клиента
        </span>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="w-full border-collapse min-w-[1200px]">
            <thead className="bg-navy text-white sticky top-0 z-10">
              {/* Main header row */}
              <tr>
                <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                  {table.getHeaderGroups()[0]?.headers.map(header => {
                    if (columnOrder.includes(header.id)) {
                      return <DraggableHeader key={header.id} header={header} />
                    }
                    return (
                      <th
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1 cursor-pointer select-none">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                        </div>
                      </th>
                    )
                  })}
                </SortableContext>
              </tr>

              {/* Filter row */}
              <tr className="bg-navy-light">
                {table.getHeaderGroups()[0]?.headers.map(header => {
                  const col = columns.find(c => c.id === header.id)
                  const isDropdown = col?.type === 'dropdown'
                  const dropdownVals = isDropdown
                    ? [...new Set(
                        filteredByTags.map(row => row[header.id] as string).filter(Boolean)
                      )].sort()
                    : []

                  return (
                    <th key={header.id + '_filter'} className="px-2 py-1">
                      {header.column.getCanFilter() ? (
                        isDropdown ? (
                          <select
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={e => header.column.setFilterValue(e.target.value || undefined)}
                            className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white/90 text-dark focus:outline-none"
                          >
                            <option value="">Всички</option>
                            <option value="__empty__">(Празно)</option>
                            {dropdownVals.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={e => header.column.setFilterValue(e.target.value)}
                            placeholder="Филтър..."
                            className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white/90 text-dark placeholder-dark/30 focus:outline-none"
                          />
                        )
                      ) : null}
                    </th>
                  )
                })}
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
        </DndContext>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteRow}
        title={`Изтриване на клиент "${confirmDeleteRow?.clientName}"?`}
        description="Клиентът ще бъде скрит от системата. Операцията е обратима само от администратор."
        confirmLabel="Изтрий"
        destructive
        onConfirm={async () => {
          if (!confirmDeleteRow) return
          await softDeleteClient(confirmDeleteRow.clientId, {
            userId: user?.id,
            userName: user?.full_name ?? '',
            clientName: confirmDeleteRow.clientName,
          })
          setConfirmDeleteRow(null)
          toast.success(`Клиент "${confirmDeleteRow.clientName}" е изтрит`)
          onRefresh()
        }}
        onCancel={() => setConfirmDeleteRow(null)}
      />

      {/* Pagination */}
      <div className="p-2 md:p-3 border-t border-light flex flex-wrap items-center justify-between gap-2 bg-white text-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="px-2 md:px-3 py-1 rounded border border-light disabled:opacity-30 hover:bg-light transition text-xs md:text-sm">
            ←
          </button>
          <span className="text-dark/60 text-xs md:text-sm">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="px-2 md:px-3 py-1 rounded border border-light disabled:opacity-30 hover:bg-light transition text-xs md:text-sm">
            →
          </button>
        </div>
        <select
          value={table.getState().pagination.pageSize}
          onChange={e => table.setPageSize(Number(e.target.value))}
          className="px-2 py-1 border border-light rounded text-xs md:text-sm"
        >
          {[25, 50, 100, 200].map(size => (
            <option key={size} value={size}>{size} реда</option>
          ))}
        </select>
      </div>
    </div>
  )
}
