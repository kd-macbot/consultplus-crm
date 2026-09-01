// Експорт на месечните абонаментни фактури към програмата за фактуриране.
//
// Форматът е ЧУЖД — диктува го програмата, която го чете. Затова тук нищо
// не се „разкрасява": заглавията са буквално каквито ги очаква вносът,
// включително ИНТЕРВАЛИТЕ В КРАЯ на „Identifier " и „Description ".
// Вносителите често сравняват заглавието знак по знак.
//
// Файлът излиза UTF-8 С BOM и CRLF, както подадения образец. Без BOM
// Excel и част от вносителите четат кирилицата като въпросителни.

/** Заглавията, точно както ги иска програмата. НЕ ги „оправяй". */
export const INVOICE_HEADERS = [
  '*InvoiceNumber', '*CreateDate', '*InvoiceDate', '*Company', 'Identifier ',
  '*AccountCode', '*Quantity', '*Price', 'Description ', '*InventoryItemName',
  '*TaxType', '*PaymentType', 'Categories',
] as const

export interface InvoiceClient {
  name: string
  /** ЕИК от Контакти. Липсва ли, редът излиза с празна колона. */
  eik: string | null
  price: number
}

export interface InvoiceOptions {
  /** Номерът на ПЪРВАТА фактура; следващите вървят с +1. */
  startNumber: number
  /** Дата на издаване (ISO); влиза и в двете колони за дата. */
  date: string
  /** Периодът, за който е абонаментът — влиза в описанието. */
  year: number
  month: number
  accountCode: string
  itemName: string
  taxType: string
  paymentType: string
  category: string
}

export const INVOICE_DEFAULTS = {
  accountCode: '703',
  itemName: 'Счетоводно и ТРЗ обслужване',
  taxType: '20',
  paymentType: '1',
  category: 'Абонаментни услуги',
}

/** ISO дата → „04.08.2026" (форматът на програмата). */
export function formatInvoiceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return ''
  return `${m[3]}.${m[2]}.${m[1]}`
}

/** „Абонамент м08/2026" */
export function invoiceDescription(year: number, month: number): string {
  return `Абонамент м${String(month).padStart(2, '0')}/${year}`
}

/**
 * Едно поле по правилата на CSV: обгражда се в кавички само при нужда, а
 * вътрешните кавички се удвояват. Имена като
 * `"ФИЛОСОФИЯ НА ВКУСА” ООД` съдържат кавичка и БЕЗ това чупят реда.
 */
export function csvEscape(value: string | number): string {
  const s = String(value ?? '')
  if (!/[";\r\n]/.test(s)) return s
  return `"${s.replace(/"/g, '""')}"`
}

/** Редовете → CSV текст с точка и запетая и CRLF. */
export function toCsv(headers: readonly string[], rows: string[][]): string {
  const lines = [headers.map(csvEscape).join(';')]
  for (const r of rows) lines.push(r.map(csvEscape).join(';'))
  // CRLF, както в образеца.
  return lines.join('\r\n') + '\r\n'
}

/**
 * Сглобява редовете. Подрежда по име (българска подредба) ПРЕДИ да раздаде
 * номерата — така номерацията върви по азбучен ред, както в досегашния файл.
 */
export function buildInvoiceRows(clients: InvoiceClient[], o: InvoiceOptions): string[][] {
  const date = formatInvoiceDate(o.date)
  const description = invoiceDescription(o.year, o.month)
  // Махат се САМО празните знаци в краищата. В базата има фирма със
  // заблуден интервал в началото (" ОЙНУР ЕООД") — той я изхвърля най-отгоре
  // в азбучния ред и влиза така в самата фактура.
  // Вътрешните двойни интервали („СТИЛ ЕНД  ВЕС") се ПАЗЯТ: те не пречат на
  // нищо, а името във фактурата трябва да е това, което стои в системата —
  // мълчаливото му преправяне не е моя работа.
  const sorted = clients
    .map(c => ({ ...c, name: c.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))

  return sorted.map((c, i) => [
    String(o.startNumber + i),
    date,
    date,
    c.name,
    (c.eik ?? '').trim(),
    o.accountCode,
    '1',
    formatPrice(c.price),
    description,
    o.itemName,
    o.taxType,
    o.paymentType,
    o.category,
  ])
}

/**
 * Сумата за файла: цяло число си остава цяло („200", не „200.00"), а
 * дробното се пише с ТОЧКА — програмата чете десетичен разделител точка,
 * а `toLocaleString('bg-BG')` би сложил запетая и сумата ще влезе сгрешена.
 */
export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

export interface InvoiceWarnings {
  missingEik: string[]
  zeroPrice: string[]
}

/** Какво да се провери с очи, преди файлът да тръгне към фактурирането. */
export function checkInvoiceRows(clients: InvoiceClient[]): InvoiceWarnings {
  return {
    missingEik: clients.filter(c => !(c.eik ?? '').trim()).map(c => c.name),
    zeroPrice: clients.filter(c => !c.price).map(c => c.name),
  }
}

/** Сваля CSV с BOM — без него кирилицата излиза като въпросителни. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
