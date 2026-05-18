import { useState, useEffect } from 'react'
import { X, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  lookupByEik, lookupEikByName, upsertContact, buildContactPayload, getContactByClientId,
  type EikLookupResult,
} from '../../lib/storage'
import type { Contact } from '../../lib/types'

interface Props {
  clientId: string
  clientName: string
  onClose: () => void
  onDone: () => void
  userId?: string
}

type DiffRow = { label: string; field: keyof Contact; oldValue: string | null; newValue: string | null }

const FIELD_LABELS: Array<{ field: keyof Contact; label: string }> = [
  { field: 'eik', label: 'ЕИК' },
  { field: 'vat_number', label: 'ДДС номер' },
  { field: 'vat_registered_at', label: 'Дата на ДДС регистрация' },
  { field: 'address', label: 'Адрес' },
  { field: 'owner_name', label: 'Собственик' },
  { field: 'manager_name', label: 'Управляващ' },
  { field: 'public_url', label: 'Линк към регистъра' },
]

export function RefreshContactDialog({ clientId, clientName, onClose, onDone, userId }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [contact, setContact] = useState<Contact | null>(null)
  const [result, setResult] = useState<EikLookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const current = await getContactByClientId(clientId)
        if (cancelled) return
        setContact(current)

        let res: EikLookupResult
        if (current?.eik) {
          res = await lookupByEik(current.eik)
        } else if (clientName) {
          res = await lookupEikByName(clientName)
        } else {
          setError('Няма ЕИК или име за търсене')
          setLoading(false)
          return
        }
        if (cancelled) return
        if (!res.fields) {
          setError('Не са намерени данни в регистъра')
          setLoading(false)
          return
        }
        setResult(res)
        setLoading(false)
      } catch (e: any) {
        if (cancelled) return
        setError(e.message ?? 'Грешка при заявка към регистъра')
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [clientId, clientName])

  const diffs: DiffRow[] = result?.fields ? FIELD_LABELS.map(({ field, label }) => {
    const oldValue = (contact?.[field] as string | null | undefined) ?? null
    const newValue = (result.fields![field as keyof typeof result.fields] as string | null | undefined) ?? null
    return { label, field, oldValue, newValue }
  }) : []

  const changes = diffs.filter(d => (d.oldValue ?? '') !== (d.newValue ?? '') && d.newValue !== null)

  async function handleSave() {
    if (!result?.fields) return
    setSaving(true)
    try {
      await upsertContact(buildContactPayload(clientId, contact, {
        eik: result.fields.eik ?? contact?.eik ?? null,
        vat_number: result.fields.vat_number,
        vat_registered_at: result.fields.vat_registered_at,
        address: result.fields.address,
        owner_name: result.fields.owner_name,
        manager_name: result.fields.manager_name,
        public_url: result.fields.public_url,
      }, userId))
      toast.success(`${changes.length} полета обновени`)
      onDone()
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при запис')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Обнови от регистъра — {clientName}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Извличане на данни от Търговския регистър...
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {!loading && !error && result?.fields && (
            <>
              {result.total > 1 && (
                <div className="mb-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Намерени са {result.total} съвпадения по име. Показваме най-добрия резултат: <strong>{result.caption}</strong>
                </div>
              )}

              {changes.length === 0 ? (
                <div className="space-y-3">
                  <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                    ✓ Данните в CRM съответстват на регистъра.
                  </div>
                  {!result.fields.vat_number && !result.fields.vat_registered_at && (
                    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      ℹ️ Тази фирма <strong>не е регистрирана по ДДС</strong> в момента (затова колоната „Рег. по ДДС" остава празна).
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Снимка от регистъра</div>
                    <div className="space-y-1.5">
                      {diffs.map(d => (
                        <div key={d.field} className="grid grid-cols-[1fr,2fr] gap-2 text-sm py-1 border-b border-border last:border-0">
                          <div className="text-muted-foreground">{d.label}</div>
                          <div className="break-words">{d.newValue || <span className="text-dark/30">—</span>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Намерени {changes.length} промени:
                  </div>
                  <div className="grid grid-cols-[1fr,1fr,1fr] gap-2 text-xs font-semibold text-muted-foreground border-b border-border pb-1.5 mb-1.5">
                    <div>Поле</div>
                    <div>Старо</div>
                    <div>Ново</div>
                  </div>
                  {changes.map(d => (
                    <div key={d.field} className="grid grid-cols-[1fr,1fr,1fr] gap-2 text-sm py-1.5 border-b border-border last:border-0">
                      <div className="text-muted-foreground">{d.label}</div>
                      <div className="text-red-700 break-words">{d.oldValue || <span className="text-dark/30">—</span>}</div>
                      <div className="text-emerald-700 break-words">{d.newValue || <span className="text-dark/30">—</span>}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          {changes.length === 0 && !loading && !error ? (
            <Button onClick={onClose}>Затвори</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Отказ
              </Button>
              <Button onClick={handleSave} disabled={saving || loading || !!error || changes.length === 0}>
                {saving ? 'Запазване...' : `Запази (${changes.length})`}
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
