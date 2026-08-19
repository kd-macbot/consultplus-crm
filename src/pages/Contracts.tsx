import { useMemo, useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Search, FileText, Printer, Save, Pencil, Trash2, RefreshCw,
  AlertTriangle, Plus, X, Loader2, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useAuth } from '../lib/auth'
import {
  addContract, deleteContract, seedContractTemplates,
  addContractTemplate, saveContractTemplate, deleteContractTemplate,
  restoreDefaultContractTemplates,
} from '../lib/storage'
import {
  useClients, useColumns, useCellValues, useAllContacts,
  useContracts, useContractTemplates, useInvalidateCrm,
} from '../lib/queries'
import type { Contact, Contract, ContractTemplate } from '../lib/types'
import { buildCellIndex, clientDisplayName, resolveNumber } from '../lib/tableIndices'
import { formatDate, formatDateTime } from '../lib/utils'
import { usePersistentState } from '../lib/usePersistentState'
import {
  CONTRACT_FIELDS, buildContractValues, fillTemplate, missingFields, usedFields,
  isBilingualBody, parseBilingualRows, splitKeepSections, BOLD_RE,
  type ContractFieldKey, type ContractValues,
} from '../lib/contract'
import { printContract } from '../lib/contractPrint'

// ============================================================
// Договори — изготвяне от шаблон с данните на клиента.
//
// Само admin (route + RLS): договорът съдържа месечния хонорар, а „Хонорар"
// е admin-only навсякъде другаде.
//
// Данните идват от Контакти (ЕИК, адрес, управител, имейл, телефон) и от
// master колоната „Хонорар". Предложените стойности се показват за проверка
// и СЕ РЕДАКТИРАТ преди печат — нищо не влиза в договора неогледано.
// Липсващо задължително поле спира генерирането, вместо да пусне документ
// с празно място в него.
//
// Печатът минава през отделен прозорец (contractPrint.ts) → „Запази като PDF".
// Записаният договор пази ПЪЛНИЯ текст (body_snapshot) — по-късна промяна на
// шаблона не пипа вече изготвените.
// ============================================================

type Tab = 'new' | 'history' | 'templates'

