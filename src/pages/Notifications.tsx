import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Play, Mail, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useAuth } from '../lib/auth'
import {
  updateNotificationSettings, setStaffNotifyEmail,
  sendStaffEmails, sendTestEmail, runNotifications,
} from '../lib/storage'
import { useNotifications, useNotificationSettings, useNotifyStaff, useInvalidateCrm } from '../lib/queries'
import type { NotificationDraft, NotificationSettings, NotificationStatus } from '../lib/types'
import {
  NOTIFICATION_KIND_LABELS, NOTIFICATION_STATUS_CLS, NOTIFICATION_STATUS_LABELS,
  isValidEmail, parseChecklistDays, formatChecklistDays, summarizeResults,
} from '../lib/notifications'
import { formatDateTime } from '../lib/utils'
import { usePersistentState } from '../lib/usePersistentState'

// ============================================================
// Известия по имейл до КОЛЕГИТЕ (не до клиенти — те са в Съобщения).
//
// Автоматичните напомняния се смятат и пращат от edge функцията
// mail-send, която GitHub Action-ът вика всяка сутрин. Тази страница е
// контролният панел: какво е включено, кой го получава, какво е тръгнало.
//
// Само admin (route + RLS). Едно писмо изброява чуждите задачи и фирми.
// ============================================================

type Tab = 'settings' | 'compose' | 'log'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'settings', label: 'Настройки' },
  { key: 'compose', label: 'Ръчно писмо' },
  { key: 'log', label: 'Дневник' },
]

