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
- Cloudflare Pages: branch `dev` → dev preview (dev Supabase), branch `main` → live (prod Supabase).
  CF билдва през собствената си Git интеграция (НЕ през GitHub Action). vite base = `/`.
- **Live домейн: cplus360.com** (custom domain в CF, + www; добавен в Supabase
  Redirect URLs) — ЕДИНСТВЕНИЯТ вход. Име на приложението: **Consult Plus 360**.
  Логата са в `src/assets/brand/` (bundled imports — НЕ в public/, заради base path-а).
  Старият GitHub Pages деплой (deploy.yml + gh-pages) е ПРЕМАХНАТ (08.2026) —
  не връщай втора публикация
- Edge функции (deploy РЪЧНО през Dashboard, само на PROD проекта):
  `swift-task` (RegData ЕИК/ДДС, secrets REGDATA_*), `mobica-send` (SMS/Viber,
  secrets MOBICA_USER/MOBICA_PASS), `admin-create-user` (service role)

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
- `contract.ts` — договори: `splitLegalForm` (АВОМИС ЕООД → име + форма),
  `transliterate` (Закона за транслитерацията, вкл. -ия→-ia), `buildContractValues`,
  `fillTemplate`, `missingFields`. Шаблоните са в БД; `contractTemplates.ts` са
  само стартовите (dynamic import — ~57KB, нужни веднъж при seed).
  `contractPrint.ts` — печат в НОВ прозорец (не в SPA-та) → „Запази като PDF"

## Важни конвенции

- **EAV модел**: клиентските данни са в `crm_cell_values` (client × column).
  Името на фирмата = стойността на ПЪРВАТА text колона (по position)
- Master колони, търсени ПО ИМЕ (в crm_columns/cell_values): „Статус",
  „Счетоводител", „Отговорник", „Чл. 55 ЗДДФЛ", „Авансови вноски",
  „Мониторинг" (Финансови приключвания=ДА), „Касов апарат" (СПО=ДА),
  „Хонорар" (сумата на хонорара — само за admin в UI). Стойности ДА/НЕ с ГЛАВНИ.
- „Хонорар" колоната е СКРИТА за не-admin в таблицата Клиенти (DataTable
  `ADMIN_ONLY_COLUMNS`) + изключена от Excel експорта и менюто за колони
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
| Съобщения (Mobica SMS/Viber) | изпращат admin/manager; ВСИЧКИ виждат историята; шаблони с плейсхолдъри {фирма}{месец}{период}{сума}{сума_аванс}{срок_ддс/осиг/аванс/годишен}; телефон от Контакти (owner_phone); маркер „уведомен" по кампания (шаблон#месец) |
| Финансов мониторинг (Каси/Заеми/Приключвания) | скрит за ТРЗ; Приключвания = само фирми с „Мониторинг"=ДА (Приходи/Разходи→Резултат, месечно/тримесечно) |
| Касови апарати / СПО | admin + мениджъри + Счетоводство (`showOnlyForAccounting` в Layout); само фирми с „Касов апарат"=ДА |
| Табло — печалба/приход/разходи/хонорар | САМО admin (`{isAdmin && …}`, разходите не се теглят за други) |
| Разходи · Абонаменти · Възможности | само admin (route + RLS) |
| Договори (изготвяне от шаблон) | само admin (route + RLS) — договорът съдържа хонорара |

## Отпуска — формулата (от excel-а на ТРЗ)

`Оставащ = От минали години + За тек. година + Допълнителен − Σ(одобрени vacation работни дни)`
Използваните дни се смятат АВТОМАТИЧНО от crm_absences (само status=approved).

## Миграции (25→52, всички пуснати на dev + prod)

025/026 чек лист · 027 additional_departments · 028 профили · 029 колони
is_hidden · 030 плащания · 031 absences+quota · 032 approval workflow ·
033 form76 overrides · 034 НЯМА (position съществуваше от 002) · 035 hire_date ·
036 events · 037 news (5-дневен auto-expire на непиннати) · 038 bank_access ·
039 app_code · 040 tasks · 041 kind+inspection_type · 042 month_reviewers ·
043 inspection details (инспектор/телефон/линк; НОВИТЕ колони искат и добавяне
в изричния select на getTasks!) · 044 inspector_email · 045 каси и заеми
(crm_cash_loan_entries; сумата е ДВИЖЕНИЕ за месеца, акумулираното се смята в
UI) · 046 съобщения (crm_client_messages дневник + crm_message_templates;
Mobica Viber+SMS през edge mobica-send, secrets MOBICA_USER/MOBICA_PASS,
канал sms/viber избираем) · 047 profiles RLS (беше ИЗКЛЮЧЕН — критичен fix) ·
048 финансови приключвания (crm_financial_closings + crm_financial_settings;
Приходи/Разходи→Резултат за фирми с master колона „Мониторинг"=ДА; период по
фирма месечно/тримесечно) · 049 RLS/perf почистване (махнати дублиращи „публични"
политики cells_*/dropdown_*/profiles_read; initplan auth.uid()→(select auth.uid());
дублиран индекс; search_path) · 050 заключване на handle_new_user + rls_auto_enable
(REVOKE FROM PUBLIC; helper-ите is_current_user_admin(_or_manager) НЕ се пипат —
викат се при SELECT през FOR ALL политики) · 051 касови апарати/СПО
(crm_cash_registers + crm_cash_register_turnover + crm_cash_firm_monthly; фирми с
master колона „Касов апарат"=ДА; апарати × месеци оборот/сторно 20/9 + фактури в
брой + РЗОК; СПО се смята в UI; достъп admin/мениджъри/Счетоводство — гейт в
менюто) · 052 КИ (кредитни известия 20/9 в crm_cash_firm_monthly; ПРИБАВЯТ се към
СПО: СПО20=(Общо20−Сторно20)−Фактури20−РЗОК+КИ20, СПО9=(Общо9−Сторно9)−Фактури9+КИ9) ·
053 договори (crm_contract_templates + crm_contracts; RLS само admin —
`is_current_user_admin()`, защото договорът съдържа месечния хонорар)

