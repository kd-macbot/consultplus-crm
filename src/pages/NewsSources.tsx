import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Newspaper, Plus, Trash2, Loader2, Play, Send, CheckCircle2, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useAuth } from '../lib/auth'
import { useMyStaff } from '../lib/useMyStaff'
import {
  addNewsSource, updateNewsSource, deleteNewsSource,
  updateNewsSettings, checkNewsSource, runNewsFetch,
} from '../lib/storage'
import { useNewsSources, useNewsSettings, useInvalidateCrm } from '../lib/queries'
import type { FeedCheck, NewsSettings, NewsSource } from '../lib/types'
import { formatDateTime, timeAgo } from '../lib/utils'

// ============================================================
// Новини от бранша — извори.
//
// Достъп: admin + мениджъри от „Управление" — същите, които пишат новини.
//
// Бутонът „Провери" вика edge функцията, защото браузърът не може да чете
// чужди феедове (CORS). Така всеки нов адрес се тества веднага, вместо да
// се чака утрешното пускане.
// ============================================================

export function NewsSourcesPage() {
  const { user } = useAuth()
  const { inDept } = useMyStaff()
  const isAdmin = user?.role === 'admin'
  const canUse = isAdmin || (user?.role === 'manager' && inDept('Управление'))

  const sourcesQ = useNewsSources()
  const settingsQ = useNewsSettings()
  const { invalidateNewsSources, invalidateNewsSettings, invalidateIndustryNews } = useInvalidateCrm()

  const sources = useMemo(() => sourcesQ.data ?? [], [sourcesQ.data])

  const [draft, setDraft] = useState<NewsSettings | null>(null)
  useEffect(() => { if (settingsQ.data && !draft) setDraft(settingsQ.data) }, [settingsQ.data, draft])

  const saved = settingsQ.data
  const dirty = !!draft && !!saved
    && (draft.enabled !== saved.enabled || draft.max_per_run !== saved.max_per_run)

  const [busy, setBusy] = useState<'save' | 'dry' | 'run' | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, FeedCheck>>({})
  const [confirmDelete, setConfirmDelete] = useState<NewsSource | null>(null)
  const [preview, setPreview] = useState<Array<{ title: string; source_name: string; source_url: string }> | null>(null)

  // Нов извор
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)

  async function saveSettings() {
    if (!draft) return
    if (draft.max_per_run < 1 || draft.max_per_run > 20) {
      toast.error('Броят новини на пускане трябва да е между 1 и 20'); return
    }
    setBusy('save')
    try {
      await updateNewsSettings({ enabled: draft.enabled, max_per_run: draft.max_per_run })
      toast.success('Настройките са записани')
      invalidateNewsSettings()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при запис')
    } finally { setBusy(null) }
  }

  async function check(id: string, url: string) {
    setChecking(id)
    try {
      const r = await checkNewsSource(url)
      setChecks(prev => ({ ...prev, [id]: r }))
      if (r.ok) {
        toast.success(`Намерени ${r.count} новини`)
        // Откритият феед се запомня, за да не се търси всеки път.
        if (id !== 'new' && r.feed_url) {
          await updateNewsSource(id, { feed_url: r.feed_url })
          invalidateNewsSources()
        }
      } else {
        toast.error(r.error ?? 'Няма феед на този адрес')
      }
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при проверката')
    } finally { setChecking(null) }
  }

  async function addSource() {
    if (!newName.trim() || !newUrl.trim()) { toast.error('Попълни име и адрес'); return }
    setAdding(true)
    try {
      await addNewsSource({ name: newName.trim(), url: newUrl.trim() })
      toast.success('Изворът е добавен')
      setNewName(''); setNewUrl('')
      setChecks(prev => { const n = { ...prev }; delete n.new; return n })
      invalidateNewsSources()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при добавяне')
    } finally { setAdding(false) }
  }

  async function toggle(s: NewsSource, enabled: boolean) {
    try {
      await updateNewsSource(s.id, { enabled })
      invalidateNewsSources()
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при запис')
    }
  }

  async function remove(s: NewsSource) {
    setConfirmDelete(null)
    try {
      await deleteNewsSource(s.id)
      toast.success('Изворът е премахнат')
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при изтриване')
    } finally { invalidateNewsSources() }
  }

  async function run(dry: boolean) {
    setBusy(dry ? 'dry' : 'run')
    try {
      const r = await runNewsFetch(dry)
      if (r.skipped) { toast.info(r.skipped); return }
      if (dry) {
        setPreview((r.drafts ?? []).map(d => ({ title: d.title, source_name: d.source_name, source_url: d.source_url })))
        if ((r.drafts ?? []).length === 0) toast.info('Няма нови новини за добавяне')
      } else {
        toast.success(`Добавени ${r.added ?? 0} новини`)
        setPreview(null)
        invalidateIndustryNews()
      }
      if (r.notes && r.notes.length > 0) {
        toast.warning(r.notes.join(' · '))
      }
    } catch (e) {
      toast.error((e as Error).message ?? 'Грешка при четенето')
    } finally {
      invalidateNewsSources()
      setBusy(null)
    }
  }

  if (!canUse) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        Страницата е достъпна само за администратори и отдел „Управление".
      </div>
    )
  }

  const loading = settingsQ.isLoading && !settingsQ.data

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="px-3 py-2 md:px-5 md:py-3 flex flex-wrap gap-y-2 items-center justify-between border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
            <Newspaper className="h-4 w-4" /> Новини от бранша
          </h1>
          {saved && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
              saved.enabled
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                : 'bg-muted text-muted-foreground'
            }`}>
              {saved.enabled ? 'автоматичното четене е ВКЛЮЧЕНО' : 'автоматичното четене е изключено'}
            </span>
          )}
          {dirty && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              незаписани промени
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 md:p-5 space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Зареждане…
          </div>
        )}

        {!loading && draft && (
          <>
            <section className="rounded-xl border border-border bg-card p-4 space-y-3 max-w-3xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox" checked={draft.enabled}
                  onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-semibold text-foreground">Автоматично четене всяка делнична сутрин</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Новините влизат в отделен блок „От бранша" под Календара и изчезват след 5 дни.
                    Пазят се заглавието и линкът към оригинала — без преразказ.
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-2 pl-7">
                <Label htmlFor="ns-max" className="text-xs">Най-много новини на пускане</Label>
                <Input
                  id="ns-max" type="number" min={1} max={20}
                  value={draft.max_per_run}
                  onChange={e => setDraft({ ...draft, max_per_run: Number(e.target.value) })}
                  className="w-20 h-8"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={saveSettings} disabled={busy !== null || !dirty}>
                  {busy === 'save' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  {dirty ? 'Запази настройките' : 'Настройките са записани'}
                </Button>
                <Button variant="outline" onClick={() => void run(true)} disabled={busy !== null}>
                  {busy === 'dry' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                  Пусни сега (пробно)
                </Button>
                <Button variant="outline" onClick={() => void run(false)} disabled={busy !== null}>
                  {busy === 'run' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Пусни сега
                </Button>
              </div>
            </section>

            {preview && (
              <section className="rounded-xl border border-border bg-card p-4 max-w-3xl">
                <h2 className="font-semibold text-foreground text-sm mb-2">Какво би влязло</h2>
                {preview.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нищо ново — всичко от феедовете вече е публикувано.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {preview.map((d, i) => (
                      <li key={i} className="text-xs">
                        <a href={d.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-foreground hover:underline">{d.title}</a>
                        <span className="text-muted-foreground"> · {d.source_name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Извори */}
            <section className="rounded-xl border border-border bg-card p-4 max-w-3xl">
              <h2 className="font-semibold text-foreground text-sm mb-3">Извори</h2>

              {sources.length === 0 && (
                <p className="text-sm text-muted-foreground mb-3">
                  Още няма извори. Добави адрес отдолу и натисни „Провери" — функцията сама
                  открива фееда, ако сайтът обявява такъв.
                </p>
              )}

              <div className="divide-y divide-border">
                {sources.map(s => {
                  const c = checks[s.id]
                  return (
                    <div key={s.id} className="py-3 flex flex-wrap items-start gap-3">
                      <input
                        type="checkbox" checked={s.enabled}
                        onChange={e => void toggle(s, e.target.checked)}
                        className="mt-1 h-4 w-4" title={s.enabled ? 'Включен' : 'Изключен'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground font-medium flex items-center gap-1.5">
                          {s.name}
                          <a href={s.url} target="_blank" rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {s.feed_url || s.url}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          {s.last_error ? (
                            <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> {s.last_error}
                            </span>
                          ) : s.last_ok_at ? (
                            <span className="text-muted-foreground">
                              последно четене {timeAgo(s.last_ok_at)}
                              {s.last_item_at && ` · последна новина ${formatDateTime(s.last_item_at)}`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/70">още не е четен</span>
                          )}
                        </div>
                        {c && (
                          <div className={`text-[11px] mt-1 ${c.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {c.ok
                              ? <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {c.count} новини · последна: {c.latest?.[0]?.title}</span>
                              : <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {c.error}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-[11px] text-muted-foreground">макс.</Label>
                        <Input
                          type="number" min={1} max={10} value={s.max_per_run}
                          onChange={e => void updateNewsSource(s.id, { max_per_run: Number(e.target.value) }).then(invalidateNewsSources)}
                          className="w-14 h-7 text-xs"
                        />
                        <Button size="sm" variant="outline" onClick={() => void check(s.id, s.feed_url || s.url)}
                          disabled={checking === s.id}>
                          {checking === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Провери'}
                        </Button>
                        <button onClick={() => setConfirmDelete(s)} title="Премахни"
                          className="text-muted-foreground hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Нов извор */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="ns-name" className="text-xs">Име</Label>
                    <Input id="ns-name" value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder="КиК Инфо — НАП" className="w-52 h-8" />
                  </div>
                  <div className="flex-1 min-w-[240px]">
                    <Label htmlFor="ns-url" className="text-xs">Адрес</Label>
                    <Input id="ns-url" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                      placeholder="https://kik-info.com/novini/nap/" className="h-8" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void check('new', newUrl)}
                    disabled={!newUrl.trim() || checking === 'new'}>
                    {checking === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Провери'}
                  </Button>
                  <Button size="sm" onClick={() => void addSource()} disabled={adding}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Добави
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Сложи адреса, който сам би отворил — функцията търси фееда в страницата,
                  после пробва обичайните адреси и спрямо пътеката, и спрямо корена на домейна.
                  Ако сайтът няма RSS, работи и търсене в Google Новини:{' '}
                  <code className="text-[10px]">
                    https://news.google.com/rss/search?q=НАП+ДДС&amp;hl=bg&amp;gl=BG&amp;ceid=BG:bg
                  </code>
                </p>
                {checks.new && (
                  <div className={`text-[11px] mt-2 ${checks.new.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {checks.new.ok ? (
                      <>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Феед: {checks.new.feed_url} · {checks.new.count} новини
                        </div>
                        <ul className="mt-1 ml-4 list-disc text-muted-foreground">
                          {(checks.new.latest ?? []).map((l, i) => <li key={i}>{l.title}</li>)}
                        </ul>
                      </>
                    ) : (
                      <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {checks.new.error}</span>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Да премахна ли извора?"
        description={confirmDelete ? `${confirmDelete.name}. Вече публикуваните новини остават.` : ''}
        destructive
        confirmLabel="Премахни"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