export function NotificationsPage() {
  const { user } = useAuth()
  const [tab, setTab] = usePersistentState<Tab>('notif-tab', 'settings')

  const settingsQ = useNotificationSettings()
  const staffQ = useNotifyStaff()
  const logQ = useNotifications()
  const { invalidateNotifications, invalidateNotificationSettings, invalidateNotifyStaff } = useInvalidateCrm()

  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const log = useMemo(() => logQ.data ?? [], [logQ.data])

  // ---------- Настройки (локална чернова, записва се с бутон) ----------
  const [draft, setDraft] = useState<NotificationSettings | null>(null)
  const [daysText, setDaysText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settingsQ.data && !draft) {
      setDraft(settingsQ.data)
      setDaysText(formatChecklistDays(settingsQ.data.checklist_days))
    }
  }, [settingsQ.data, draft])

  const parsedDays = useMemo(() => parseChecklistDays(daysText), [daysText])

  // Черновата се записва чак с бутона (за да не тръгне нещо от едно
  // случайно кликване). Затова разликата спрямо записаното трябва да е
  // ВИДИМА — иначе човек отмята главния ключ, вижда зелено и си тръгва
  // с грешното убеждение, че е пуснал известията.
  const saved = settingsQ.data
  const dirty = useMemo(() => {
    if (!draft || !saved) return false
    return draft.enabled !== saved.enabled
      || draft.tasks_enabled !== saved.tasks_enabled
      || draft.tasks_days_before !== saved.tasks_days_before
      || draft.checklist_enabled !== saved.checklist_enabled
      || (draft.test_email?.trim() || null) !== (saved.test_email?.trim() || null)
      || parsedDays.join(',') !== (saved.checklist_days ?? []).join(',')
  }, [draft, saved, parsedDays])

  async function saveSettings() {
    if (!draft) return
    if (draft.tasks_days_before < 0 || draft.tasks_days_before > 30) {
      toast.error('Дните за задачите трябва да са между 0 и 30'); return
    }
    if (draft.checklist_enabled && parsedDays.length === 0) {
      toast.error('Посочи поне една дата за напомнянето за чек листа (1–28)'); return
    }
    setSaving(true)
    try {
      await updateNotificationSettings({
        enabled: draft.enabled,
        tasks_enabled: draft.tasks_enabled,
        tasks_days_before: draft.tasks_days_before,
        checklist_enabled: draft.checklist_enabled,
        checklist_days: parsedDays,
        test_email: draft.test_email?.trim() || null,
      })
      toast.success('Настройките са записани')
      invalidateNotificationSettings()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  // ---------- Пробно писмо / пускане ----------
  const [busy, setBusy] = useState<'test' | 'dry' | 'run' | null>(null)
  const [preview, setPreview] = useState<{ date: string; notes: string[]; drafts: NotificationDraft[] } | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)

  async function doTest() {
    const to = draft?.test_email?.trim()
    if (!isValidEmail(to)) { toast.error('Попълни валиден адрес за пробното писмо'); return }
    setBusy('test')
    try {
      const r = await sendTestEmail(to)
      const failed = r.results.find(x => x.status === 'error')
      if (failed) toast.error(failed.error ?? 'Грешка при изпращане')
      else toast.success(`Пробното писмо тръгна към ${to}`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изпращане')
    } finally {
      invalidateNotifications()
      setBusy(null)
    }
  }

  async function doDryRun() {
    setBusy('dry')
    try {
      const r = await runNotifications(true)
      setPreview({ date: r.date, notes: r.notes ?? [], drafts: r.drafts ?? [] })
      if ((r.drafts ?? []).length === 0) toast.info('Днес няма какво да се изпрати')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при пресмятането')
    } finally {
      setBusy(null)
    }
  }

  async function doRun() {
    setConfirmRun(false)
    setBusy('run')
    try {
      const r = await runNotifications()
      toast.success(summarizeResults(r.results ?? []))
      setPreview(null)
      setTab('log')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изпращане')
    } finally {
      invalidateNotifications()
      setBusy(null)
    }
  }

  async function toggleStaffNotify(id: string, value: boolean) {
    try {
      await setStaffNotifyEmail(id, value)
      invalidateNotifyStaff()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при запис')
    }
  }

  // ---------- Ръчно писмо ----------
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const withEmail = useMemo(() => staff.filter(s => isValidEmail(s.email)), [staff])

  async function sendManual() {
    const targets = withEmail.filter(s => selected.has(s.id))
    if (targets.length === 0) { toast.error('Избери поне един получател'); return }
    if (!subject.trim() || !body.trim()) { toast.error('Попълни тема и текст'); return }
    setSending(true)
    try {
      const r = await sendStaffEmails(targets.map(s => ({
        to: s.email!.trim(), to_name: s.full_name, staff_id: s.id,
        subject: subject.trim(), text: body.trim(),
      })))
      const failed = r.results.filter(x => x.status === 'error')
      if (failed.length > 0) toast.error(`${failed.length} писма не тръгнаха: ${failed[0].error ?? ''}`)
      else toast.success(summarizeResults(r.results))
      if (failed.length === 0) { setSubject(''); setBody(''); setSelected(new Set()); setTab('log') }
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изпращане')
    } finally {
      invalidateNotifications()
      setSending(false)
    }
  }

  const loading = settingsQ.isLoading && !settingsQ.data

  // Гейт и в страницата, не само на route-а (както при Шаблони).
  if (user?.role !== 'admin') {
    return <div className="p-5 text-sm text-muted-foreground">Страницата е само за администратори.</div>
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground">🔔 Известия</h1>
          {saved && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
              saved.enabled
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                : 'bg-muted text-muted-foreground'
            }`}>
              {saved.enabled ? 'автоматичните са ВКЛЮЧЕНИ' : 'автоматичните са изключени'}
            </span>
          )}
          {dirty && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              незаписани промени
            </span>
          )}
        </div>
        <div className="flex items-center rounded-lg border border-border overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 text-sm font-semibold transition ${
                tab === t.key
                  ? 'bg-navy text-white dark:bg-primary dark:text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 md:p-5">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Зареждане…
          </div>
        )}

        {/* ==================== НАСТРОЙКИ ==================== */}
        {!loading && tab === 'settings' && draft && (
          <div className="max-w-3xl space-y-5">
            <section className="rounded-xl border border-border bg-card p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-semibold text-foreground">Автоматични напомняния</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Главният ключ. Докато е изключен, графикът се пуска, но не изпраща нищо —
                    ръчните писма и пробното продължават да работят.
                  </span>
                </span>
              </label>
            </section>

            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.tasks_enabled}
                  onChange={e => setDraft({ ...draft, tasks_enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-semibold text-foreground">Задачи с наближаващ срок</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Един обзор на ден до всеки колега — просрочените и предстоящите му задачи.
                    Който няма такива, не получава писмо.
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-2 pl-7">
                <Label htmlFor="nf-days" className="text-xs">Колко дни напред</Label>
                <Input
                  id="nf-days" type="number" min={0} max={30}
                  value={draft.tasks_days_before}
                  onChange={e => setDraft({ ...draft, tasks_days_before: Number(e.target.value) })}
                  className="w-20 h-8"
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.checklist_enabled}
                  onChange={e => setDraft({ ...draft, checklist_enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-semibold text-foreground">Чек лист преди срока за ДДС</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    До счетоводителя и отговорника — фирмите им с незавършен чек лист за работния
                    месец. Срокът е 14-то число. ТРЗ отделът не получава това писмо.
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-2 pl-7">
                <Label htmlFor="nf-cdays" className="text-xs">На кои дати от месеца</Label>
                <Input
                  id="nf-cdays" value={daysText}
                  onChange={e => setDaysText(e.target.value)}
                  placeholder="11, 13"
                  className="w-32 h-8"
                />
                <span className="text-xs text-muted-foreground">
                  {parsedDays.length > 0 ? `→ ${parsedDays.join(', ')}` : 'няма валидна дата (1–28)'}
                </span>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveSettings} disabled={saving || !dirty}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                {dirty ? 'Запази настройките' : 'Настройките са записани'}
              </Button>
              <Button variant="outline" onClick={doDryRun} disabled={busy !== null}>
                {busy === 'dry' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                Пусни сега (пробно)
              </Button>
              <Button variant="outline" onClick={() => setConfirmRun(true)} disabled={busy !== null}>
                {busy === 'run' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                Пусни сега (наистина)
              </Button>
            </div>

            {/* Преглед от dry-run */}
            {preview && (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="font-semibold text-foreground text-sm mb-1">
                  Какво би тръгнало на {preview.date}
                </h2>
                {preview.notes.length > 0 && (
                  <ul className="text-xs text-muted-foreground mb-2 list-disc pl-5">
                    {preview.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                {preview.drafts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нищо — няма получатели за днес.</p>
                ) : (
                  <div className="space-y-3">
                    {preview.drafts.map((d, i) => (
                      <div key={i} className="rounded-lg border border-border p-3">
                        <div className="text-xs text-muted-foreground mb-1">
                          {NOTIFICATION_KIND_LABELS[d.kind as keyof typeof NOTIFICATION_KIND_LABELS] ?? d.kind}
                          {' · '}{d.to_name || d.to} &lt;{d.to}&gt;
                        </div>
                        <div className="font-semibold text-sm text-foreground">{d.subject}</div>
                        <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground font-sans">{d.text}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Пробно писмо */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold text-foreground text-sm mb-2">Пробно писмо</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="nf-test" className="text-xs">Адрес</Label>
                  <Input
                    id="nf-test" type="email" value={draft.test_email ?? ''}
                    onChange={e => setDraft({ ...draft, test_email: e.target.value })}
                    placeholder="my@email.com" className="w-64 h-8"
                  />
                </div>
                <Button variant="outline" onClick={doTest} disabled={busy !== null}>
                  {busy === 'test' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
                  Изпрати пробно
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Адресът се пази чак при „Запази настройките".
              </p>
            </section>

            {/* Получатели */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold text-foreground text-sm mb-2">Кой получава известия</h2>
              <div className="divide-y divide-border">
                {staff.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">{s.full_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {isValidEmail(s.email) ? s.email : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" /> няма имейл в Персонал
                          </span>
                        )}
                        {s.department ? ` · ${s.department}` : ''}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs whitespace-nowrap cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.notify_email !== false}
                        disabled={!isValidEmail(s.email)}
                        onChange={e => toggleStaffNotify(s.id, e.target.checked)}
                        className="h-4 w-4"
                      />
                      получава
                    </label>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ==================== РЪЧНО ПИСМО ==================== */}
        {!loading && tab === 'compose' && (
          <div className="max-w-3xl space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold text-foreground text-sm mb-2">Получатели</h2>
              {withEmail.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Никой в Персонал няма попълнен имейл.
                </p>
              ) : (
                <>
                  <div className="flex gap-2 mb-2">
                    <Button variant="outline" size="sm" onClick={() => setSelected(new Set(withEmail.map(s => s.id)))}>
                      Всички
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                      Никого
                    </Button>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {withEmail.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={e => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(s.id); else next.delete(s.id)
                            setSelected(next)
                          }}
                          className="h-4 w-4"
                        />
                        <span className="truncate">{s.full_name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div>
                <Label htmlFor="nf-subj" className="text-xs">Тема</Label>
                <Input id="nf-subj" value={subject} onChange={e => setSubject(e.target.value)}
                  placeholder="Напр. Събрание в петък" />
              </div>
              <div>
                <Label htmlFor="nf-body" className="text-xs">Текст</Label>
                <textarea
                  id="nf-body" value={body} onChange={e => setBody(e.target.value)}
                  rows={8}
                  placeholder="Всеки ред става отделен абзац в писмото."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Обръщението („Здравей, Иван,") и подписът се слагат автоматично.
                  Не пиши ЕГН, лични карти или банкови данни — писмото напуска системата.
                </p>
              </div>
              <Button onClick={sendManual} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                Изпрати до {selected.size} {selected.size === 1 ? 'човек' : 'души'}
              </Button>
            </section>
          </div>
        )}

        {/* ==================== ДНЕВНИК ==================== */}
        {!loading && tab === 'log' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Последните {log.length} писма. Автоматичните нямат автор.
              </p>
              <Button variant="outline" size="sm" onClick={() => invalidateNotifications()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Опресни
              </Button>
            </div>
            {log.length === 0 ? (
              <p className="text-sm text-muted-foreground">Още нищо не е изпращано.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Кога</th>
                      <th className="text-left font-semibold px-3 py-2">Вид</th>
                      <th className="text-left font-semibold px-3 py-2">До</th>
                      <th className="text-left font-semibold px-3 py-2">Тема</th>
                      <th className="text-left font-semibold px-3 py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {log.map(n => (
                      <tr key={n.id} className="align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(n.created_at)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {NOTIFICATION_KIND_LABELS[n.kind as keyof typeof NOTIFICATION_KIND_LABELS] ?? n.kind}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="text-foreground">{n.to_name || '—'}</div>
                          <div className="text-muted-foreground">{n.to_email}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-foreground">
                          {n.subject}
                          {n.error && <div className="text-rose-600 dark:text-rose-400 mt-0.5">{n.error}</div>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                            NOTIFICATION_STATUS_CLS[n.status as NotificationStatus] ?? 'bg-muted text-muted-foreground'
                          }`}>
                            {NOTIFICATION_STATUS_LABELS[n.status as NotificationStatus] ?? n.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRun}
        title="Да пусна напомнянията сега?"
        description="Писмата тръгват веднага към колегите. Защитата от дублиране пази да не получат второ писмо за същия ден."
        confirmLabel="Изпрати"
        onConfirm={doRun}
        onCancel={() => setConfirmRun(false)}
      />
    </div>
  )
}
