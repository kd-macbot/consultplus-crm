import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addCashLoanEntry, updateCashLoanEntry, deleteCashLoanEntry } from '../lib/storage'
import { CASH_LOAN_KIND_LABELS, type CashLoanEntry, type CashLoanKind } from '../lib/types'
import { MONTH_NAMES } from '../lib/utils'

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

// Модал за записите Каса/Заем на клиент × месец — моделът на Art55Modal.
// Отваря се от Работния лист (клетката до „Банка") и от „Каси и заеми".
export function CashLoanModal({ clientId, clientName, year, month, entries, disabled, onClose, onChanged, createdBy }: {
  clientId: string
  clientName: string
  year: number
  month: number
  entries: CashLoanEntry[]
  disabled?: boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
  createdBy?: string
}) {
  const [saving, setSaving] = useState(false)
  async function withSave(fn: () => Promise<void>) {
    setSaving(true)
    try { await fn(); await onChanged() } catch (e: any) { toast.error(e.message ?? 'Грешка') }
    setSaving(false)
  }
  const sumCash = entries.filter(e => e.kind === 'cash').reduce((s, e) => s + e.amount, 0)
  const sumLoan = entries.filter(e => e.kind === 'loan').reduce((s, e) => s + e.amount, 0)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div onClick={e => e.stopPropagation()} className="bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Каса / Заем записи</h2>
            <p className="text-xs text-muted-foreground">{clientName} • {MONTH_NAMES[month - 1]} {year} • движение за месеца</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Няма записи за този месец.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2">Вид</th>
                  <th className="text-right py-2">Сума €</th>
                  <th className="text-left py-2 pl-4">Бележка</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <CashLoanEntryRow key={e.id} entry={e} disabled={disabled || saving}
                    onUpdate={p => withSave(() => updateCashLoanEntry(e.id, p))}
                    onDelete={() => withSave(() => deleteCashLoanEntry(e.id))}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold text-foreground">
                  <td className="py-2">Общо</td>
                  <td className="text-right py-2 tabular-nums whitespace-nowrap">
                    {sumCash !== 0 && <span className="mr-2" title="Каса — общо">К: {formatCurrency(sumCash)}</span>}
                    {sumLoan !== 0 && <span title="Заем — общо">З: {formatCurrency(sumLoan)}</span>}
                    {sumCash === 0 && sumLoan === 0 && '0,00'}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" disabled={disabled || saving}
              onClick={() => withSave(() => addCashLoanEntry({ client_id: clientId, year, month, kind: 'cash', createdBy }).then(() => {}))}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Каса
            </Button>
            <Button
              variant="outline" size="sm" disabled={disabled || saving}
              onClick={() => withSave(() => addCashLoanEntry({ client_id: clientId, year, month, kind: 'loan', createdBy }).then(() => {}))}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Заем
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Затвори</Button>
        </div>
      </div>
    </div>
  )
}

function CashLoanEntryRow({ entry, disabled, onUpdate, onDelete }: {
  entry: CashLoanEntry
  disabled?: boolean
  onUpdate: (p: Partial<CashLoanEntry>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [amount, setAmount] = useState(entry.amount.toString())
  const [note, setNote] = useState(entry.note ?? '')
  useEffect(() => { setAmount(entry.amount.toString()); setNote(entry.note ?? '') }, [entry.amount, entry.note])

  function commitAmount() {
    const v = parseFloat(amount.replace(',', '.'))
    const safe = isNaN(v) ? 0 : v
    if (safe === entry.amount) return
    void onUpdate({ amount: safe })
  }
  function commitNote() {
    const v = note.trim() || null
    if (v === entry.note) return
    void onUpdate({ note: v })
  }

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-1.5 pr-2">
        <select disabled={disabled}
          value={entry.kind}
          onChange={e => onUpdate({ kind: e.target.value as CashLoanKind })}
          className="h-7 px-1 text-sm border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-24"
        >
          {(Object.keys(CASH_LOAN_KIND_LABELS) as CashLoanKind[]).map(k => (
            <option key={k} value={k}>{CASH_LOAN_KIND_LABELS[k]}</option>
          ))}
        </select>
      </td>
      <td className="py-1.5 pr-2 text-right">
        <input disabled={disabled} value={amount}
          onChange={e => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-7 px-1 text-sm text-right border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-28 tabular-nums"
        />
      </td>
      <td className="py-1.5 pl-4">
        <input disabled={disabled} value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="напр. заем към собственика"
          className="h-7 px-1 text-sm border border-transparent hover:border-border focus:border-primary rounded bg-transparent w-full"
        />
      </td>
      <td className="py-1.5 text-right">
        <button disabled={disabled} onClick={onDelete}
          className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40"
          title="Изтрий запис">
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}
