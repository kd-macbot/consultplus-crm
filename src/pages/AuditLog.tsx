import { useState, useEffect } from 'react'
import { getAuditLog, getProfiles } from '../lib/storage'
import type { AuditEntry } from '../lib/types'

const ACTION_LABELS: Record<string, string> = {
  create_client: 'добави нов клиент',
  update_cell: 'промени',
  delete_client: 'изтри клиент',
  create_column: 'добави колона',
  delete_column: 'изтри колона',
  create_dropdown_option: 'добави опция',
  delete_dropdown_option: 'изтри опция',
  create_tag: 'създаде таг',
  delete_tag: 'изтри таг',
  add_tag: 'добави таг',
  remove_tag: 'премахна таг',
}

const ACTION_COLORS: Record<string, { bg: string; icon: string }> = {
  create_client: { bg: 'bg-green-100 text-green-700', icon: '➕' },
  update_cell: { bg: 'bg-blue-100 text-blue-700', icon: '✏️' },
  delete_client: { bg: 'bg-red-100 text-red-700', icon: '🗑️' },
  create_column: { bg: 'bg-green-100 text-green-700', icon: '📊' },
  delete_column: { bg: 'bg-red-100 text-red-700', icon: '📊' },
  create_dropdown_option: { bg: 'bg-green-100 text-green-700', icon: '📋' },
  delete_dropdown_option: { bg: 'bg-red-100 text-red-700', icon: '📋' },
  create_tag: { bg: 'bg-green-100 text-green-700', icon: '🏷️' },
  delete_tag: { bg: 'bg-red-100 text-red-700', icon: '🏷️' },
  add_tag: { bg: 'bg-amber-100 text-amber-700', icon: '🏷️' },
  remove_tag: { bg: 'bg-amber-100 text-amber-700', icon: '🏷️' },
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'преди момент'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `преди ${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `преди ${hours} ч`
  const days = Math.floor(hours / 24)
  if (days < 7) return `преди ${days} дни`
  return new Date(dateStr).toLocaleDateString('bg-BG')
}

function describeAction(entry: AuditEntry): string {
  const { action, client_name, column_name, old_value, new_value } = entry
  const clientLabel = client_name ? ` на клиент ${client_name}` : ''

  switch (action) {
    case 'update_cell':
      if (old_value && new_value) {
        return `промени ${column_name ?? 'стойност'}${clientLabel} от „${old_value}" на „${new_value}"`
      }
      if (new_value) return `зададе ${column_name ?? 'стойност'}${clientLabel} на „${new_value}"`
      return `промени ${column_name ?? 'стойност'}${clientLabel}`
    case 'create_client':
      return 'добави нов клиент'
    case 'delete_client':
      return `изтри клиент${client_name ? ` ${client_name}` : ''}`
    case 'create_column':
      return `добави колона „${new_value ?? column_name ?? ''}"`
    case 'delete_column':
      return `изтри колона „${old_value ?? column_name ?? ''}"`
    case 'create_dropdown_option':
      return `добави опция „${new_value ?? ''}" в ${column_name ?? 'падащо меню'}`
    case 'delete_dropdown_option':
      return `изтри опция „${old_value ?? ''}" от ${column_name ?? 'падащо меню'}`
    case 'create_tag':
      return `създаде таг „${new_value ?? ''}"`
    case 'delete_tag':
      return `изтри таг „${old_value ?? ''}"`
    case 'add_tag':
      return `добави таг „${new_value ?? ''}"${clientLabel}`
    case 'remove_tag':
      return `премахна таг „${old_value ?? ''}"${clientLabel}`
    default:
      return ACTION_LABELS[action] ?? action
  }
}

const ACTION_OPTIONS = [
  { value: '', label: 'Всички действия' },
  { value: 'create_client', label: 'Нов клиент' },
  { value: 'update_cell', label: 'Промяна на стойност' },
  { value: 'delete_client', label: 'Изтриване на клиент' },
  { value: 'create_column', label: 'Нова колона' },
  { value: 'delete_column', label: 'Изтриване на колона' },
  { value: 'add_tag', label: 'Добавяне на таг' },
  { value: 'remove_tag', label: 'Премахване на таг' },
]

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 50

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([])

  useEffect(() => {
    getProfiles().then(setUsers).catch(() => {})
  }, [])

  useEffect(() => {
    loadEntries(true)
  }, [filterUser, filterAction, filterDateFrom, filterDateTo])

  async function loadEntries(reset = false) {
    if (reset) setLoading(true)
    else setLoadingMore(true)

    try {
      const offset = reset ? 0 : entries.length
      const filters: any = {}
      if (filterUser) filters.userId = filterUser
      if (filterAction) filters.action = filterAction
      if (filterDateFrom) filters.dateFrom = filterDateFrom
      if (filterDateTo) filters.dateTo = filterDateTo

      const result = await getAuditLog(PAGE_SIZE, offset, filters)
      if (reset) {
        setEntries(result.entries)
      } else {
        setEntries(prev => [...prev, ...result.entries])
      }
      setTotal(result.total)
    } catch (err) {
      console.error('Audit load error:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-navy mb-6">📝 Дневник на промените</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-dark/50 mb-1">Потребител</label>
          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            className="px-3 py-1.5 border border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          >
            <option value="">Всички</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark/50 mb-1">Действие</label>
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="px-3 py-1.5 border border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          >
            {ACTION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark/50 mb-1">От дата</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          />
        </div>
        <div>
          <label className="block text-xs text-dark/50 mb-1">До дата</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="px-3 py-1.5 border border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          />
        </div>
        {(filterUser || filterAction || filterDateFrom || filterDateTo) && (
          <button
            onClick={() => { setFilterUser(''); setFilterAction(''); setFilterDateFrom(''); setFilterDateTo('') }}
            className="px-3 py-1.5 text-sm text-red-500 hover:text-red-700"
          >
            ✕ Изчисти
          </button>
        )}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="text-dark/50 py-10 text-center">Зареждане...</div>
      ) : entries.length === 0 ? (
        <div className="text-dark/40 py-10 text-center">Няма записи</div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => {
            const colors = ACTION_COLORS[entry.action] ?? { bg: 'bg-gray-100 text-gray-700', icon: '📌' }
            return (
              <div key={entry.id} className="flex items-start gap-3 bg-white rounded-lg p-3 shadow-sm hover:shadow transition">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 ${colors.bg}`}>
                  {colors.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium text-navy">{entry.user_name}</span>{' '}
                    <span className="text-dark/70">{describeAction(entry)}</span>
                  </p>
                  <p className="text-xs text-dark/40 mt-0.5">{relativeTime(entry.created_at)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Load more */}
      {entries.length < total && !loading && (
        <div className="text-center mt-6">
          <button
            onClick={() => loadEntries(false)}
            disabled={loadingMore}
            className="px-6 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm disabled:opacity-50"
          >
            {loadingMore ? 'Зареждане...' : `Зареди още (${entries.length} от ${total})`}
          </button>
        </div>
      )}
    </div>
  )
}
