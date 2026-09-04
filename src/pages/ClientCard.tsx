import { useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Building2, Phone, Globe, MapPin, AlertTriangle, User,
  ClipboardCheck, Banknote, KanbanSquare, MessageSquare, Coins, Wallet, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import {
  useClients, useColumns, useCellValues, useDropdownOptions, useAllContacts,
  useClientProfiles, useMonthlyWork, useTrzWork, usePaymentConfigs, usePaymentStatuses,
  useTasks, useClientMessages, useFinancialClosings, useCashLoanEntries,
  useTags, useClientTags,
} from '../lib/queries'
import {
  buildCellIndex, buildDropdownIndex, clientDisplayName, resolveDropdownText, resolveNumber,
} from '../lib/tableIndices'
import { statusBadgeClass } from '../lib/statusBadge'
import { MONTH_NAMES, formatDate } from '../lib/utils'
import { lastWorkMonths, orDash, vatDisplay } from '../lib/clientCard'

// ============================================================
// Карта на клиента — всичко важно за една фирма на един екран.
//
// Нищо ново в базата: страницата само СЪБИРА данни, които вече стоят
// пръснати по Клиенти, Контакти, Профили, Работен лист, ТРЗ, Плащания,
// Задачи, Съобщения, Каси и заеми и Финансов мониторинг.
//
// ПРАВАТА се спазват както в отделните страници:
//   Хонорар                  → само admin (в UI; в базата cell_values е
//                              четимо за всички логнати — известен, приет риск)
//   Финансов мониторинг,
//   каси и заеми             → скрити за отдел ТРЗ
// Банковият достъп НЕ влиза изобщо — паролите си остават на своя екран,
// със своите права.
// ============================================================

const MASTER_COLS = ['Статус', 'Счетоводител', 'Отговорник', 'Чл. 55 ЗДДФЛ', 'Авансови вноски', 'Мониторинг', 'Касов апарат'] as const

function Section({ title, icon: Icon, children, hint }: {
  title: string
  icon: typeof Building2
  children: React.ReactNode
  hint?: string
}) {
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h2>
        {hint && <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm text-foreground break-words ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

/** Отметка за месец — √ или тире, без да заема място. */
function Tick({ on }: { on: boolean | null | undefined }) {
  return on
    ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
    : <span className="text-muted-foreground/40">—</span>
}

export function ClientCardPage() {
  const { id: clientId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { inDept } = useMyStaff()
  const isAdmin = user?.role === 'admin'
  const isTrz = inDept('ТРЗ')

  const clientsQ = useClients()
  const columnsQ = useColumns()
  const cellsQ = useCellValues()
  const dropdownsQ = useDropdownOptions()
  const contactsQ = useAllContacts()
  const profilesQ = useClientProfiles()
  const paymentConfigsQ = usePaymentConfigs()
  const tasksQ = useTasks()
  const messagesQ = useClientMessages()
  const tagsQ = useTags()
  const clientTagsQ = useClientTags()

  const months = useMemo(() => lastWorkMonths(new Date(), 3), [])
  const paymentStatusesQ = usePaymentStatuses(months[0].year)
  const closingsQ = useFinancialClosings(months[0].year)
  // Каси и заеми: записите са ДВИЖЕНИЕ за месеца, затова се тегли цялата
  // година до работния месец и се сумира — същото, което прави страницата.
  const cashMonths = useMemo(
    () => Array.from({ length: months[0].month }, (_, i) => i + 1),
    [months],
  )
  const cashLoanQ = useCashLoanEntries(months[0].year, cashMonths)

  // Три месеца = три заявки. Всяка е споделена с Работния лист, тоест при
  // идване оттам вече са в кеша.
  const w0 = useMonthlyWork(months[0].year, months[0].month)
  const w1 = useMonthlyWork(months[1].year, months[1].month)
  const w2 = useMonthlyWork(months[2].year, months[2].month)
  const t0 = useTrzWork(months[0].year, months[0].month)
  const t1 = useTrzWork(months[1].year, months[1].month)
  const t2 = useTrzWork(months[2].year, months[2].month)
  const workQueries = [w0, w1, w2]
  const trzQueries = [t0, t1, t2]

  const columns = useMemo(() => columnsQ.data ?? [], [columnsQ.data])
  const cellIdx = useMemo(() => buildCellIndex(cellsQ.data ?? []), [cellsQ.data])
  const dropdownIdx = useMemo(() => buildDropdownIndex(dropdownsQ.data ?? []), [dropdownsQ.data])

  const ready = !!clientsQ.data && !!columnsQ.data && !!cellsQ.data && !!dropdownsQ.data
  const client = (clientsQ.data ?? []).find(c => c.id === clientId)
  const name = ready && client ? clientDisplayName(clientId, columns, cellIdx) : ''

  const master = useMemo(() => {
    const m = new Map<string, string>()
    for (const cname of MASTER_COLS) {
      const col = columns.find(c => c.name === cname)
      m.set(cname, col ? resolveDropdownText(clientId, col, cellIdx, dropdownIdx).trim() : '')
    }
    return m
  }, [columns, cellIdx, dropdownIdx, clientId])

  const honorar = useMemo(() => {
    if (!isAdmin) return null
    const col = columns.find(c => c.name === 'Хонорар')
    return col ? resolveNumber(clientId, col, cellIdx) : null
  }, [isAdmin, columns, cellIdx, clientId])

  const rating = useMemo(() => {
    const col = columns.find(c => c.name === 'Оценка на клиент' && c.type === 'dropdown')
    return col ? resolveDropdownText(clientId, col, cellIdx, dropdownIdx).trim() : ''
  }, [columns, cellIdx, dropdownIdx, clientId])

  const contact = (contactsQ.data ?? []).find(c => c.client_id === clientId)
  const profile = (profilesQ.data ?? []).find(p => p.client_id === clientId)
  const paymentConfig = (paymentConfigsQ.data ?? []).find(p => p.client_id === clientId)

  const openTasks = useMemo(
    () => (tasksQ.data ?? []).filter(t => t.client_id === clientId && t.status !== 'done'),
    [tasksQ.data, clientId],
  )
  const messages = useMemo(
    () => (messagesQ.data ?? [])
      .filter(m => m.client_id === clientId)
      .slice(0, 5),
    [messagesQ.data, clientId],
  )
  const tags = useMemo(() => {
    const mine = new Set((clientTagsQ.data ?? []).filter(t => t.client_id === clientId).map(t => t.tag_id))
    return (tagsQ.data ?? []).filter(t => mine.has(t.id))
  }, [tagsQ.data, clientTagsQ.data, clientId])

  // Натрупано от началото на годината до работния месец — по вид.
  const cashLoan = useMemo(() => {
    let cash = 0, loan = 0
    for (const e of cashLoanQ.data ?? []) {
      if (e.client_id !== clientId) continue
      if (e.kind === 'cash') cash += e.amount
      else loan += e.amount
    }
    return { cash, loan, has: (cashLoanQ.data ?? []).some(e => e.client_id === clientId) }
  }, [cashLoanQ.data, clientId])
  const closings = useMemo(
    () => (closingsQ.data ?? []).filter(c => c.client_id === clientId).sort((a, b) => b.period_no - a.period_no),
    [closingsQ.data, clientId],
  )

  // Плащания за работния месец — какво правим и платено ли е.
  const paidSet = useMemo(() => {
    const s = new Set<string>()
    ;(paymentStatusesQ.data ?? []).forEach(p => {
      if (p.client_id === clientId && p.month === months[0].month && p.paid) s.add(p.payment_type)
    })
    return s
  }, [paymentStatusesQ.data, clientId, months])

  const monitored = master.get('Мониторинг')?.toUpperCase() === 'ДА'

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] text-muted-foreground">
        <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Зареждане...</div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Няма такъв клиент.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Към Клиенти
        </Button>
      </div>
    )
  }

  const status = master.get('Статус') ?? ''

  return (
    <div className="h-[calc(100vh-3.5rem)] md:h-screen overflow-auto bg-muted/20">
      {/* Заглавка */}
      <div className="px-3 py-3 md:px-5 border-b border-border bg-card">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/clients')} title="Към Клиенти">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg md:text-xl font-semibold text-foreground">{name || '(без име)'}</h1>
              {status && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass(status)}`}>{status}</span>
              )}
              {rating && (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-muted text-foreground border border-border">
                  Оценка: {rating}
                </span>
              )}
              {tags.map(t => (
                <span key={t.id}
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium border"
                  style={{ backgroundColor: `${t.color}22`, borderColor: t.color, color: t.color }}>
                  {t.name}
                </span>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>ЕИК <span className="font-mono text-foreground">{orDash(contact?.eik)}</span></span>
              <span>ДДС <span className="font-mono text-foreground">{vatDisplay(contact?.vat_number ?? null, contact?.eik ?? null, contact?.vat_registered_at ?? null)}</span></span>
              {contact?.vat_registered_at && <span>по ДДС от {formatDate(contact.vat_registered_at)}</span>}
              {isAdmin && honorar != null && (
                <span>Хонорар <span className="font-semibold text-foreground">{honorar.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} лв.</span></span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 md:p-4 space-y-3 max-w-[1400px]">
        {/* Внимавай — най-отгоре, ако има */}
        {profile?.warnings?.trim() && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30 px-3 py-2 flex gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-300">Внимавай</div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{profile.warnings}</p>
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Кой го води + признаци */}
          <Section title="Кой го води" icon={User}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Счетоводител" value={orDash(master.get('Счетоводител'))} />
              <Field label="Отговорник" value={orDash(master.get('Отговорник'))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(['Чл. 55 ЗДДФЛ', 'Авансови вноски', 'Мониторинг', 'Касов апарат'] as const).map(k => {
                const v = master.get(k) ?? ''
                if (!v) return null
                const yes = v.toUpperCase() === 'ДА'
                return (
                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                    yes
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}>{k}: {v}</span>
                )
              })}
            </div>
          </Section>

          {/* Контакти */}
          <Section title="Контакти" icon={Phone}>
            {!contact ? (
              <p className="text-sm text-muted-foreground">Няма попълнени контакти.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Собственик" value={orDash(contact.owner_name)} />
                  <Field label="Телефон" value={
                    contact.owner_phone
                      ? <a href={`tel:${contact.owner_phone}`} className="text-primary hover:underline font-mono">{contact.owner_phone}</a>
                      : '—'
                  } />
                  <Field label="Имейл" value={
                    contact.owner_email
                      ? <a href={`mailto:${contact.owner_email}`} className="text-primary hover:underline break-all">{contact.owner_email}</a>
                      : '—'
                  } />
                  <Field label="Управител" value={orDash(contact.manager_name)} />
                </div>
                {contact.company_email && (
                  <Field label="Фирмен имейл" value={
                    <a href={`mailto:${contact.company_email}`} className="text-primary hover:underline break-all">{contact.company_email}</a>
                  } />
                )}
                {contact.address && (
                  <div className="flex items-start gap-1.5 text-sm text-foreground">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span>{contact.address}</span>
                  </div>
                )}
                {contact.website && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={contact.website} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{contact.website}</a>
                  </div>
                )}
                {contact.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{contact.notes}</p>}
              </div>
            )}
          </Section>
        </div>

        {/* Профил */}
        {(profile?.business_activity || profile?.business_notes) && (
          <Section title="Профил" icon={Building2}>
            <div className="grid gap-3 md:grid-cols-2">
              {profile?.business_activity && <Field label="Дейност" value={<span className="whitespace-pre-wrap">{profile.business_activity}</span>} />}
              {profile?.business_notes && <Field label="Особености" value={<span className="whitespace-pre-wrap">{profile.business_notes}</span>} />}
            </div>
          </Section>
        )}

        {/* Последните 3 работни месеца */}
        <Section title="Последните 3 месеца" icon={ClipboardCheck} hint="Работен лист и ТРЗ">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[620px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 pr-3 font-medium">Месец</th>
                  <th className="py-1.5 px-2 font-medium">ДДС</th>
                  <th className="py-1.5 px-2 font-medium">Банка</th>
                  <th className="py-1.5 px-2 font-medium">Заплати</th>
                  <th className="py-1.5 px-2 font-medium">Аморт.</th>
                  <th className="text-right py-1.5 px-2 font-medium">Резултат</th>
                  <th className="py-1.5 px-2 font-medium">Подадено</th>
                  <th className="py-1.5 px-2 font-medium">ТРЗ осиг.</th>
                  <th className="py-1.5 px-2 font-medium">Фишове</th>
                </tr>
              </thead>
              <tbody>
                {months.map((mm, i) => {
                  const w = (workQueries[i].data ?? []).find(x => x.client_id === clientId)
                  const t = (trzQueries[i].data ?? []).find(x => x.client_id === clientId)
                  const loading = workQueries[i].isLoading && !workQueries[i].data
                  return (
                    <tr key={`${mm.year}-${mm.month}`} className="border-b border-border/50">
                      <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">
                        {MONTH_NAMES[mm.month - 1]} {mm.year}
                      </td>
                      {loading ? (
                        <td colSpan={8} className="py-1.5 text-center text-muted-foreground">зареждане...</td>
                      ) : !w && !t ? (
                        <td colSpan={8} className="py-1.5 text-center text-muted-foreground/60">няма попълнено</td>
                      ) : (
                        <>
                          <td className="text-center"><Tick on={w?.vat_accounted} /></td>
                          <td className="text-center"><Tick on={w?.bank_done} /></td>
                          <td className="text-center"><Tick on={w?.salaries_done} /></td>
                          <td className="text-center"><Tick on={w?.amortization_done} /></td>
                          <td className="text-right tabular-nums text-foreground px-2">
                            {w?.result_amount != null ? w.result_amount.toLocaleString('bg-BG', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="text-center text-muted-foreground whitespace-nowrap px-2">
                            {w?.submitted_at ? formatDate(w.submitted_at) : '—'}
                          </td>
                          <td className="text-center"><Tick on={t?.insurance_submitted} /></td>
                          <td className="text-center"><Tick on={t?.payroll_sent} /></td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Плащания */}
          <Section title="Плащания" icon={Banknote} hint={`${MONTH_NAMES[months[0].month - 1]} ${months[0].year}`}>
            {!paymentConfig || paymentConfig.payment_types.length === 0 ? (
              <p className="text-sm text-muted-foreground">Не правим плащания за тази фирма.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {paymentConfig.payment_types.map(t => {
                    const paid = paidSet.has(t)
                    return (
                      <span key={t} className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                        paid
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                      }`}>{t}: {paid ? 'платено' : 'неплатено'}</span>
                    )
                  })}
                </div>
                {paymentConfig.bank && <div className="mt-2"><Field label="Банка" value={paymentConfig.bank} /></div>}
              </>
            )}
          </Section>

          {/* Задачи и проверки */}
          <Section title="Задачи и проверки" icon={KanbanSquare} hint={openTasks.length > 0 ? `${openTasks.length} отворени` : undefined}>
            {openTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Няма отворени.</p>
            ) : (
              <ul className="space-y-1.5">
                {openTasks.map(t => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${t.kind === 'inspection' ? 'bg-rose-500' : 'bg-violet-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground">{t.title}</span>
                      {t.due_date && <span className="ml-2 text-[11px] text-muted-foreground">до {formatDate(t.due_date)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/tasks" className="inline-block mt-2 text-[11px] text-primary hover:underline">Към Задачи →</Link>
          </Section>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Съобщения до клиента */}
          <Section title="Последни съобщения" icon={MessageSquare}>
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Няма изпратени.</p>
            ) : (
              <ul className="space-y-2">
                {messages.map(m => (
                  <li key={m.id} className="text-sm">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{formatDate(m.created_at)}</span>
                      {m.delivered_channel && <span className="uppercase">{m.delivered_channel}</span>}
                      <span>{m.status}</span>
                    </div>
                    <p className="text-foreground line-clamp-2">{m.text}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/messages" className="inline-block mt-2 text-[11px] text-primary hover:underline">Към Съобщения →</Link>
          </Section>

          {/* Финансови приключвания — само за фирми с „Мониторинг" и не за ТРЗ */}
          {monitored && !isTrz && (
            <Section title="Финансови приключвания" icon={Coins} hint={String(months[0].year)}>
              {closings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Няма въведени за {months[0].year}.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1 font-medium">Период</th>
                      <th className="text-right py-1 font-medium">Приходи</th>
                      <th className="text-right py-1 font-medium">Разходи</th>
                      <th className="text-right py-1 font-medium">Резултат</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closings.slice(0, 4).map(c => (
                      <tr key={c.id} className="border-b border-border/50">
                        <td className="py-1 text-foreground">{c.period_kind === 'quarter' ? `Тримесечие ${c.period_no}` : MONTH_NAMES[c.period_no - 1]}</td>
                        <td className="py-1 text-right tabular-nums">{c.income.toLocaleString('bg-BG', { minimumFractionDigits: 2 })}</td>
                        <td className="py-1 text-right tabular-nums">{c.expense.toLocaleString('bg-BG', { minimumFractionDigits: 2 })}</td>
                        <td className={`py-1 text-right tabular-nums font-semibold ${
                          c.income - c.expense >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}>{(c.income - c.expense).toLocaleString('bg-BG', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}
        </div>

        {/* Каси и заеми — натрупано от началото на годината. Скрито за ТРЗ,
            както е и самата страница Финансов мониторинг. */}
        {!isTrz && cashLoan.has && (
          <Section title="Каси и заеми" icon={Wallet} hint={`натрупано към ${MONTH_NAMES[months[0].month - 1]} ${months[0].year}`}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Каса" value={
                <span className="tabular-nums font-semibold">
                  {cashLoan.cash.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} лв.
                </span>
              } />
              <Field label="Заеми" value={
                <span className="tabular-nums font-semibold">
                  {cashLoan.loan.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} лв.
                </span>
              } />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Сборът на месечните движения от януари до работния месец.
            </p>
            <Link to="/cash-loans" className="inline-block mt-1 text-[11px] text-primary hover:underline">Към Финансов мониторинг →</Link>
          </Section>
        )}

      </div>
    </div>
  )
}
