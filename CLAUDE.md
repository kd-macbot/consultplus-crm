# ConsultPlus CRM — паметта на проекта

CRM за българска счетоводна фирма (Консулт Плюс). Работи се на **български** —
отговаряй на български, commit съобщенията също са на български.

⚠️ **НАЙ-ВАЖНОТО ПРАВИЛО**: системата се ползва активно с РЕАЛНИ ДАННИ от
колегите. Нищо на live не се променя без изричен тест на dev. Миграциите са
само additive; никога destructive без изрично искане.

## Стек и среди

- React 18 + Vite + TypeScript + Tailwind + shadcn/ui, lucide-react икони
- Supabase (PostgreSQL + Auth + RLS + Edge Functions + Realtime)
- React Query (TanStack) с persistent localStorage кеш
- Cloudflare Pages: branch `dev` → dev preview (dev Supabase), branch `main` → live (prod Supabase)
- **Live домейн: cplus360.com** (custom domain в CF, + www; добавен в Supabase
  Redirect URLs). Име на приложението: **Consult Plus 360**. Логата са в
  `src/assets/brand/` (bundled imports — НЕ в public/, заради base path-а)

## Работен процес (следвай го стриктно)

1. Нова функционалност → feature branch от **dev** → PR към dev
2. Ако има миграция: дай на потребителя SQL-а да го пусне ръчно в Supabase SQL
   Editor (първо dev), ЧАК СЛЕД ТОВА мерджвай PR-а към dev
3. Потребителят тества на dev → казва „мерджнах"/„ок"/„пускай"
4. За live: потребителят пуска миграцията на **prod** Supabase → потвърди →
   PR dev → main → merge. НИКОГА код с нова колона/таблица преди миграцията на prod!
5. Дребни fix-ове без миграция може направо dev → main след потвърждение
6. Миграционните файлове живеят в `supabase/migration-NNN-*.sql`, идемпотентни
   (`if not exists`, `drop policy if exists`, DO-блокове за constraints/realtime)

## Ключова архитектура (src/lib)

- `supabase.ts` — клиент с **custom auth lock (5s timeout)** и **timeoutFetch
  (10s / 30s за edge)** — решава „забива след заспал таб" (deadlock в
  navigator.locks + stale HTTP/2 връзки)
- `storage.ts` — ВСИЧКИ заявки към БД. Четене: `withRetry` (timeout+retry+
  attemptAutoReload). Запис: `trackSave` (15s timeout → auto-reload при hang)
- `recovery.ts` — `attemptAutoReload` със smart backoff (max 4 reload-а/5мин)
- `queries.ts` — RQ hooks (`useClients`, `useTasks`…) + `useInvalidateCrm()`;
  staleTime 5мин, refetchOnWindowFocus ИЗКЛЮЧЕН (умишлено!)
- `usePendingPatches.ts` — durable pending слой (localStorage) за записи:
  промяна оцелява refetch/reload до потвърден запис. Ползва се от Trz и
  WorkSheet; Checklist има собствена по-стара имплементация (не пипай без повод)
- `useMyStaff.ts` — ЕДИНСТВЕНИЯТ lookup „потребител → staff запис" (namesMatch:
  нормализирано име). Дава `{ myStaff, inDept, isAdmin }`
- `utils.ts` — `formatDate` (DD.MM.YYYY), `formatDateTime`, `timeAgo`,
  `calcTenure`, `namesMatch`, `previousMonth`, `workingDays*` (Пн-Пт, БЕЗ
  официални празници — ако се добавят, пипа се само тук)
- `useRealtime.ts` — подписка по таблици → invalidate (с optional shouldDefer)

## Важни конвенции

- **EAV модел**: клиентските данни са в `crm_cell_values` (client × column).
  Името на фирмата = стойността на ПЪРВАТА text колона (по position)
- Колони „Статус", „Счетоводител", „Отговорник", „Чл. 55 ЗДДФЛ" се търсят ПО ИМЕ
- **Работен месец** = предходният календарен (`previousMonth()`); ДДС срок = 14-то
  число на месеца след работния. Тази конвенция е навсякъде (чек лист, бадж
  Плащания, проверяващи)