/** ДД.ММ.ГГГГ (както е в договора) → ISO за date колоната в базата. */
function dmyToIso(dmy: string): string | null {
  const m = dmy.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

export function ContractsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = usePersistentState<Tab>('contracts-tab', 'new')
  const [search, setSearch] = usePersistentState('contracts-search', '')
  const [clientId, setClientId] = usePersistentState<string>('contracts-client', '')
  const [templateId, setTemplateId] = usePersistentState<string>('contracts-template', '')
  // Ръчните корекции по поле — преживяват F5 и връщане от друга страница.
  const [edits, setEdits] = usePersistentState<Partial<ContractValues>>('contracts-edits', {})
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const contactsQ = useAllContacts()
  const contractsQ = useContracts()
  const templatesQ = useContractTemplates()
  const { invalidateContracts, invalidateContractTemplates } = useInvalidateCrm()

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const honorarCol = useMemo(() => columns.find(c => c.name === 'Хонорар'), [columns])

  // Първият контакт на клиент — както в Съобщения.
  const contactByClient = useMemo(() => {
    const m = new Map<string, Contact>()
    ;(contactsQ.data ?? []).forEach(c => { if (!m.has(c.client_id)) m.set(c.client_id, c) })
    return m
  }, [contactsQ.data])

  const rows = useMemo(() => {
    return (clientsQ.data ?? [])
      .map(c => ({ id: c.id, name: clientDisplayName(c.id, columns, cellIdx) }))
      .filter(r => r.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  }, [clientsQ.data, columns, cellIdx])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows
  }, [rows, search])

  const templates = useMemo(() => templatesQ.data ?? [], [templatesQ.data])
  const template = useMemo(
    () => templates.find(t => t.id === templateId) ?? templates[0],
    [templates, templateId],
  )

  // Празна таблица → вкарваме стартовите шаблони веднъж.
  useEffect(() => {
    if (!isAdmin || templatesQ.isLoading || templates.length > 0 || seeding) return
    setSeeding(true)
    seedContractTemplates()
      .then(added => { if (added) invalidateContractTemplates() })
      .catch(e => toast.error(`Шаблоните не се заредиха: ${(e as Error).message}`))
      .finally(() => setSeeding(false))
  }, [isAdmin, templatesQ.isLoading, templates.length, seeding, invalidateContractTemplates])

  const client = rows.find(r => r.id === clientId)

  // Предложените стойности от данните + ръчните корекции отгоре.
  const auto = useMemo((): ContractValues | null => {
    if (!client) return null
    const contact = contactByClient.get(client.id)
    return buildContractValues({
      clientName: client.name,
      eik: contact?.eik,
      address: contact?.address,
      ownerName: contact?.owner_name,
      ownerPhone: contact?.owner_phone,
      companyEmail: contact?.company_email,
      ownerEmail: contact?.owner_email,
      managerName: contact?.manager_name,
      fee: resolveNumber(client.id, honorarCol, cellIdx),
    })
  }, [client, contactByClient, honorarCol, cellIdx])

  const values = useMemo(
    (): ContractValues | null => (auto ? { ...auto, ...edits } : null),
    [auto, edits],
  )

  const used = useMemo(() => (template ? usedFields(template.body) : new Set<string>()), [template])
  const visibleFields = useMemo(
    () => CONTRACT_FIELDS.filter(f => used.has(f.key)),
    [used],
  )
  const missing = useMemo(
    () => (template && values ? missingFields(template.body, values) : []),
    [template, values],
  )

  const filled = useMemo(
    () => (template && values && missing.length === 0
      ? fillTemplate(template.body, values, { bold: true })
      : ''),
    [template, values, missing.length],
  )

  const setField = (key: ContractFieldKey, v: string) =>
    setEdits(prev => ({ ...prev, [key]: v }))

  const resetEdits = () => {
    setEdits({})
    toast.success('Полетата са върнати към данните от системата')
  }

  function handlePrint() {
    if (!filled || !client || !template) return
    const ok = printContract({ title: `Договор — ${client.name}`, body: filled })
    if (!ok) toast.error('Браузърът блокира прозореца за печат. Разрешете popup-ите за сайта.')
  }

  async function handleSave() {
    if (!filled || !client || !template || !values) return
    setSaving(true)
    try {
      await addContract({
        client_id: client.id,
        client_name: client.name,
        template_id: template.id,
        template_name: template.name,
        contract_date: dmyToIso(values.дата) ?? new Date().toISOString().slice(0, 10),
        effective_date: dmyToIso(values.в_сила_от),
        monthly_fee: values.хонорар ? Number(values.хонорар) : null,
        body_snapshot: filled,
        fields: values,
      })
      invalidateContracts()
      toast.success(`Договорът за ${client.name} е записан в историята`)
    } catch (e) {
      toast.error(`Записът не мина: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Договорите са достъпни само за администратор.
      </div>
    )
  }

  const loading = clientsQ.isLoading || columnsQ.isLoading || cellsQ.isLoading || contactsQ.isLoading

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ---------- Заглавие + табове ---------- */}
      <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-gold" />
          <h1 className="text-lg font-semibold text-foreground">Договори</h1>
        </div>
        <div className="flex gap-1 ml-auto">
          {([
            ['new', 'Нов договор'],
            ['history', `История (${contractsQ.data?.length ?? 0})`],
            ['templates', 'Шаблони'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                tab === k ? 'bg-gold/15 text-gold' : 'text-muted-foreground hover:bg-muted'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'new' && (
        <div className="flex-1 flex min-h-0 divide-x divide-border">
          {/* ---------- Ляво: избор на клиент ---------- */}
          <div className="w-72 flex flex-col min-h-0 bg-card">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Търси фирма…" className="pl-7 h-8 text-xs" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Зареждане…
                </div>
              )}
              {filteredRows.map(r => (
                <button key={r.id}
                  onClick={() => { setClientId(r.id); setEdits({}) }}
                  className={`w-full text-left px-3 py-1.5 text-xs border-b border-border transition-colors ${
                    r.id === clientId ? 'bg-gold/10 font-semibold text-foreground' : 'hover:bg-muted/50 text-muted-foreground'
                  }`}>
                  {r.name}
                </button>
              ))}
              {!loading && filteredRows.length === 0 && (
                <div className="p-4 text-xs text-muted-foreground">Няма съвпадения.</div>
              )}
            </div>
          </div>

          {/* ---------- Дясно: полета + преглед ---------- */}
          <div className="flex-1 flex flex-col min-h-0">
            {!client ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Изберете фирма отляво.
              </div>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-border bg-card flex flex-wrap items-center gap-2">
                  <select
                    value={template?.id ?? ''}
                    onChange={e => setTemplateId(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={resetEdits} className="h-8 text-xs gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Върни данните от системата
                  </Button>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSave}
                      disabled={!filled || saving} className="h-8 text-xs gap-1.5">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Запиши в историята
                    </Button>
                    <Button size="sm" onClick={handlePrint} disabled={!filled} className="h-8 text-xs gap-1.5">
                      <Printer className="h-3.5 w-3.5" /> Печат / PDF
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {missing.length > 0 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <div className="text-xs text-amber-900 dark:text-amber-200">
                          <strong>Договорът не може да се изготви — липсват данни:</strong>{' '}
                          {missing.map(f => f.label).join(', ')}.
                          <div className="mt-1 opacity-80">
                            Попълнете ги в Контакти (или направо тук отдолу) — договор с празно
                            място не се генерира.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ---- Полетата ---- */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {visibleFields.map(f => {
                      const isMissing = missing.some(m => m.key === f.key)
                      const isEdited = edits[f.key] !== undefined && edits[f.key] !== auto?.[f.key]
                      return (
                        <div key={f.key} className={f.multiline ? 'md:col-span-2' : ''}>
                          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1">
                            {f.label}
                            {isEdited && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                                ръчно
                              </span>
                            )}
                          </label>
                          <Input
                            value={values?.[f.key] ?? ''}
                            onChange={e => setField(f.key, e.target.value)}
                            className={`h-8 text-xs ${isMissing ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                          />
                          <div className="text-[10px] text-muted-foreground mt-0.5">{f.hint}</div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ---- Преглед ---- */}
                  {filled && (
                    <div>
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                        Преглед на готовия договор
                      </div>
                      <div className="rounded-md border border-border bg-white dark:bg-neutral-900 p-6 max-h-[45vh] overflow-y-auto">
                        <ContractPreview body={filled} />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <HistoryTab
          contracts={contractsQ.data ?? []}
          loading={contractsQ.isLoading}
          onChanged={invalidateContracts}
        />
      )}

      {tab === 'templates' && (
        <TemplatesTab templates={templates} onChanged={invalidateContractTemplates} />
      )}
    </div>
  )
}

// ==================== ПРЕГЛЕД ====================

type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'ul'; items: string[] }

