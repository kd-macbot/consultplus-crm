import { useState } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  addClient, setCellValue, upsertContact, getColumns,
  lookupByEik, lookupEikByName, fetchEikRaw, type EikLookupResult,
} from '../../lib/storage'

interface Props {
  onClose: () => void
  onCreated: () => void
  userId?: string
  userName?: string
}

export function NewClientDialog({ onClose, onCreated, userId, userName }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<EikLookupResult | null>(null)
  // Името, което ще се запази в "Фирма" колоната — потребителят може да го редактира преди запис
  const [nameOverride, setNameOverride] = useState('')
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [loadingRaw, setLoadingRaw] = useState(false)

  async function handleShowRaw() {
    if (!isEik) { toast.error('Диагностиката изисква ЕИК (9 или 13 цифри)'); return }
    setLoadingRaw(true)
    try {
      const raw = await fetchEikRaw(query.trim())
      setRawJson(JSON.stringify(raw, null, 2))
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при диагностика')
    }
    setLoadingRaw(false)
  }

  async function copyRaw() {
    if (!rawJson) return
    try {
      await navigator.clipboard.writeText(rawJson)
      toast.success('Копирано')
    } catch {
      toast.error('Не можах да копирам')
    }
  }

  const isEik = /^\d{9}(\d{4})?$/.test(query.trim())

  async function handleSearch() {
    const q = query.trim()
    if (!q) { toast.error('Въведете име или ЕИК'); return }
    setSearching(true)
    setResult(null)
    try {
      const res = isEik ? await lookupByEik(q) : await lookupEikByName(q)
      if (!res.eik) {
        toast.error('Не са намерени данни в регистъра')
      } else {
        setResult(res)
        setNameOverride(res.caption?.split(',')[0]?.trim() ?? q)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при заявка към регистъра')
    }
    setSearching(false)
  }

  async function handleCreatePrefilled() {
    if (!result?.fields?.eik) { toast.error('Няма данни за запис'); return }
    setCreating(true)
    try {
      // 1. Нов клиент
      const client = await addClient(userId, undefined, { userId, userName })

      // 2. Намираме името-колоната (първата text) и записваме името
      const cols = await getColumns()
      const nameCol = cols.find(c => c.type === 'text')
      if (nameCol && nameOverride) {
        await setCellValue(client.id, nameCol.id, { value_text: nameOverride })
      }

      // 3. Контакт с попълнени данни от регистъра
      await upsertContact({
        client_id: client.id,
        eik: result.fields.eik,
        vat_number: result.fields.vat_number,
        address: result.fields.address,
        owner_name: result.fields.owner_name,
        manager_name: result.fields.manager_name,
        owner_email: null, owner_phone: null,
        manager_email: null, company_email: null,
        website: null, notes: null,
        created_by: userId ?? null,
      })

      toast.success(`"${nameOverride}" е създаден с данни от регистъра`)
      onCreated()
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при създаване')
    }
    setCreating(false)
  }

  async function handleCreateEmpty() {
    setCreating(true)
    try {
      await addClient(userId, undefined, { userId, userName })
      toast.success('Нов празен клиент е добавен')
      onCreated()
      onClose()
    } catch (e: any) {
      toast.error(e.message ?? 'Грешка при създаване')
    }
    setCreating(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Нов клиент</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Търсене в Търговския регистър
            </label>
            <div className="flex gap-1.5">
              <Input
                autoFocus
                placeholder="Име на фирма или ЕИК (9 или 13 цифри)"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              />
              <Button onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Търси</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {isEik ? 'Ще се извлекат данни директно по ЕИК.' : 'Ще се търси по име в регистъра.'}
            </p>
            {isEik && (
              <button
                type="button"
                onClick={handleShowRaw}
                disabled={loadingRaw}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                {loadingRaw ? 'Зареждане...' : '🔍 Виж RAW от регистъра (diagnostic)'}
              </button>
            )}
          </div>

          {rawJson && (
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">RAW отговор от regdata</span>
                <div className="flex gap-2">
                  <button type="button" onClick={copyRaw} className="text-xs text-blue-600 hover:underline">Копирай</button>
                  <button type="button" onClick={() => setRawJson(null)} className="text-xs text-muted-foreground hover:underline">Затвори</button>
                </div>
              </div>
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto bg-background p-2 rounded border border-border">
                {rawJson}
              </pre>
            </div>
          )}

          {result && result.fields && (
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Резултат</span>
                {result.total > 1 && (
                  <span className="text-xs text-amber-600">{result.total} съвпадения, показано първото</span>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Име (ще се запише в „Фирма")</label>
                <Input value={nameOverride} onChange={e => setNameOverride(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">ЕИК: </span>
                  <span className="font-mono">{result.fields.eik}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">ДДС: </span>
                  <span className="font-mono">{result.fields.vat_number ?? '—'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">Адрес: </span>
                  <span>{result.fields.address ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Собственик: </span>
                  <span>{result.fields.owner_name ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Управляващ: </span>
                  <span>{result.fields.manager_name ?? '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" onClick={handleCreateEmpty} disabled={creating}>
            Празен клиент
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={creating}>
              Отказ
            </Button>
            <Button onClick={handleCreatePrefilled} disabled={creating || !result?.fields?.eik}>
              {creating ? 'Създаване...' : 'Създай от регистъра'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
