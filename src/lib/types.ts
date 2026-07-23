export type Role = 'admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
}

export type ColumnType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'email' | 'phone'

export interface Column {
  id: string
  name: string
  type: ColumnType
  position: number
  is_required: boolean
  created_by: string
  created_at: string
  staff_department?: string // if set, dropdown pulls from crm_staff filtered by department
  is_hidden?: boolean // ако true → не се рендерира в Работен лист/Клиенти, но данните остават
}

export interface DropdownOption {
  id: string
  column_id: string
  value: string
  color?: string
  position: number
}

export interface Client {
  id: string
  created_at: string
  created_by: string
  updated_at: string
  assigned_to?: string
  deleted: boolean
}

export interface CellValue {
  id: string
  client_id: string
  column_id: string
  value_text?: string | null
  value_number?: number | null
  value_date?: string | null
  value_bool?: boolean | null
  value_dropdown?: string | null // dropdown option id
}

export interface ColumnFilter {
  columnId: string
  value: string
}

export interface AuditEntry {
  id: string
  user_id: string
  user_name: string
  action: string
  entity_type: string
  entity_id?: string
  client_name?: string
  column_name?: string
  old_value?: string
  new_value?: string
  metadata?: Record<string, any>
  created_at: string
}

export interface Tag {
  id: string
  name: string
  color: string
  created_at: string
}

export interface ClientTag {
  client_id: string
  tag_id: string
}

export type ExpenseCategory =
  | 'Заплати'
  | 'Наем'
  | 'Софтуер'
  | 'Реклама'
  | 'Консумативи'
  | 'Комунални'
  | 'Транспорт'
  | 'Обучения'
  | 'Други'

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Заплати', 'Наем', 'Софтуер', 'Реклама', 'Консумативи', 'Комунални', 'Транспорт', 'Обучения', 'Други'
]

export interface Contact {
  id: string
  client_id: string
  owner_name: string | null
  owner_email: string | null
  owner_phone: string | null
  manager_name: string | null
  manager_email: string | null
  company_email: string | null
  eik: string | null
  vat_number: string | null
  vat_registered_at: string | null
  address: string | null
  website: string | null
  public_url: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface ContactWithClient extends Contact {
  client_name: string
}

export const OPPORTUNITY_STAGES = [
  'Нов',
  'В контакт',
  'Изпратена оферта',
  'Преговори',
  'Печеливш',
  'Загубен',
] as const

export type OpportunityStage = typeof OPPORTUNITY_STAGES[number]

export const OPPORTUNITY_SOURCES = [
  'Препоръка',
  'Обаждане',
  'Сайт',
  'Социални мрежи',
  'Събитие',
  'Друго',
] as const

export interface Opportunity {
  id: string
  name: string
  eik: string | null
  vat_number: string | null
  vat_registered_at: string | null
  address: string | null
  public_url: string | null
  owner_name_legal: string | null
  manager_name_legal: string | null

  stage: OpportunityStage | string
  estimated_value: number | null
  source: string | null
  responsible: string | null

  next_action: string | null
  next_action_date: string | null

  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null

  notes: string | null
  lost_reason: string | null
  converted_to_client_id: string | null
  converted_at: string | null

  created_at: string
  created_by: string | null
  updated_at: string
  deleted: boolean
}

export const NOTIFICATION_METHODS = ['Вайбър', 'Слак', 'Имейл', 'Телефон', 'Друго'] as const

export const ART55_INCOME_TYPES = ['дивидент', 'наем', 'лихва', 'хонорар', 'друго'] as const

export interface Art55Entry {
  id: string
  client_id: string
  year: number
  month: number
  gross_amount: number
  tax_amount: number
  income_type: string | null
  position: number
  created_at: string
  created_by: string | null
  updated_at: string
}

export interface Art55QuarterStatus {
  id: string
  client_id: string
  year: number
  quarter: number
  declared: boolean
  notification_method: string | null
  declared_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MonthlyWork {
  id: string
  client_id: string
  year: number
  month: number

  priority_vat: boolean
  result_amount: number | null
  submitted_at: string | null
  notification_method: string | null
  npa_inconsistencies: string | null

  vat_accounted: boolean
  amortization_done: boolean
  bank_done: boolean
  salaries_done: boolean
  advance_payment_amount: number | null
  akciz_done: boolean
  statistika_done: boolean
  intrastat_done: boolean
  siddo_done: boolean
  oss_amount: number | null

  notes: string | null

  created_at: string
  created_by: string | null
  updated_at: string
}

export interface TrzWork {
  id: string
  client_id: string
  year: number
  month: number