function parseBlocks(text: string): Block[] {
  const acc: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('- ')) {
      const last = acc[acc.length - 1]
      if (last && last.kind === 'ul') last.items.push(line.slice(2))
      else acc.push({ kind: 'ul', items: [line.slice(2)] })
    } else if (line.startsWith('### ')) acc.push({ kind: 'h3', text: line.slice(4) })
    else if (line.startsWith('## ')) acc.push({ kind: 'h2', text: line.slice(3) })
    else if (line.startsWith('# ')) acc.push({ kind: 'h1', text: line.slice(2) })
    else acc.push({ kind: 'p', text: line })
  }
  return acc
}

/** Текст с `**удебелени**` части — попълнените от нас данни личат и в преглед. */
function Rich({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { text: string; bold: boolean }[] = []
    let last = 0
    for (const m of text.matchAll(new RegExp(BOLD_RE.source, 'g'))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false })
      out.push({ text: m[1], bold: true })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ text: text.slice(last), bold: false })
    return out
  }, [text])

  return <>{parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</>
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'ul') {
          return (
            <ul key={i} className="list-disc pl-5 mb-2 space-y-1">
              {b.items.map((it, j) => <li key={j} className="text-justify"><Rich text={it} /></li>)}
            </ul>
          )
        }
        if (b.kind === 'h1') return <h1 key={i} className="text-lg font-bold text-center mb-0.5 tracking-wide"><Rich text={b.text} /></h1>
        if (b.kind === 'h2') return <h2 key={i} className="text-sm font-semibold text-center mb-4 text-muted-foreground"><Rich text={b.text} /></h2>
        if (b.kind === 'h3') return <h3 key={i} className="text-sm font-semibold mt-5 mb-1.5 pb-1 border-b border-border"><Rich text={b.text} /></h3>
        return <p key={i} className="mb-1.5 text-justify"><Rich text={b.text} /></p>
      })}
    </>
  )
}

/**
 * Рендира маркъпа на договора като React елементи. Умишлено НЕ през
 * dangerouslySetInnerHTML — текстът идва от базата и от редактируем от admin
 * шаблон, а прегледът живее вътре в приложението.
 *
 * Двуезичните шаблони излизат в две равни колони (BG | EN) — както в печата
 * и както е в оригиналния Word документ.
 */
