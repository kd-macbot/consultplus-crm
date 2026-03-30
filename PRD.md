# Consult Plus Client Manager — PRD

## Overview
Вътрешен CRM за Consult Plus — табличен мениджър на клиенти с динамични колони, филтри и управление на екипа.

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript
- **UI:** TanStack Table v8, Tailwind CSS
- **Backend/DB/Auth:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Hosting:** GitHub Pages (frontend) + Supabase (backend)
- **Language:** Интерфейс на български

## Brand Colors (from consultplus.bg)
| Role | HSL | Hex | Usage |
|------|-----|-----|-------|
| Primary (navy) | 218°, 37%, 23% | `#253551` | Headers, buttons, nav |
| Dark accent | 180°, 2%, 16% | `#282a2a` | Text, dark backgrounds |
| Light accent | 0°, 0%, 91% | `#e7e7e7` | Backgrounds, borders |
| Gold accent | — | `#7C6C25` | Highlights, badges |
| White | — | `#FFFFFF` | Cards, backgrounds |
| Black | — | `#000000` | Primary text |

## Users & Roles
~15-20 потребители

| Role | Permissions |
|------|------------|
| **Admin** | Пълен достъп: CRUD клиенти, управление на колони, dropdown стойности, потребители, роли |
| **Manager** | Вижда всички клиенти, редактира всички, не може да управлява структура/потребители |
| **Employee** | Вижда и редактира само присвоените му клиенти |

## Auth
- Email + парола (Supabase Auth)
- Admin създава акаунти (няма self-registration)
- JWT + Supabase RLS за сигурност

## Database Schema

### `profiles` (extends Supabase auth.users)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, FK → auth.users) | |
| full_name | text | Име на служителя |
| role | enum('admin','manager','employee') | |
| created_at | timestamptz | |

### `columns` (динамични колони)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | Име на колоната |
| type | enum('text','number','date','dropdown','checkbox','email','phone') | |
| position | int | Ред на показване |
| is_required | bool | |
| created_by | uuid (FK → profiles) | |
| created_at | timestamptz | |

### `dropdown_options` (предефинирани стойности)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| column_id | uuid (FK → columns) | |
| value | text | |
| color | text | Цвят на етикета (optional) |
| position | int | |

### `clients` (основна таблица)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| created_at | timestamptz | |
| created_by | uuid (FK → profiles) | |
| updated_at | timestamptz | |
| assigned_to | uuid (FK → profiles) | Отговорен служител |

### `cell_values` (EAV — стойности на клетки)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| client_id | uuid (FK → clients) | |
| column_id | uuid (FK → columns) | |
| value_text | text | За text, email, phone |
| value_number | numeric | За number |
| value_date | date | За date |
| value_bool | bool | За checkbox |
| value_dropdown | uuid (FK → dropdown_options) | За dropdown |

**Composite unique:** (client_id, column_id)

## Default Columns (от реалния Excel)
1. Фирма (text, required)
2. Оценка на клиент (dropdown: Ок, Проблемен, Обемен, Изискващ)
3. Статус (dropdown: АКТИВНА, БЕЗ ДДС, БЕЗ ДЕЙНОСТ, НУЛЕВО, НЕ АКТИВНА)
4. MAND (text) — номер или "NULA"
5. Счетоводител (dropdown: АНГЕЛ ТОДОРОВ, АНУШКА РАДЕВА, ВИОЛИНА МИТАКСОВА, ГАЛИНА ГЕОРГИЕВА, ДИМИТРИНА КОЛЕВА, КРАСИМИРА ГЕОРГИЕВА, МАЯ МАТАНСКА, ПЕТЯ ПАВЛОВА, РАДКА НИКОЛОВА)
6. Заместване (dropdown: ВИОЛИНА МИТАКСОВА, КРАСИМИРА ГЕОРГИЕВА, РАДКА НИКОЛОВА)
7. ТРЗ (dropdown: АТАНАСКА ГОСПОДИНОВА, СИЛВИЯ ИВАНОВА, МАРИЯ МОНЧЕВСКА)
8. Хонорар (number)
9. ТРЗ Отг. (dropdown: АТАНАСКА ГОСПОДИНОВА, СИЛВИЯ ИВАНОВА)
10. ТРЗ Статус (dropdown: СОЛ, СОЛ+, ДУК, ДУК+, Служители, А1)
11. Данък изт./СИДО (dropdown: ДА, НЕ)
12. Бележки (text)

## Seed Data
- Import 186 clients from `CRM data.xlsx` (Sheet: Master)
- Pre-populate all dropdown options from real data
- Pre-populate team members from PayRoll + Lists sheets

## Features — MVP (v1.0)

### Таблица
- [x] Табличен изглед с всички клиенти
- [x] Сортиране по всяка колона
- [x] Филтриране по всяка колона (text search, dropdown select, range за numbers/dates)
- [x] Комбинирани филтри
- [x] Resize на колони
- [x] Reorder на колони (drag & drop)
- [x] Inline editing (click on cell → edit)
- [x] Pagination

### CRUD
- [x] Добавяне на клиент (ред)
- [x] Редактиране на клиент
- [x] Изтриване (soft delete)
- [x] Добавяне/премахване/преименуване на колони (Admin)
- [x] Управление на dropdown стойности (Admin)

### Auth & Permissions
- [x] Login page
- [x] Role-based access (Admin / Manager / Employee)
- [x] Admin panel за управление на потребители
- [x] Employee вижда само своите клиенти

### UI
- [x] Responsive (mobile-friendly)
- [x] Consult Plus брандинг
- [x] Български интерфейс
- [x] Търсене (global search)

## Features — v1.1
- [ ] Импорт от Excel/CSV
- [ ] Експорт в Excel/CSV
- [ ] Тагове/етикети
- [ ] Audit log (кой какво е променил)

## Features — v2.0
- [ ] Dashboard с обобщение (брой клиенти по статус, приходи)
- [ ] Напомняния за срокове
- [ ] История/бележки per клиент (timeline)
- [ ] Bulk edit

## Project Structure
```
consultplus-crm/
├── public/
├── src/
│   ├── components/
│   │   ├── layout/        # Header, Sidebar, Layout
│   │   ├── table/         # DataTable, Cell renderers, Filters
│   │   ├── auth/          # Login, ProtectedRoute
│   │   ├── admin/         # UserManagement, ColumnManager, DropdownEditor
│   │   └── ui/            # Reusable components (Button, Modal, Input)
│   ├── hooks/             # useClients, useColumns, useAuth
│   ├── lib/
│   │   ├── supabase.ts    # Supabase client
│   │   └── types.ts       # TypeScript types
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Clients.tsx    # Main table view
│   │   └── Admin.tsx      # Admin settings
│   ├── styles/
│   │   └── globals.css    # Tailwind + brand colors
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   └── migrations/        # SQL migrations
├── .env.example
├── package.json
├── tailwind.config.js
├── vite.config.ts
└── README.md
```

## Deployment
1. Frontend → GitHub Pages (`gh-pages` branch, automated via GitHub Actions)
2. Backend → Supabase (free tier: 500MB DB, 50K API requests/month)
3. Domain → TBD (може crm.consultplus.bg)

## Scale Notes
- 200 клиента × ~15 колони = ~3,000 cell_values → tiny for PostgreSQL
- 15-20 concurrent users → well within Supabase free tier
- EAV pattern trades query simplicity for schema flexibility — правилен избор за динамични колони
