import { useState, useMemo, useEffect, useRef } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
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
import { GripVertical, SlidersHorizontal, X, RefreshCw } from 'lucide-react'
import type { Column, CellValue, DropdownOption, Client, Contact } from '../../lib/types'
import {
  softDeleteClient, updateColumnPositions,
  setCellValue, type StaffMember,
  upsertContact, buildContactPayload,
} from '../../lib/storage'
import {
  useClients, useColumns, useCellValues, useDropdownOptions,
  useTags, useClientTags, useStaff, useAllContacts,
  qk,
} from '../../lib/queries'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../lib/auth'
import { buildCellIndex, buildDropdownIndex, cellKey, clientDisplayName } from '../../lib/tableIndices'
import { toast } from 'sonner'
import { CellEditor } from './CellEditor'
import { TagEditor } from '../tags/TagEditor'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { RefreshContactDialog } from '../clients/RefreshContactDialog'
import { ViewsMenu } from './ViewsMenu'
import {
  getViews, getDefaultView, getActiveViewId, setActiveViewId,
  saveView, deleteView, setDefaultView, syncViewsFromDb, type View,
} from '../../lib/views'

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

function getCellDisplay(col: Column, cell: CellValue | undefined, dropdownIdx: Map<string, DropdownOption>): string {
  if (!cell) return ''
  if (col.type === 'number') {
    if (cell.value_number == null) return ''
    if (col.name === 'Хонорар') return `${cell.value_number.toLocaleString('bg-BG')} €`
    return cell.value_number.toString()
  }
  if (col.type === 'dropdown') {
    if (col.staff_department) return cell.value_text ?? ''
    return dropdownIdx.get(cell.value_dropdown ?? '')?.value ?? ''
  }
  if (col.type === 'checkbox') return cell.value_bool ? '✓' : ''
  if (col.type === 'date') return cell.value_date ?? ''
  return cell.value_text ?? ''
}

// Българската азбука (без Ы). Използва се за filter dropdown-а на „Фирма" колоната.
const BG_ALPHABET = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ'.split('')