  salaries_prepared: boolean
  insurance_submitted: boolean
  insurance_submitted_at: string | null
  payroll_sent: boolean
  payroll_sent_at: string | null

  notes: string | null

  created_at: string
  created_by: string | null
  updated_at: string
}

// Личен чек лист (ДДС месечен чеклист) — 12 стъпки, ПРОДАЖБИ + ПОКУПКИ.
export interface ChecklistRow {
  id: string
  client_id: string
  year: number
  month: number

  // ПРОДАЖБИ
  check_clients: boolean
  check_invoice_numbers: boolean
  check_missing_invoices: boolean
  spo: boolean
  check_income: boolean

  // ПОКУПКИ
  check_suppliers: boolean
  otmyata: boolean
  duplicate_invoices: boolean
  rko: boolean
  accounting_invoice: boolean
  regular_invoices_art82: boolean
  check_unfinished_docs: boolean

  notes: string | null
  // Атрибуция: за всяка отметната стъпка → кой я е маркирал и кога.
  checked_by: Record<string, { name: string; at: string }>

  created_at: string
  created_by: string | null
  updated_at: string
}

// Дефиниция на 12-те чек-стъпки (ред + етикет + група).
export const CHECKLIST_FIELDS: Array<{
  key: keyof Pick<ChecklistRow,
    'check_clients' | 'check_invoice_numbers' | 'check_missing_invoices' | 'spo' | 'check_income' |
    'check_suppliers' | 'otmyata' | 'duplicate_invoices' | 'rko' | 'accounting_invoice' |
    'regular_invoices_art82' | 'check_unfinished_docs'>
  label: string
  group: 'sales' | 'purchases'
}> = [
  { key: 'check_clients',          label: 'Проверка Клиенти',        group: 'sales' },
  { key: 'check_invoice_numbers',  label: 'Проверка № на ф-ри',      group: 'sales' },
  { key: 'check_missing_invoices', label: 'Липсващи фактури',        group: 'sales' },
  { key: 'spo',                    label: 'СПО',                     group: 'sales' },
  { key: 'check_income',           label: 'Проверка приход',         group: 'sales' },
  { key: 'check_suppliers',        label: 'Проверка Доставчици',     group: 'purchases' },
  { key: 'otmyata',                label: 'Отмята',                  group: 'purchases' },
  { key: 'duplicate_invoices',     label: 'Дублирани ф-ри',          group: 'purchases' },
  { key: 'rko',                    label: 'РКО',                     group: 'purchases' },
  { key: 'accounting_invoice',     label: 'Ф-ра счет. обслужване',   group: 'purchases' },
  { key: 'regular_invoices_art82', label: 'Регулярни ф-ри чл.82',    group: 'purchases' },
  { key: 'check_unfinished_docs',  label: 'Незавършени документи',   group: 'purchases' },
]

export interface ClientProfile {
  client_id: string
  business_activity: string | null   // „Дейност"
  business_notes: string | null      // „Особености"
  warnings: string | null            // „Внимавай"
  updated_at: string
  updated_by: string | null
}

// ============================================================
// Плащания — банкови плащания, които правим за клиенти
// ============================================================
export const PAYMENT_TYPES = ['РЗ', 'осиг', 'ДДС'] as const
export type PaymentType = typeof PAYMENT_TYPES[number]

// Цветова легенда — синхронизирано с excel таблицата на колегите.
export const PAYMENT_TYPE_COLORS: Record<string, string> = {
  'РЗ':   'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  'осиг': 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  'ДДС':  'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
}

// Списък с банки, лицензирани в България (БНБ) — само имена, за dropdown.
// Подреждане: първо местни банки (Глава I), после клонове на чуждестранни (Глава II).
export const BANKS = [
  'Банка ДСК',
  'УниКредит Булбанк',
  'Юробанк България',
  'Обединена българска банка',
  'Инвестбанк',
  'Първа инвестиционна банка',
  'Тексим Банк',
  'Централна кооперативна банка',
  'Алианц Банк България',
  'Българо-американска кредитна банка',
  'ТИ БИ АЙ Банк',
  'ПроКредит Банк (България)',
  'Интернешънъл Асет Банк',
  'Търговска банка Д',
  'Българска банка за развитие',
  'Токуда Банк',
  'Общинска Банка',
  'ИНГ Банк Н.В. — клон София',
  'Ситибанк Европа — клон България',
  'БНП Париба С.А. — клон София',
  'Аскори Банк АГ — клон София',
  'Те-Дже Зираат Банкасъ — клон София',
  'Бигбанк АС — клон България',
] as const

export interface PaymentConfig {
  client_id: string
  payment_types: string[]   // [„РЗ", „осиг", „ДДС"]
  bank: string | null
  notes: string | null
  updated_at: string
  updated_by: string | null
}

export interface PaymentStatus {
  id: string
  client_id: string
  payment_type: string
  year: number
  month: number
  paid: boolean
  paid_at: string | null
  updated_at: string
  updated_by: string | null
}

// ============================================================
// Календар на присъствие + Справка за отпуска
// ============================================================
export const ABSENCE_TYPES = ['vacation', 'sick', 'business', 'remote', 'maternity', 'study', 'unpaid'] as const
export type AbsenceType = typeof ABSENCE_TYPES[number]

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  vacation:  'Отпуска',
  sick:      'Болничен',
  business:  'Служебно',
  remote:    'Дистанционно',
  maternity: 'Майчинство',
  study:     'Учебен',
  unpaid:    'Неплатен',
}

// Цветовете за календарната клетка. Vacation е зелено (платен отпуск),
// болничен червен и т.н. Подравнени с тон от другите страници.
export const ABSENCE_TYPE_COLORS: Record<AbsenceType, string> = {
  vacation:  'bg-emerald-500 text-white',
  sick:      'bg-red-500 text-white',
  business:  'bg-amber-500 text-white',
  remote:    'bg-violet-500 text-white',
  maternity: 'bg-pink-500 text-white',
  study:     'bg-blue-500 text-white',
  unpaid:    'bg-gray-400 text-white',
}

export interface Absence {
  id: string
  staff_id: string
  start_date: string  // ISO date (YYYY-MM-DD)
  end_date: string
  type: AbsenceType | string
  notes: string | null

