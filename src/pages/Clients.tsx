import { useState, useCallback } from 'react'
import { DataTable } from '../components/table/DataTable'
import { addClient } from '../lib/storage'
import { exportToExcel } from '../lib/export'
import { useAuth } from '../lib/auth'
import { ImportDialog } from '../components/import/ImportDialog'
import { Download, Upload, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function ClientsPage() {
  const { user } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), [])
  const [showImport, setShowImport] = useState(false)
  const [adding, setAdding] = useState(false)

  const canAdd = user?.role === 'admin' || user?.role === 'manager'

  const handleAdd = async () => {
    setAdding(true)
    try {
      await addClient(user?.id, undefined, { userId: user?.id, userName: user?.full_name ?? '' })
      toast.success('Нов клиент е добавен')
      onRefresh()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при създаване на клиент')
    }
    setAdding(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-screen">
      <div className="px-3 py-2 md:px-5 md:py-3 flex items-center justify-between border-b border-border bg-card">
        <h1 className="text-base md:text-lg font-semibold text-foreground">Клиенти</h1>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Импорт</span>
          </Button>
          <Button variant="outline" size="sm" onClick={async () => {
            try { await exportToExcel() } catch (err) { console.error('Export failed:', err) }
          }}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Експорт</span>
          </Button>
          {canAdd && (
            <Button size="sm" onClick={handleAdd} disabled={adding}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{adding ? 'Създаване...' : 'Нов клиент'}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <DataTable refreshKey={refreshKey} onRefresh={onRefresh} />
      </div>
      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onDone={onRefresh}
          userId={user?.id}
        />
      )}
    </div>
  )
}
