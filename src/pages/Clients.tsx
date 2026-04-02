import { useState, useCallback } from 'react'
import { DataTable } from '../components/table/DataTable'
import { addClient } from '../lib/storage'
import { useAuth } from '../lib/auth'

export function ClientsPage() {
  const { user } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const canAdd = user?.role === 'admin' || user?.role === 'manager'

  const handleAdd = async () => {
    await addClient(user?.id)
    onRefresh()
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="p-4 flex items-center justify-between border-b border-light bg-white">
        <h1 className="text-xl font-bold text-navy">👥 Клиенти</h1>
        {canAdd && (
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-navy text-white rounded-md hover:bg-navy-light transition text-sm font-medium"
          >
            + Нов клиент
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <DataTable refreshKey={refreshKey} onRefresh={onRefresh} />
      </div>
    </div>
  )
}