function ContractPreview({ body }: { body: string }) {
  const bilingual = useMemo(() => isBilingualBody(body), [body])
  // Секциите след маркера „===" се държат като едно цяло при печат; тук ги
  // разделяме само за да покажем същия отстъп, който излиза на хартия.
  const sections = useMemo(() => splitKeepSections(body), [body])
  const cls = 'text-[13px] leading-relaxed text-neutral-900 dark:text-neutral-100'

  if (!bilingual) {
    return (
      <div className={cls}>
        {sections.map((sec, i) => (
          <div key={i} className={i > 0 ? 'mt-6' : ''}>
            <Blocks blocks={parseBlocks(sec)} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <table className={`${cls} w-full table-fixed border-collapse`}>
      {sections.map((sec, si) => (
        <tbody key={si}>
          {parseBilingualRows(sec).map(parts => parts.map(parseBlocks)).map((parts, i) => (
            <tr key={i}>
              {parts.length < 2 ? (
                <td colSpan={2} className={`align-top pb-3 ${si > 0 && i === 0 ? 'pt-6' : ''}`}>
                  <Blocks blocks={parts[0] ?? []} />
                </td>
              ) : (
                <>
                  <td className={`w-1/2 align-top pr-3 pb-3 ${si > 0 && i === 0 ? 'pt-6' : ''}`}>
                    <Blocks blocks={parts[0]} />
                  </td>
                  <td className={`w-1/2 align-top pl-3 pb-3 ${si > 0 && i === 0 ? 'pt-6' : ''}`}>
                    <Blocks blocks={parts[1]} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
}

// ==================== ИСТОРИЯ ====================

function HistoryTab({ contracts, loading, onChanged }: {
  contracts: Contract[]
  loading: boolean
  onChanged: () => void
}) {
  const [preview, setPreview] = useState<Contract | null>(null)
  const [toDelete, setToDelete] = useState<Contract | null>(null)

  async function doDelete() {
    if (!toDelete) return
    try {
      await deleteContract(toDelete.id)
      onChanged()
      toast.success('Договорът е изтрит от историята')
    } catch (e) {
      toast.error(`Изтриването не мина: ${(e as Error).message}`)
    } finally {
      setToDelete(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Зареждане…
      </div>
    )
  }

  if (contracts.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Още няма изготвени договори.</div>
  }

  return (
    <div className="flex-1 flex min-h-0 divide-x divide-border">
      <div className="w-[28rem] overflow-y-auto bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Фирма</th>
              <th className="px-2 py-2 font-semibold whitespace-nowrap">Дата</th>
              <th className="px-2 py-2 font-semibold text-right whitespace-nowrap">Хонорар</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {contracts.map((c, i) => (
              <tr key={c.id}
                onClick={() => setPreview(c)}
                className={`border-b border-border cursor-pointer transition-colors hover:bg-gold/5 ${
                  preview?.id === c.id ? 'bg-gold/10' : i % 2 === 0 ? 'bg-card' : 'bg-muted/20'
                }`}>
                <td className="px-3 py-1.5 font-medium text-foreground">
                  {c.client_name}
                  <div className="text-[10px] text-muted-foreground font-normal">{c.template_name}</div>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatDate(c.contract_date)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                  {c.monthly_fee != null ? `${c.monthly_fee} €` : ''}
                </td>
                <td className="px-1 py-1.5">
                  <button onClick={e => { e.stopPropagation(); setToDelete(c) }}
                    className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/40 text-muted-foreground hover:text-rose-600"
                    title="Изтрий от историята">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {!preview ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Изберете договор отляво.
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                Изготвен на {formatDateTime(preview.created_at)}
                {preview.effective_date && ` • в сила от ${formatDate(preview.effective_date)}`}
              </span>
              <Button size="sm" className="ml-auto h-8 text-xs gap-1.5"
                onClick={() => {
                  const ok = printContract({
                    title: `Договор — ${preview.client_name}`,
                    body: preview.body_snapshot,
                  })
                  if (!ok) toast.error('Браузърът блокира прозореца за печат. Разрешете popup-ите.')
                }}>
                <Printer className="h-3.5 w-3.5" /> Печат / PDF
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-neutral-900">
              <ContractPreview body={preview.body_snapshot} />
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Изтриване на договор"
        description={`Договорът за ${toDelete?.client_name ?? ''} ще изчезне от историята. Действието е необратимо.`}
        confirmLabel="Изтрий"
        destructive
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

// ==================== ШАБЛОНИ ====================

function TemplatesTab({ templates, onChanged }: {
  templates: ContractTemplate[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<ContractTemplate | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<ContractTemplate | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  async function restoreDefaults() {
    setRestoring(true)
    try {
      const n = await restoreDefaultContractTemplates()
      onChanged()
      setEditing(null)
      toast.success(`Стартовите шаблони са възстановени (${n})`)
    } catch (e) {
      toast.error(`Възстановяването не мина: ${(e as Error).message}`)
    } finally {
      setRestoring(false)
      setConfirmRestore(false)
    }
  }

  function startEdit(t: ContractTemplate) {
    setEditing(t); setName(t.name); setBody(t.body)
  }

  function startNew() {
    setEditing({ id: '', name: '', body: '', is_bilingual: false, position: 0,
      created_by: null, created_at: '', updated_at: '' })
    setName(''); setBody('')
  }

  async function save() {
    if (!editing || !name.trim() || !body.trim()) {
      toast.error('Името и текстът са задължителни')
      return
    }
    setSaving(true)
    try {
      if (editing.id) await saveContractTemplate(editing.id, { name: name.trim(), body })
      else await addContractTemplate(name.trim(), body, /^.*\(BG\/EN\).*$/.test(name))
      onChanged()
      setEditing(null)
      toast.success('Шаблонът е записан')
    } catch (e) {
      toast.error(`Записът не мина: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!toDelete) return
    try {
      await deleteContractTemplate(toDelete.id)
      onChanged()
      toast.success('Шаблонът е изтрит')
    } catch (e) {
      toast.error(`Изтриването не мина: ${(e as Error).message}`)
    } finally {
      setToDelete(null)
    }
  }

  const markers = CONTRACT_FIELDS.map(f => `{${f.key}}`)

  return (
    <div className="flex-1 flex min-h-0 divide-x divide-border">
      <div className="w-80 flex flex-col min-h-0 bg-card">
        <div className="p-2 border-b border-border">
          <Button size="sm" onClick={startNew} className="w-full h-8 text-xs gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Нов шаблон
          </Button>
          <Button size="sm" variant="ghost" disabled={restoring}
            onClick={() => setConfirmRestore(true)}
            className="w-full h-7 mt-1 text-[11px] gap-1.5 text-muted-foreground">
            {restoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Възстанови стартовите
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {templates.map(t => (
            <div key={t.id}
              className={`flex items-center gap-1 px-3 py-2 border-b border-border text-xs ${
                editing?.id === t.id ? 'bg-gold/10' : ''
              }`}>
              <button onClick={() => startEdit(t)} className="flex-1 text-left">
                <div className="font-medium text-foreground">{t.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t.is_bilingual ? 'двуезичен' : 'на български'} • {t.body.length.toLocaleString('bg-BG')} знака
                </div>
              </button>
              <button onClick={() => startEdit(t)}
                className="p-1 rounded hover:bg-muted text-muted-foreground" title="Редактирай">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setToDelete(t)}
                className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/40 text-muted-foreground hover:text-rose-600"
                title="Изтрий">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {!editing ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
            Изберете шаблон отляво, за да го редактирате.
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2">
              <Input value={name} onChange={e => setName(e.target.value)}
                placeholder="Име на шаблона" className="h-8 text-xs max-w-md" />
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-8 text-xs gap-1.5">
                  <X className="h-3.5 w-3.5" /> Отказ
                </Button>
                <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Запиши
                </Button>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-border bg-muted/30 text-[10px] text-muted-foreground">
              <div className="mb-1">
                <strong>Маркери</strong> (заменят се с данните на клиента):{' '}
                <span className="font-mono">{markers.join(' ')}</span>
              </div>
              <div>
                <strong>Оформление:</strong>{' '}
                <span className="font-mono"># заглавие</span> ·{' '}
                <span className="font-mono">## подзаглавие</span> ·{' '}
                <span className="font-mono">### раздел</span> ·{' '}
                <span className="font-mono">- булет</span> ·{' '}
                <span className="font-mono">**удебелен**</span> ·{' '}
                <span className="font-mono">===</span> неделима секция · останалото е обикновен абзац
              </div>
            </div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-background p-4 font-mono text-xs leading-relaxed outline-none"
              placeholder="Текст на договора…"
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmRestore}
        title="Възстановяване на стартовите шаблони"
        description={'Двата стартови шаблона („BG" и „BG/EN") ще бъдат презаписани с текста от приложението. Ваши собствени шаблони с други имена не се пипат. Вече изготвените договори също — те пазят своя текст.'}
        confirmLabel="Възстанови"
        onConfirm={restoreDefaults}
        onCancel={() => setConfirmRestore(false)}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Изтриване на шаблон"
        description={`Шаблонът „${toDelete?.name ?? ''}" ще бъде изтрит. Вече изготвените договори не се засягат — те пазят своя текст.`}
        confirmLabel="Изтрий"
        destructive
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