  // Workflow: 'pending' → admin approves → 'approved' (видими в календара),
  // или admin отказва → 'rejected' (видимо само на подателя).
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  approved_by: string | null
  approved_at: string | null

  created_by: string | null
  created_at: string
  updated_at: string
}

export interface VacationQuota {
  staff_id: string
  year: number
  prev_years_days: number      // От минали години
  current_year_days: number    // За текуща година
  additional_days: number      // Допълнителен
  daily_rate: number | null
  insurance_pct: number | null
  termination_date: string | null
  compensation_days: number | null
  updated_at: string
  updated_by: string | null
}

// ============================================================
// Форма 76 — ТРЗ образец „Отчитане явяване/неявяване"
// ============================================================

// Кодове, които могат да стоят в клетка на Форма 76. „8" значи
// нормален работен ден (8 часа явяване), „4" половин работен ден.
// Останалите са буквени кодове за различни видове неявяване.
export const FORM76_CODES = ['8', '4', 'О', 'Б', 'М', 'К', 'У', 'Н', '-', ''] as const

// Етикети до кодовете (за popover-а при редакция).
export const FORM76_CODE_LABELS: Record<string, string> = {
  '8': '8 — Работен ден (8ч)',
  '4': '4 — Половин ден (4ч)',
  'О': 'О — Редовен отпуск',
  'Б': 'Б — Болничен',
  'М': 'М — Майчинство',
  'К': 'К — Командировка / Държ.',
  'У': 'У — Учебен / Адмист.',
  'Н': 'Н — Неплатен',
  '-': '— Прекратен договор',
  '':  'Празно',
}

// Цвят на буквените кодове (визуално различими в grid-а).
export const FORM76_CODE_COLORS: Record<string, string> = {
  '8': '',  // По подразбиране (без цвят)
  '4': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
  'О': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  'Б': 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  'М': 'bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300',
  'К': 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  'У': 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  'Н': 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  '-': 'bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500',
  '':  '',
}

// Мапване от crm_absences.type → Форма 76 код.
export const ABSENCE_TYPE_TO_FORM76_CODE: Record<string, string> = {
  vacation:  'О',
  sick:      'Б',
  maternity: 'М',
  business:  'К',
  remote:    '8',  // Дистанционно се брои като работа
  study:     'У',
  unpaid:    'Н',
}

export interface Form76Override {
  staff_id: string
  year: number
  month: number
  day: number
  value: string  // един от FORM76_CODES
  updated_at: string
  updated_by: string | null
}

// ============================================================
// Фирмени събития (Календар)
// ============================================================
export const EVENT_TYPES = ['meeting', 'teambuilding', 'holiday', 'training', 'other'] as const
export type EventType = typeof EVENT_TYPES[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  meeting:      'Среща',
  teambuilding: 'Тиймбилдинг',
  holiday:      'Празник',
  training:     'Обучение',
  other:        'Друго',
}

// Цвят за band-а в календара (наситен фон + бял текст).
export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  meeting:      'bg-blue-500 text-white',
  teambuilding: 'bg-emerald-500 text-white',
  holiday:      'bg-red-500 text-white',
  training:     'bg-violet-500 text-white',
  other:        'bg-gray-500 text-white',
}