function nameLetterFilter(value: string, filterValue: string): boolean {
  if (!filterValue) return true
  // filterValue форматът е "letter|text" (или просто "text" за legacy)
  let letter = ''
  let text = filterValue
  if (filterValue.includes('|')) {
    const parts = filterValue.split('|')
    letter = parts[0]
    text = parts.slice(1).join('|')
  }
  const val = String(value ?? '')
  // Игнорираме leading кавички/тирета — гледаме първата буква
  const stripped = val.replace(/^[^A-Za-zА-Яа-я0-9]+/, '')
  if (letter) {
    if (letter === '__other__') {
      if (/^[А-Яа-я]/.test(stripped)) return false
    } else {
      if (!stripped.toUpperCase().startsWith(letter)) return false
    }
  }
  if (text && !val.toLowerCase().includes(text.toLowerCase())) return false
  return true
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>
  const q = query.trim()
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5 not-italic">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
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
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [columnOrder, setColumnOrder] = useState<string[]>([])

  // Saved views: на mount-а зареждаме default-а (или активния, ако е bookmark-нат)
  const [views, setViews] = useState<View[]>(() => getViews())
  const [activeViewId, setActiveViewIdLocal] = useState<string | null>(() => {
    return getActiveViewId() ?? getDefaultView()?.id ?? null
  })
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    const v = getViews().find(view => view.id === (getActiveViewId() ?? getDefaultView()?.id))
    return new Set(v?.hiddenCols ?? [])
  })
  const [showColPanel, setShowColPanel] = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  const activeView = views.find(v => v.id === activeViewId) ?? null
  // „Dirty" = текущите скрити колони се различават от запазените в активния view
  const isViewDirty = useMemo(() => {
    if (!activeView) return false
    const saved = new Set(activeView.hiddenCols)
    if (saved.size !== hiddenCols.size) return true
    for (const id of saved) if (!hiddenCols.has(id)) return true
    return false
  }, [activeView, hiddenCols])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Master данните идват от React Query (споделени между всички страници).
  // Persisted кешът в localStorage прави повторни отваряния МИГНОВЕНИ —
  // не fetch-ваме на mount, а показваме кешираните данни и опресняваме
  // тихо във фонов режим.
  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const tagsQ = useTags()
  const clientTagsQ = useClientTags()
  const staffQ = useStaff()
  const contactsQ = useAllContacts()

  const allClients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])
  const allCells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const allDropdowns = useMemo(() => dropdownsQ.data ?? [], [dropdownsQ.data])
  const allTags = useMemo(() => tagsQ.data ?? [], [tagsQ.data])
  const allClientTags = useMemo(() => clientTagsQ.data ?? [], [clientTagsQ.data])
  const staffList: StaffMember[] = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const allContacts = useMemo(() => contactsQ.data ?? [], [contactsQ.data])
  // Скриваме „Хонорар" и __sub__ системните колони от грида.
  const columns = useMemo(
    () => (columnsQ.data ?? []).filter((c: Column) => c.name !== 'Хонорар' && c.staff_department !== '__sub__'),
    [columnsQ.data],
  )

  // Loading е true само ако НЯМАМЕ кеширани данни (първи cold start без
  // persist). При навигация след предходно посещение → cache hit → нула чакане.
  const loading = !clientsQ.data || !columnsQ.data || !cellsQ.data || !dropdownsQ.data

  const [editingEikFor, setEditingEikFor] = useState<string | null>(null)
  const [eikDraft, setEikDraft] = useState('')
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<ClientRow | null>(null)
  const [refreshTarget, setRefreshTarget] = useState<ClientRow | null>(null)
  const [editingVatFor, setEditingVatFor] = useState<string | null>(null)
  const [vatDraft, setVatDraft] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScrollPos = useRef<{ top: number; left: number } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // refreshKey се бумва от извън страницата (напр. след създаване на нов
  // клиент в NewClientDialog). Инвалидираме RQ кеша → следващото четене
  // тегли свежи данни.
  useEffect(() => {
    if (refreshKey === 0) return
    queryClient.invalidateQueries({ queryKey: qk.clients })
    queryClient.invalidateQueries({ queryKey: qk.cells })
    queryClient.invalidateQueries({ queryKey: qk.allContacts })
    queryClient.invalidateQueries({ queryKey: qk.clientTags })
  }, [refreshKey])

  // Инициализираме columnOrder при първото зареждане на колоните (от RQ кеша).
  useEffect(() => {
    if (columnOrder.length === 0 && columns.length > 0) {
      setColumnOrder(columns.map(c => c.id))
    }
  }, [columns, columnOrder.length])

  // Синхронизираме изгледите от акаунта (DB) при вход — така изгледите,
  // създадени на друго устройство, се появяват и тук. localStorage остава
  // мигновен кеш; това само го опреснява, ако DB има по-нови данни.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    void syncViewsFromDb(user.id).then(changed => {
      if (changed && !cancelled) {
        setViews(getViews())
        const active = getActiveViewId() ?? getDefaultView()?.id ?? null
        setActiveViewIdLocal(active)
        const v = getViews().find(view => view.id === active)
        setHiddenCols(new Set(v?.hiddenCols ?? []))
      }
    })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) {
        setShowColPanel(false)
      }
    }
    if (showColPanel) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColPanel])

  // loadData() и isInitialLoad бяха премахнати — React Query сега управлява
  // зареждането и кеша. Refresh се прави чрез invalidateQueries (виж по-горе).


  function toggleColVisibility(colId: string) {
    const next = new Set(hiddenCols)
    if (next.has(colId)) next.delete(colId)
    else next.add(colId)
    setHiddenCols(next)
  }

  function handleSelectView(id: string) {
    const v = views.find(view => view.id === id)
    if (!v) return
    setActiveViewIdLocal(id)
    setActiveViewId(id)
    setHiddenCols(new Set(v.hiddenCols))
  }

  function handleSaveViewAs(name: string) {
    const v = saveView({ name, hiddenCols: [...hiddenCols], isDefault: false })
    setViews(getViews())
    setActiveViewIdLocal(v.id)
    setActiveViewId(v.id)
  }

  function handleUpdateView(id: string) {
    const existing = views.find(view => view.id === id)
    if (!existing || existing.isPreset) return
    saveView({ ...existing, hiddenCols: [...hiddenCols] })
    setViews(getViews())
  }

  function handleDeleteView(id: string) {
    deleteView(id)
    const next = getViews()
    setViews(next)
    if (activeViewId === id) {
      const fallback = next.find(v => v.isDefault) ?? next[0]
      setActiveViewIdLocal(fallback?.id ?? null)
      setActiveViewId(fallback?.id ?? null)
      setHiddenCols(new Set(fallback?.hiddenCols ?? []))
    }
  }

  function handleSetDefaultView(id: string) {
    setDefaultView(id)
    setViews(getViews())
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

  const statusCol = useMemo(() => columns.find(c => c.name === 'Статус'), [columns])
  const accountantCol = useMemo(() => columns.find(c => c.name === 'Счетоводител'), [columns])
  const accountantStaffList = useMemo(() => {
    if (!accountantCol?.staff_department) return staffList
    return staffList.filter(s => s.department === accountantCol.staff_department)
  }, [staffList, accountantCol])
  const statusOptions = useMemo(
    () => statusCol ? allDropdowns.filter(d => d.column_id === statusCol.id) : [],
    [statusCol, allDropdowns]
  )

  async function handleBulkStatus(optionId: string) {
    if (!statusCol || !optionId || selected.size === 0) return
    const count = selected.size
    try {
      await Promise.all([...selected].map(clientId =>
        setCellValue(clientId, statusCol.id, { value_dropdown: optionId }, {
          userId: user?.id, userName: user?.full_name ?? '', columnName: 'Статус',
        })
      ))
    } catch (err) {
      console.error('Bulk status error:', err)
      toast.error('Част от промените не бяха записани. Опитайте отново.')
      onRefresh()
      return
    }
    setSelected(new Set())
    toast.success(`Статусът е обновен за ${count} клиента`)
    onRefresh()
  }

  async function handleBulkAccountant(staffName: string) {
    if (!accountantCol || !staffName || selected.size === 0) return
    const count = selected.size
    try {
      await Promise.all([...selected].map(clientId =>
        setCellValue(clientId, accountantCol.id, { value_text: staffName, value_dropdown: null }, {
          userId: user?.id, userName: user?.full_name ?? '', columnName: 'Счетоводител',
        })
      ))
    } catch (err) {
      console.error('Bulk accountant error:', err)
      toast.error('Част от промените не бяха записани. Опитайте отново.')
      onRefresh()
      return
    }
    setSelected(new Set())
    toast.success(`Счетоводителят е обновен за ${count} клиента`)
    onRefresh()
  }

  async function handleBulkDelete() {
    const count = selected.size
    try {
      await Promise.all([...selected].map(clientId => {
        const row = data.find(r => r.clientId === clientId)
        return softDeleteClient(clientId, {
          userId: user?.id, userName: user?.full_name ?? '', clientName: row?.clientName ?? '',
        })
      }))
    } catch (err) {
      console.error('Bulk delete error:', err)
      toast.error('Част от клиентите не бяха изтрити. Опитайте отново.')
      onRefresh()
      return
    }
    setSelected(new Set())
    setConfirmBulkDelete(false)
    toast.success(`${count} клиента са изтрити`)
    onRefresh()
  }

  const clients = useMemo(() => allClients, [allClients])

  const contactsByClientId = useMemo(
    () => new Map(allContacts.map(c => [c.client_id, c])),
    [allContacts]
  )

  // ID на първата text колона = „Фирма" — за нея ползваме letter+text filter
  const nameColId = useMemo(() => columns.find(c => c.type === 'text')?.id ?? null, [columns])

  const orderedColumns = useMemo(
    () => columnOrder.map(id => columns.find(c => c.id === id)).filter((c): c is Column => !!c),
    [columnOrder, columns]
  )

  const visibleColumns = useMemo(
    () => orderedColumns.filter(c => !hiddenCols.has(c.id)),
    [orderedColumns, hiddenCols]
  )

  // Синтетичните колони (ЕИК, ДДС, Тагове) могат да се скриват чрез същия механизъм
  const HIDEABLE_PSEUDO: Array<{ id: string; name: string }> = [
    { id: '_eik', name: 'ЕИК' },
    { id: '_vat', name: 'Рег. по ДДС' },
    { id: '_tags', name: 'Тагове' },
  ]

  // O(1) индекси — изграждат се веднъж при промяна на данните.
  const cellIdx = useMemo(() => buildCellIndex(allCells), [allCells])
  const dropdownIdx = useMemo(() => buildDropdownIndex(allDropdowns), [allDropdowns])
  const tagsByClient = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const ct of allClientTags) {
      const arr = m.get(ct.client_id) ?? []
      arr.push(ct.tag_id)
      m.set(ct.client_id, arr)
    }
    return m
  }, [allClientTags])

  const data: ClientRow[] = useMemo(() => {
    const rows = clients.map(client => {
      const row: ClientRow = {
        clientId: client.id,
        clientName: clientDisplayName(client.id, columns, cellIdx),
        assignedTo: client.assigned_to,
        tagIds: tagsByClient.get(client.id) ?? [],
      }
      for (const col of columns) {
        const cell = cellIdx.get(cellKey(client.id, col.id))
        row[col.id] = getCellDisplay(col, cell, dropdownIdx)
      }
      return row
    })
    // Unnamed (newly created) rows float to top; named rows sort alphabetically
    return rows.sort((a, b) => {
      const hasA = !!a.clientName
      const hasB = !!b.clientName
      if (!hasA && !hasB) return 0
      if (!hasA) return -1
      if (!hasB) return 1
      return a.clientName.localeCompare(b.clientName, 'bg')
    })
  }, [clients, columns, cellIdx, dropdownIdx, tagsByClient])

  const filteredByTags = useMemo(() => {
    if (tagFilter.length === 0) return data
    return data.filter(row => tagFilter.some(tid => row.tagIds.includes(tid)))
  }, [data, tagFilter])

  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const canDelete = user?.role === 'admin' || user?.role === 'manager'

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
      ...(canEdit ? [{
        id: '_select',
        header: ({ table }: { table: ReturnType<typeof useReactTable<ClientRow>> }) => {
          const all = table.getFilteredRowModel().rows
          const allChecked = all.length > 0 && all.every(r => selected.has(r.original.clientId))
          const someChecked = all.some(r => selected.has(r.original.clientId))
          return (
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
              onChange={e => {
                if (e.target.checked) setSelected(new Set(all.map(r => r.original.clientId)))
                else setSelected(new Set())
              }}
              className="w-3.5 h-3.5 cursor-pointer"
            />
          )
        },
        cell: (info: { row: { original: ClientRow } }) => (
          <input
            type="checkbox"
            checked={selected.has(info.row.original.clientId)}
            onChange={e => {
              const next = new Set(selected)
              if (e.target.checked) next.add(info.row.original.clientId)
              else next.delete(info.row.original.clientId)
              setSelected(next)
            }}
            className="w-3.5 h-3.5 cursor-pointer"
          />
        ),
        size: 40,
        enableSorting: false,
        enableColumnFilter: false,
      } as ColumnDef<ClientRow>] : []),
      ...visibleColumns.map((col): ColumnDef<ClientRow> => ({
        id: col.id,
        accessorKey: col.id,
        header: col.name,
        size: col.type === 'number' ? 100 : 180,
        cell: info => {
          const clientId = info.row.original.clientId
          const clientName = info.row.original.clientName
          const isEditing = editCell?.clientId === clientId && editCell?.columnId === col.id

          if (isEditing && canEdit) {
            const cellData = cellIdx.get(cellKey(clientId, col.id))
            const oldDisplay = getCellDisplay(col, cellData, dropdownIdx)
            return (
              <CellEditor
                column={col}
                clientId={clientId}
                clientName={clientName}
                cell={cellData}
                oldDisplay={oldDisplay}
                onSave={(patch) => {
                  // Само ако потребителят още е на ТАЗИ клетка — иначе вече е
                  // отворил друга и не искаме да я затворим под ръцете му.
                  setEditCell(curr =>
                    curr?.clientId === clientId && curr?.columnId === col.id ? null : curr
                  )
                  // Оптимистичен update на споделения React Query кеш →
                  // всички страници (Dashboard, Worksheet) виждат веднага.
                  queryClient.setQueryData<CellValue[]>(qk.cells, (prev) => {
                    if (!prev) return prev
                    const idx = prev.findIndex(cv => cv.client_id === clientId && cv.column_id === col.id)
                    if (idx >= 0) return prev.map((cv, i) => i === idx ? { ...cv, ...patch } : cv)
                    return [...prev, { id: '', client_id: clientId, column_id: col.id, ...patch } as CellValue]
                  })
                }}
                onCancel={() => setEditCell(curr =>
                  curr?.clientId === clientId && curr?.columnId === col.id ? null : curr
                )}
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
              {val
                ? <Highlight text={val} query={globalFilter} />
                : <span className="text-dark/20">—</span>
              }
            </div>
          )
        },
        filterFn: col.type === 'dropdown'
          ? (row, columnId, filterValue) => {
              const cellVal = row.getValue(columnId) as string
              if (filterValue === '__empty__') return !cellVal
              return cellVal === filterValue
            }
          : col.id === nameColId
            ? (row, columnId, filterValue) => nameLetterFilter(row.getValue(columnId) as string, filterValue)
            : 'includesString',
      })),
      {
        id: '_eik',
        header: 'ЕИК',
        size: 130,
        enableSorting: true,
        enableColumnFilter: true,
        accessorFn: (row: ClientRow) => {
          const contact = contactsByClientId.get(row.clientId)
          return contact?.eik ?? ''
        },
        cell: info => {
          const clientId = info.row.original.clientId
          const contact = contactsByClientId.get(clientId)
          const eik = contact?.eik ?? ''
          const isEditing = editingEikFor === clientId

          if (isEditing && canEdit) {
            return (
              <input
                autoFocus
                value={eikDraft}
                onChange={e => setEikDraft(e.target.value.replace(/\D/g, '').slice(0, 13))}
                onBlur={async () => {
                  const trimmed = eikDraft.trim()
                  setEditingEikFor(null)
                  if (trimmed === (contact?.eik ?? '')) return
                  try {
                    await upsertContact(buildContactPayload(clientId, contact, { eik: trimmed || null }, user?.id))
                    queryClient.setQueryData<Contact[]>(qk.allContacts, (prev) => {
                      if (!prev) return prev
                      const idx = prev.findIndex(c => c.client_id === clientId)
                      if (idx >= 0) return prev.map((c, i) => i === idx ? { ...c, eik: trimmed || null } : c)
                      return [...prev, { client_id: clientId, eik: trimmed || null } as Contact]
                    })
                  } catch (e: any) {
                    toast.error(e.message ?? 'Грешка при запис на ЕИК')
                    onRefresh() // презареждаме, за да изчистим оптимистичния local state
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setEditingEikFor(null) }
                }}
                className="h-7 px-1 w-full font-mono text-xs border border-primary rounded bg-background"
              />
            )
          }

          return (
            <div
              className={`font-mono text-xs truncate ${canEdit ? 'cursor-pointer hover:bg-navy/5 px-1 rounded' : ''}`}
              onClick={() => {
                if (!canEdit) return
                setEikDraft(eik)
                setEditingEikFor(clientId)
              }}
              title={eik}
            >
              {eik || <span className="text-dark/20">—</span>}
            </div>
          )
        },
        filterFn: 'includesString',
      },
      {
        id: '_vat',
        header: 'Рег. по ДДС',
        size: 150,
        enableSorting: true,
        enableColumnFilter: true,
        accessorFn: (row: ClientRow) => {
          const contact = contactsByClientId.get(row.clientId)
          return contact?.vat_registered_at ?? (contact?.vat_number ? '1' : '')
        },
        cell: info => {
          const clientId = info.row.original.clientId
          const contact = contactsByClientId.get(clientId)
          const date = contact?.vat_registered_at ?? ''
          const hasVat = !!contact?.vat_number || !!date
          const isEditing = editingVatFor === clientId

          if (isEditing && canEdit) {
            return (
              <input
                autoFocus
                type="date"
                value={vatDraft}
                onChange={e => setVatDraft(e.target.value)}
                onBlur={async () => {
                  const newDate = vatDraft.trim()
                  setEditingVatFor(null)
                  const oldDate = contact?.vat_registered_at ?? ''
                  if (newDate === oldDate) return
                  try {
                    const eik = contact?.eik ?? null
                    // При въведена дата → също попълваме vat_number = BG{eik}; при изчистване → и двете null
                    const newVatNumber = newDate ? (eik ? `BG${eik}` : contact?.vat_number ?? null) : null
                    const patch = { vat_registered_at: newDate || null, vat_number: newVatNumber }
                    await upsertContact(buildContactPayload(clientId, contact, patch, user?.id))
                    queryClient.setQueryData<Contact[]>(qk.allContacts, (prev) => {
                      if (!prev) return prev
                      const idx = prev.findIndex(c => c.client_id === clientId)
                      if (idx >= 0) return prev.map((c, i) => i === idx ? { ...c, ...patch } : c)
                      return [...prev, { client_id: clientId, ...patch } as Contact]
                    })
                  } catch (e: any) {
                    toast.error(e.message ?? 'Грешка при запис на ДДС дата')
                    onRefresh()
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingVatFor(null)
                }}
                className="h-7 px-1 w-full text-xs border border-primary rounded bg-background"
              />
            )
          }

          return (
            <div
              className={`text-xs truncate ${canEdit ? 'cursor-pointer hover:bg-navy/5 px-1 rounded' : ''}`}
              onClick={() => {
                if (!canEdit) return
                setVatDraft(date)
                setEditingVatFor(clientId)
              }}
              title={hasVat ? (date || 'Регистрирана (без дата)') : 'Не е регистрирана'}
            >
              {!hasVat
                ? <span className="text-dark/20">—</span>
                : (
                  <>
                    <span className="text-emerald-600 font-semibold">✓</span>
                    {date ? <> {date}</> : <span className="text-muted-foreground"> рег.</span>}
                  </>
                )
              }
            </div>
          )
        },
        filterFn: (row, _columnId, filterValue) => {
          const v = row.getValue('_vat') as string
          if (filterValue === '__yes__') return !!v
          if (filterValue === '__no__') return !v
          return true
        },
      },
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
        size: 80,
        cell: info => (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRefreshTarget(info.row.original)}
              className="text-muted-foreground hover:text-blue-600"
              title="Обнови от регистъра"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setConfirmDeleteRow(info.row.original)}
              className="text-red-500 hover:text-red-700 text-xs"
              title="Изтрий"
            >
              🗑️
            </button>
          </div>
        ),
        enableSorting: false,
      })
    }

    return cols
  }, [visibleColumns, editCell, canEdit, canDelete, allCells, allDropdowns, allTags, allClientTags, onRefresh, user, selected, globalFilter, contactsByClientId, editingEikFor, eikDraft, editingVatFor, vatDraft, nameColId])

  const fullColumnOrder = useMemo(
    () => [
      '_index',
      ...(canEdit ? ['_select'] : []),
      ...visibleColumns.map(c => c.id),
      ...HIDEABLE_PSEUDO.filter(p => !hiddenCols.has(p.id)).map(p => p.id),
      ...(canDelete ? ['_actions'] : []),
    ],
    [visibleColumns, canEdit, canDelete, hiddenCols]
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
  })

  if (loading) {
    return <div className="p-6 text-dark/50">Зареждане на данни...</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 md:p-4 border-b border-light flex items-center gap-3 flex-wrap bg-card">
        <input
          type="text"
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="🔍 Търсене..."
          className="px-3 py-2 border border-light rounded-md focus:outline-none focus:ring-2 focus:ring-navy w-full sm:w-64 bg-background text-foreground"
        />

        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-dark/40">Тагове:</span>
            {allTags.map(tag => {
              const active = tagFilter.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  onClick={() => setTagFilter(prev => active ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium transition ${active ? 'text-white ring-2 ring-navy' : 'opacity-50 hover:opacity-80'}`}
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

        <div className="relative ml-auto" ref={colPanelRef}>
          <button
            onClick={() => setShowColPanel(v => !v)}
            title="Скрий/покажи колони"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition ${
              showColPanel || hiddenCols.size > 0
                ? 'border-navy bg-navy text-white'
                : 'border-light text-dark/50 hover:border-navy hover:text-navy bg-card'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Колони</span>
            {hiddenCols.size > 0 && (
              <span className="bg-white/30 rounded-full px-1 text-[10px] font-bold">
                -{hiddenCols.size}
              </span>
            )}
          </button>

          {showColPanel && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl p-2 min-w-[200px] max-h-[70vh] overflow-y-auto">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1 font-semibold">
                Видими колони
              </p>
              {orderedColumns.map(col => (
                <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col.id)}
                    onChange={() => toggleColVisibility(col.id)}
                    className="w-3.5 h-3.5"
                  />
                  {col.name}
                </label>
              ))}
              <div className="border-t border-border my-1" />
              {HIDEABLE_PSEUDO.map(col => (
                <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col.id)}
                    onChange={() => toggleColVisibility(col.id)}
                    className="w-3.5 h-3.5"
                  />
                  {col.name}
                </label>
              ))}
              {hiddenCols.size > 0 && (
                <button
                  onClick={() => setHiddenCols(new Set())}
                  className="mt-1 w-full text-xs text-center text-muted-foreground hover:text-foreground py-1"
                >
                  Покажи всички
                </button>
              )}
            </div>
          )}
        </div>

        <ViewsMenu
          views={views}
          activeViewId={activeViewId}
          isDirty={isViewDirty}
          onSelect={handleSelectView}
          onSaveAs={handleSaveViewAs}
          onUpdate={handleUpdateView}
          onDelete={handleDeleteView}
          onSetDefault={handleSetDefaultView}
        />

        <span className="text-sm text-dark/50">
          {table.getFilteredRowModel().rows.length} от {filteredByTags.length} клиента
        </span>
      </div>

      {selected.size > 0 && (
        <div className="bg-navy text-white px-4 py-2 flex items-center gap-3 flex-wrap text-sm border-b border-navy-light">
          <span className="font-medium">{selected.size} избрани</span>
          <button onClick={() => setSelected(new Set())} className="text-white/50 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-white/20" />

          {statusCol && statusOptions.length > 0 && (
            <select
              defaultValue=""
              onChange={e => { if (e.target.value) { handleBulkStatus(e.target.value); e.target.value = '' } }}
              className="h-7 px-2 rounded text-sm text-slate-900 bg-white border-0 focus:outline-none"
            >
              <option value="" disabled>Промени статус...</option>
              {statusOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.value}</option>
              ))}
            </select>
          )}

          {accountantCol && accountantStaffList.length > 0 && (
            <select
              defaultValue=""
              onChange={e => { if (e.target.value) { handleBulkAccountant(e.target.value); e.target.value = '' } }}
              className="h-7 px-2 rounded text-sm text-slate-900 bg-white border-0 focus:outline-none"
            >
              <option value="" disabled>Присвои счетоводител...</option>
              {accountantStaffList.map(s => (
                <option key={s.id} value={s.full_name}>{s.full_name}</option>
              ))}
            </select>
          )}

          {canDelete && (
            <button onClick={() => setConfirmBulkDelete(true)} className="ml-auto text-red-300 hover:text-red-100 text-xs">
              Изтрий избраните
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="w-full border-collapse min-w-[1200px]">
            <thead className="bg-navy text-white sticky top-0 z-10">
              <tr>
                <SortableContext items={visibleColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                  {table.getHeaderGroups()[0]?.headers.map(header => {
                    if (visibleColumns.some(c => c.id === header.id)) {
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
              <tr className="bg-navy-light">
                {table.getHeaderGroups()[0]?.headers.map(header => {
                  const col = columns.find(c => c.id === header.id)
                  const isDropdown = col?.type === 'dropdown'
                  const isNameCol = header.id === nameColId
                  const dropdownVals = isDropdown
                    ? [...new Set(filteredByTags.map(row => row[header.id] as string).filter(Boolean))].sort()
                    : []
                  return (
                    <th key={header.id + '_f'} className="px-2 py-1">
                      {header.column.getCanFilter() ? (
                        isDropdown ? (
                          <select
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={e => header.column.setFilterValue(e.target.value || undefined)}
                            className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 focus:outline-none"
                          >
                            <option value="">Всички</option>
                            <option value="__empty__">(Празно)</option>
                            {dropdownVals.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : isNameCol ? (() => {
                          const fv = (header.column.getFilterValue() as string) ?? ''
                          const [letter, text] = fv.includes('|')
                            ? [fv.split('|')[0], fv.split('|').slice(1).join('|')]
                            : ['', fv]
                          const apply = (l: string, t: string) => {
                            const next = (l || t) ? `${l}|${t}` : ''
                            header.column.setFilterValue(next || undefined)
                          }
                          return (
                            <div className="flex gap-1">
                              <select
                                value={letter}
                                onChange={e => apply(e.target.value, text)}
                                className="px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 focus:outline-none"
                                title="Филтър по първа буква"
                              >
                                <option value="">Всички</option>
                                {BG_ALPHABET.map(l => <option key={l} value={l}>{l}</option>)}
                                <option value="__other__"># Други</option>
                              </select>
                              <input
                                type="text"
                                value={text}
                                onChange={e => apply(letter, e.target.value)}
                                placeholder="Филтър..."
                                className="flex-1 min-w-0 px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 placeholder:text-slate-500 focus:outline-none"
                              />
                            </div>
                          )
                        })() : (
                          <input
                            type="text"
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={e => header.column.setFilterValue(e.target.value)}
                            placeholder="Филтър..."
                            className="w-full px-1 py-0.5 text-xs rounded border-0 bg-white text-slate-900 placeholder:text-slate-500 focus:outline-none"
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
                <tr
                  key={row.id}
                  className={`border-b border-light/50 transition-colors hover:bg-gold/5 ${
                    selected.has(row.original.clientId)
                      ? 'bg-blue-50'
                      : i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                  }`}
                >
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
            userId: user?.id, userName: user?.full_name ?? '', clientName: confirmDeleteRow.clientName,
          })
          setConfirmDeleteRow(null)
          toast.success(`Клиент "${confirmDeleteRow.clientName}" е изтрит`)
          onRefresh()
        }}
        onCancel={() => setConfirmDeleteRow(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Изтриване на ${selected.size} клиента?`}
        description="Клиентите ще бъдат скрити от системата."
        confirmLabel="Изтрий всички"
        destructive
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {refreshTarget && (
        <RefreshContactDialog
          clientId={refreshTarget.clientId}
          clientName={refreshTarget.clientName}
          onClose={() => setRefreshTarget(null)}
          onDone={onRefresh}
          userId={user?.id}
        />
      )}

      <div className="p-2 md:p-3 border-t border-light flex items-center justify-end gap-2 bg-card text-xs md:text-sm text-muted-foreground">
        Показани {table.getFilteredRowModel().rows.length} реда
      </div>
    </div>
  )
}
