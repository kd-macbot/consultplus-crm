# Dev среда — setup

Този документ описва как да настроиш втора, изолирана среда (`dev`) за тестване
на нови функции, без да пипаш live базата, в която работят колегите.

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  LIVE (production)                                           │
│    Branch:    main                                           │
│    Frontend:  GitHub Pages (kd-macbot.github.io/...)         │
│    Backend:   Supabase Pro проект (eu-west-1)                │
│    Env vars:  GitHub Secrets                                 │
│    → колегите работят тук — НЕ пипаме                       │
├─────────────────────────────────────────────────────────────┤
│  DEV                                                         │
│    Branch:    dev (+ feature branches)                       │
│    Frontend:  Cloudflare Pages (xxx.pages.dev)               │
│    Backend:   Supabase Free проект (eu-west-1)               │
│    Env vars:  в Cloudflare Pages dashboard                   │
│    → за тестване на нови функции                            │
└─────────────────────────────────────────────────────────────┘
```

Работният поток е: feature branch → preview URL → ако работи → merge в `main` → live.

---

## Стъпка 1: Втори Supabase проект (dev)

1. Влез в [Supabase Dashboard](https://supabase.com/dashboard).
2. **New project** → име `consultplus-crm-dev`, **EU регион (Frankfurt или Ireland)**, **Free** план.
3. Изчакай 2-3 минути да се вдигне.
4. Settings → API → копирай:
   - `Project URL`
   - `anon public` ключ
5. Запази си ги — ще ги ползваме на стъпка 3.

### Пускане на миграциите

Този проект е празен. Трябва да пуснем всички миграции, за да има същата схема като live.

В Supabase Dashboard на dev проекта → SQL Editor → пусни **по ред**:

```
supabase/migration-002-staff.sql
supabase/migration-003-audit-tags.sql
... всички до ...
supabase/migration-024-user-views.sql
```

Всяка миграция е идемпотентна — ако се препъне, пусни отново.

> ⚠️ **Внимание:** пускай само на DEV проекта, НЕ на live. URL-ите са различни.

### Seed данни (опционално)

Може да пуснеш `scripts/seed-supabase.py` срещу dev проекта, за да има няколко тестови клиента.

---

## Стъпка 2: Cloudflare Pages

1. [Регистрирай се в Cloudflare](https://dash.cloudflare.com/sign-up) (безплатно).
2. Pages → **Connect to Git** → избери `kd-macbot/consultplus-crm`.
3. **Production branch:** `main`.
4. Build settings:
   - Framework: **Vite**.
   - Build command: `npm run build`.
   - Build output: `dist`.
5. **Environment variables (production):**
   - `VITE_SUPABASE_URL` = твоят live URL
   - `VITE_SUPABASE_ANON_KEY` = твоят live anon ключ
   - `VITE_BUILD_ID` = `${CF_PAGES_COMMIT_SHA}` (Cloudflare го попълва)
6. **Environment variables (preview)** — това е важното за dev:
   - `VITE_SUPABASE_URL` = **dev URL** (от стъпка 1)
   - `VITE_SUPABASE_ANON_KEY` = **dev anon** (от стъпка 1)
   - `VITE_DEV_ENV` = `dev` ← това показва жълтата лента
7. **Save and Deploy.**

Cloudflare сега автоматично:
- На push към `main` → deploy-ва на production URL (live данни).
- На push към всеки друг branch → preview URL (dev данни + жълта лента).
- На всеки PR → отделен preview URL.

---

## Стъпка 3: dev branch + workflow

```bash
git checkout main
git pull
git checkout -b dev
git push -u origin dev
```

Сега `dev` branch съществува и Cloudflare ще му направи постоянен URL (нещо като `dev.consultplus-crm.pages.dev`).

### Работен поток

```
1. Нова функция:
   git checkout dev
   git pull
   git checkout -b feature/нещо-ново

2. Работиш, commit-ваш, push-ваш:
   → Cloudflare прави PR preview URL автоматично
   → отваряш PR срещу dev
   → тестваш на preview URL-а с dev данни

3. Ако работи → merge в dev (Cloudflare обновява dev URL)
4. Тестваш още на dev (вкл. с колегите ако нужно)
5. Когато сме сигурни → PR от dev към main → merge → live deploy
6. Ако миграция → пускаш я в live Supabase ръчно
```

---

## Какво да НЕ забравяме

| Нещо | Защо |
|------|------|
| Винаги пускай миграция първо на dev | Тестваме безопасно |
| Винаги push-вай в `main` СЛЕД като си тествал на dev | Колегите не страдат |
| При миграция за live — пускаш я СЛЕД мерджа в `main` | Иначе старият код може да не познава новите колони |
| GitHub Pages deploy остава активен | Резерв; може да го изключим по-късно |

---

## Изключване на старото GitHub Pages (опционално, по-късно)

Когато си сигурен че Cloudflare работи добре:

1. Settings → Pages в GitHub repo → Source: None.
2. Уведоми колегите за новия URL (или настрой custom domain на Cloudflare към същия).

Това е стъпка за по-късно — сега работи паралелно и така никой няма проблем.