export interface CompanyEvent {
  id: string
  title: string
  description: string | null
  start_date: string  // ISO YYYY-MM-DD
  end_date: string
  start_time: string | null  // HH:MM:SS или null за all-day
  end_time: string | null
  type: EventType | string
  created_by: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Новини
// ============================================================
export const NEWS_TYPES = ['announcement', 'new_client', 'general', 'warning', 'other'] as const
export type NewsType = typeof NEWS_TYPES[number]

export const NEWS_TYPE_LABELS: Record<NewsType, string> = {
  announcement: 'Обявление',
  new_client:   'Нов клиент',
  general:      'Новина',
  warning:      'Внимание',
  other:        'Друго',
}

export const NEWS_TYPE_ICONS: Record<NewsType, string> = {
  announcement: '📢',
  new_client:   '🎉',
  general:      '📰',
  warning:      '⚠️',
  other:        '💡',
}

export const NEWS_TYPE_COLORS: Record<NewsType, string> = {
  announcement: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  new_client:   'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  general:      'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700',
  warning:      'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  other:        'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800',
}

export interface NewsItem {
  id: string
  title: string
  body: string | null
  type: NewsType | string
  pinned: boolean
  author_name: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Банков достъп
// ============================================================
export const BANK_ACCESS_TYPES = ['shared', 'individual'] as const
export type BankAccessType = typeof BANK_ACCESS_TYPES[number]

export const BANK_ACCESS_TYPE_LABELS: Record<BankAccessType, string> = {
  shared:     'Общ',
  individual: 'Отделен',
}

export interface BankAccess {
  client_id: string
  bank: string | null
  url: string | null
  username: string | null
  password: string | null
  app_code: string | null   // таен код/сийд за 2FA приложението
  access_type: BankAccessType | string
  has_2fa: boolean
  we_pay: boolean
  notes: string | null
  updated_at: string
  updated_by: string | null
}

// ============================================================
// Задачи (kanban / list)
// ============================================================
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'issue'] as const
export type TaskStatus = typeof TASK_STATUSES[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo:        'To Do',
  in_progress: 'В процес',
  done:        'Готово',
  issue:       'Проблем',
}

// Цвят на колоната/баджа per статус.
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  todo:        'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  done:        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  issue:       'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
}

// Вид на записа: обикновена задача или проверка/ревизия.
export const TASK_KINDS = ['task', 'inspection'] as const
export type TaskKind = typeof TASK_KINDS[number]

// Типове проверки (за kind='inspection').
export const INSPECTION_TYPES = ['проверка', 'ревизия', 'ПФО', 'насрещна', 'друго'] as const
export type InspectionType = typeof INSPECTION_TYPES[number]

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  'проверка': 'Проверка',
  'ревизия':  'Ревизия',
  'ПФО':      'ПУФО',  // етикет ПУФО; вътрешната стойност остава 'ПФО' (има записи с нея)
  'насрещна': 'Насрещна проверка',
  'друго':    'Друго',
}

export const INSPECTION_TYPE_COLORS: Record<InspectionType, string> = {
  'проверка': 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  'ревизия':  'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  'ПФО':      'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  'насрещна': 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800',
  'друго':    'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700',
}

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus | string
  kind: TaskKind | string
  inspection_type: InspectionType | string | null  // само за kind='inspection'
  inspector_name: string | null   // само за kind='inspection'
  inspector_phone: string | null  // само за kind='inspection'
  documents_url: string | null    // само за kind='inspection' — линк към документите
  assignee_staff_id: string | null
  client_id: string | null
  due_date: string | null  // ISO YYYY-MM-DD; при ревизии = срок за предаване
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Проверяващи на месеца (Работен лист)
// ============================================================
export interface MonthReviewers {
  year: number
  month: number
  reviewer1_staff_id: string | null
  reviewer2_staff_id: string | null
  updated_by: string | null
  updated_at: string
}

export interface Expense {
  id: string
  category: ExpenseCategory
  description: string | null
  amount: number
  currency: string
  date: string | null
  staff_id: string | null
  recurring: boolean
  recurring_period: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}