- Роли: admin / manager / employee (в `profiles`). Отдели: Счетоводство, ТРЗ,
  Тийм Лийд, Управление, Друго (в `crm_staff.department` + `additional_departments[]`)
- Optimistic updates: `queryClient.setQueryData` + durable pending; при грешка
  НЕ invalidate-вай (връща старата стойност — това беше клас бъгове), а остави
  pending + toast
- Sidebar баджове: `Layout.tsx` → `badgeKeys[]` масив + `BADGE_META`

## Страници и права (специфики)

| Страница | Достъп |
|---|---|
| Календар (отсъствия+събития+новини) | всички виждат; заявки: всеки за себе си (pending) → **само admin одобрява**; manager-ТРЗ вижда заявки read-only + редактира чужди редове; събития/новини: admin + manager-Управление |
| Справка отпуска / Форма 76 | само admin/ТРЗ (Форма 76: дефолти от календара + override-и в crm_form76_overrides) |
| Плащания (банкови) | admin/manager; бадж = неплатени за РАБОТНИЯ месец |
| Банков достъп (пароли, masked) | виждат: Тийм Лийд/Управление/admin; редактират: admin/Управление; има draft persistence при F5 |
| Задачи/Проверки (един екран, kind поле) | задачи: всички; проверки създават admin+Тийм Лийд; отговорник на проверка = АВТО от колона „Отговорник" |
| Профили (Дейност/Особености/Внимавай/Оценка) | всички; „Оценка" чете/пише СЪЩАТА cell_values колона като Работния лист |
| Проверяващи на месеца (amber блок в Работен лист) | random 2 от Счетоводство; смяна до 14-ти вкл.; после само admin с confirm |
| Личен чек лист (ДДС) | скрит за ТРЗ отдела; pending persistence |
| Лимит дистанционно | 2 раб. дни/месец за не-admin (Календар) |

## Отпуска — формулата (от excel-а на ТРЗ)

`Оставащ = От минали години + За тек. година + Допълнителен − Σ(одобрени vacation работни дни)`
Използваните дни се смятат АВТОМАТИЧНО от crm_absences (само status=approved).

## Миграции (25→44, всички пуснати на dev + prod)

025/026 чек лист · 027 additional_departments · 028 профили · 029 колони
is_hidden · 030 плащания · 031 absences+quota · 032 approval workflow ·
033 form76 overrides · 034 НЯМА (position съществуваше от 002) · 035 hire_date ·
036 events · 037 news (5-дневен auto-expire на непиннати) · 038 bank_access ·
039 app_code · 040 tasks · 041 kind+inspection_type · 042 month_reviewers ·
043 inspection details (инспектор/телефон/линк; НОВИТЕ колони искат и добавяне
в изричния select на getTasks!) · 044 inspector_email

## Известни проблеми / Backlog (по приоритет)

1. **RLS на финансови таблици** — vacation_quota/payment_*/bank_access са
   `using(true)` за всички логнати; потребителят съзнателно отложи стягането
2. **getCellValues тегли ~1MB** (цялата EAV с select('*')) на 9 страници —
   най-голямата перф оптимизация, иска внимание (споделен кеш)
3. Споделен MonthPicker компонент (5 копия) · раздробяване на Calendar.tsx
   (~1300 реда, 3 инлайн модала) — само поддръжка
4. Presence „кой е онлайн" — искано, отложено
5. Модул „Придобивки" Фаза 2 — каталог по стаж (hire_date + calcTenure готови)
6. Checklist → рефактор към usePendingPatches (когато е спокойно)
7. Excel файловете са с кирилски имена — понякога чупи на Windows

## Уроци от бъгове (не ги повтаряй)

- Изтриване на crm_columns колона → CASCADE трие cell_values! Затова има „Скрий" (is_hidden)
- Име profile↔staff се сравнява САМО през namesMatch (exact match чупеше)
- Оптимистичен update БЕЗ setQueryData + само pending → клетката „мига“ (регресия #172)
- След ALTER TABLE Supabase понякога не вижда колоната → `NOTIFY pgrst, 'reload schema';`
- GitHub MCP token изтича периодично → казвай на потребителя да reconnect-не
