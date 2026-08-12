import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { upsertFinancialClosing } from '../lib/storage'
import type { FinancialClosing, PeriodKind } from '../lib/types'

function fmt(v: number): string {
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function parseNum(raw: string): number {
  const v = parseFloat(raw.replace(',', '.'))
  return isNaN(v) ? 0 : v
}

// Модал за приключване на период: Приходи, Разходи → Резултат (авто),
// плюс бележка. Резултат зелено/червено (печалба/загуба).
export function FinancialClosingModal({ clientName, periodLabel, clientId, year, periodKind, periodNo, existing, disabled, onClose, onSaved, createdBy }: {
  clientName: string
  periodLabel: string
  clientId: string
  year: number
  periodKind: PeriodKind
  periodNo: number
  existing: FinancialClosing | undefined
  disabled?: boolean
  onClose: () => void
  onSaved: () => void
  createdBy?: string
}) {
  const [income, setIncome] = useState(existing?.income?.toString() ?? '')
  const [expense, setExpense] = useState(existing?.expense?.toString() ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setIncome(existing?.income?.toString() ?? '')
    setExpense(existing?.expense?.toString() ?? '')
    setNote(existing?.note ?? '')
  }, [existing])

  const result = parseNum(income) - parseNum(expense)

  async function save() {
    if (disabled) return
    setSaving(true)
    try {
      await upsertFinancialClosing(clientId, year, periodKind, periodNo, {
        income: parseNum(income), expense: parseNum(expense), note: note.trim() || null,
      }, createdBy)
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Приключване</h2>
            <p className="text-xs text-muted-foreground">{clientName} • {periodLabel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Приходи €</span>
            <input value={income} disabled={disabled}
              onChange={e => setIncome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              placeholder="0,00"
              className="mt-1 w-full h-9 px-2 text-sm text-right border border-border rounded bg-background focus:border-primary focus:outline-none tabular-nums" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Разходи €</span>
            <input value={expense} disabled={disabled}
              onChange={e => setExpense(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              placeholder="0,00"
              className="mt-1 w-full h-9 px-2 text-sm text-right border border-border rounded bg-background focus:border-primary focus:outline-none tabular-nums" />
          </label>

          {/* Резултат — авто, оцветен */}
          <div className="flex items-center justify-between rounded-lg px-3 py-2 bg-muted/30">
            <span className="text-sm font-semibold text-foreground">Резултат</span>
            <span className={`text-base font-bold tabular-nums ${
              result > 0 ? 'text-emerald-700 dark:text-emerald-400' : result < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
            }`}>
              {result > 0 ? '+' : ''}{fmt(result)} €
              <span className="ml-2 text-xs font-normal text-muted-foreground">{result > 0 ? '(печалба)' : result < 0 ? '(загуба)' : ''}</span>
            </span>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Бележка</span>
            <textarea value={note} disabled={disabled}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="напр. еднократни разходи, обяснение за периода"
              className="mt-1 w-full text-sm border border-border rounded p-2 bg-background focus:border-primary focus:outline-none resize-y" />
          </label>
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Отказ</Button>
          <Button size="sm" onClick={() => void save()} disabled={disabled || saving}>Запази</Button>
        </div>
      </div>
    </div>
  )
}