## Известни проблеми / Backlog (по приоритет)

1. RLS на оперативните таблици — `using(true)` за всички логнати (каси/заеми,
   финансови приключвания, касови апарати, банков достъп и т.н.). РЕШЕНО да
   остане (07.2026): достъпът се гейтва в UI, съзнателно приет риск. НЕ предлагай
   стягане, освен ако потребителят сам не го повдигне. ИЗКЛЮЧЕНИЯ (стегнати
   08.2026): `profiles` (свой ред + admin), печалба/хонорар/разходи (само admin —
   Табло, Абонаменти, колона „Хонорар"), Разходи/Възможности (`is_current_user_admin()`).
   Advisor остатък: 4 безобидни warning-а за helper функциите (нужни в RLS).
2. getCellValues (~1MB) — ПРОВЕРЕНО (07.2026): таблицата няма излишни
   колони, select('*') = точно нужните 8 полета; gzip + споделеният 5-мин
   кеш го омекотяват. Реална печалба само чрез компактен RPC формат —
   преценено, че не си струва. Не пипай без нова причина.
3. Споделен MonthPicker компонент (5 копия) · раздробяване на Calendar.tsx
   (~1300 реда, 3 инлайн модала) — само поддръжка
4. Presence „кой е онлайн" — искано, отложено
5. Модул „Придобивки" Фаза 2 — каталог по стаж (hire_date + calcTenure готови)
6. Checklist → рефактор към usePendingPatches (когато е спокойно)
7. Excel файловете са с кирилски имена — понякога чупи на Windows
8. Бутон „Нулирай парола" в Персонал (admin да сменя парола на колега —
   разширяване на admin-create-user edge функцията) — искано, не е правено
9. Правна форма на фирмата — РЕШЕНО да остане както е (08.2026): взима се
   чрез `splitLegalForm` от края на името в Клиенти (171 от 186 фирми я имат;
   останалите 15 — ЗП, адвокатски съдружия, физ. лица — се попълват ръчно в
   договора). Обмислено и отхвърлено: отделна колона `legal_form` в
   crm_contacts + вадене от RegData. Причина да НЕ се пипа таблицата Клиенти —
   името е EAV и `clientDisplayName` се ползва на 13 места. NB: същият списък
   с форми стои дублиран в `cleanName()` на edge функцията swift-task.
10. Стари клони (~67) — НЕ могат да се трият (org ruleset „Restrict deletions"
   блокира; git push --delete → 403, UI → „could not be deleted"). Решено да
   се оставят — безобидни са, козметично. НЕ разхлабвай правилото.

## Уроци от бъгове (не ги повтаряй)

- Изтриване на crm_columns колона → CASCADE трие cell_values! Затова има „Скрий" (is_hidden)
- Име profile↔staff се сравнява САМО през namesMatch (exact match чупеше)
- Оптимистичен update БЕЗ setQueryData + само pending → клетката „мига“ (регресия #172)
- След ALTER TABLE Supabase понякога не вижда колоната → `NOTIFY pgrst, 'reload schema';`
- GitHub MCP token изтича периодично → казвай на потребителя да reconnect-не
- НОВА таблица = ВИНАГИ `enable row level security` + политики. Само политики
  без enable RLS = таблицата е публично отворена (Supabase алармира
  rls_disabled_in_public). profiles беше точно така от migration-006 до 047.
- Страница със собствен load() (не RQ hook) трябва да инвалидира споделения
  RQ кеш след запис — иначе други страници виждат стари данни (Контакти →
  телефоните в Съобщения; fix #249)
- `FOR ALL` RLS политика важи и за SELECT → ако вика helper функция
  (is_current_user_admin_or_manager), четенето изисква EXECUTE върху нея.
  НЕ отнемай EXECUTE от тези helper-и (мигр. 050 първи опит счупи Клиенти).
  Права на функция се дават на роля PUBLIC по подразбиране → REVOKE само от
  anon/authenticated НЕ стига, трябва FROM PUBLIC.
- Запазен изглед на колоните се губеше: syncViewsFromDb течеше на всеки mount
  и презаписваше localStorage от (изоставаща) DB. Сега — ВЕДНЪЖ НА СЕСИЯ
  (sessionStorage флаг „views-synced-<uid>", чисти се при logout).
- Squash-merge → клонът излиза „немерджнат" по SHA (git branch --no-merged),
  но съдържанието е в main. Не се доверявай само на ancestry за „мерджнат ли е".
- Именувани срокове в Съобщения се смятат спрямо РАБОТНИЯ месец (число на
  месеца СЛЕД него): ддс=14, осиг=25, аванс=15; годишен=30.06 текуща година.
  {период} за авансови: месечно→месеца, тримесечно→тримесечието (по „Авансови вноски").
