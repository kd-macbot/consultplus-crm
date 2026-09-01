import { describe, it, expect } from 'vitest'
import {
  INVOICE_HEADERS, INVOICE_DEFAULTS, buildInvoiceRows, csvEscape, toCsv,
  formatInvoiceDate, invoiceDescription, formatPrice, checkInvoiceRows,
  type InvoiceClient,
} from './invoiceExport'

const OPTS = {
  startNumber: 7379,
  date: '2026-08-04',
  year: 2026,
  month: 8,
  ...INVOICE_DEFAULTS,
}

describe('заглавията', () => {
  it('са точно каквито ги иска програмата — с интервалите в края', () => {
    // Вносителите сравняват заглавието знак по знак; „поправянето" на
    // тези интервали чупи вноса по начин, който се вижда чак там.
    expect(INVOICE_HEADERS[4]).toBe('Identifier ')
    expect(INVOICE_HEADERS[8]).toBe('Description ')
    expect(INVOICE_HEADERS).toHaveLength(13)
  })
})

describe('formatInvoiceDate', () => {
  it('ISO → ДД.ММ.ГГГГ', () => {
    expect(formatInvoiceDate('2026-08-04')).toBe('04.08.2026')
    expect(formatInvoiceDate('2026-12-31T00:00:00Z')).toBe('31.12.2026')
  })
  it('празно при нечетима дата, вместо „NaN.NaN"', () => {
    expect(formatInvoiceDate('')).toBe('')
    expect(formatInvoiceDate('онзи ден')).toBe('')
  })
})

describe('invoiceDescription', () => {
  it('месецът е с водеща нула', () => {
    expect(invoiceDescription(2026, 8)).toBe('Абонамент м08/2026')
    expect(invoiceDescription(2026, 12)).toBe('Абонамент м12/2026')
  })
})

describe('formatPrice', () => {
  it('целите числа остават цели', () => {
    expect(formatPrice(200)).toBe('200')
    expect(formatPrice(0)).toBe('0')
  })
  it('дробното е с ТОЧКА — запетаята би сгрешила сумата', () => {
    expect(formatPrice(250.5)).toBe('250.5')
    expect(formatPrice(199.99)).toBe('199.99')
  })
  it('нечислово не хвърля', () => {
    expect(formatPrice(NaN)).toBe('0')
  })
})

describe('csvEscape', () => {
  it('не пипа обикновения текст', () => {
    expect(csvEscape('АГРОГРУП 2017 ООД')).toBe('АГРОГРУП 2017 ООД')
    expect(csvEscape(200)).toBe('200')
  })
  it('обгражда при точка и запетая', () => {
    expect(csvEscape('АЛФА; БЕТА')).toBe('"АЛФА; БЕТА"')
  })
  it('удвоява кавичките — истинският случай от файла', () => {
    expect(csvEscape('"ФИЛОСОФИЯ НА ВКУСА” ООД'))
      .toBe('"""ФИЛОСОФИЯ НА ВКУСА” ООД"')
  })
  it('обгражда при нов ред', () => {
    expect(csvEscape('А\nБ')).toBe('"А\nБ"')
  })
})

describe('buildInvoiceRows', () => {
  const clients: InvoiceClient[] = [
    { name: 'БОРЕ ГРУП ЕООД', eik: '205143100', price: 1500 },
    { name: 'АГРОГРУП 2017 ООД', eik: '204465251', price: 150 },
    { name: '"ФИЛОСОФИЯ НА ВКУСА” ООД', eik: '206881704', price: 200 },
  ]
  const rows = buildInvoiceRows(clients, OPTS)

  it('подрежда по азбучен ред ПРЕДИ да раздаде номерата', () => {
    // Кавичката отпред нарежда „ФИЛОСОФИЯ" първа — както в образеца.
    expect(rows.map(r => r[3])).toEqual([
      '"ФИЛОСОФИЯ НА ВКУСА” ООД', 'АГРОГРУП 2017 ООД', 'БОРЕ ГРУП ЕООД',
    ])
    expect(rows.map(r => r[0])).toEqual(['7379', '7380', '7381'])
  })

  it('попълва двете дати еднакво и описанието с периода', () => {
    expect(rows[0][1]).toBe('04.08.2026')
    expect(rows[0][2]).toBe('04.08.2026')
    expect(rows[0][8]).toBe('Абонамент м08/2026')
  })

  it('носи ЕИК, сума и константите', () => {
    expect(rows[1][4]).toBe('204465251')
    expect(rows[1][7]).toBe('150')
    expect(rows[1][5]).toBe('703')
    expect(rows[1][6]).toBe('1')
    expect(rows[1][9]).toBe('Счетоводно и ТРЗ обслужване')
    expect(rows[1][10]).toBe('20')
    expect(rows[1][11]).toBe('1')
    expect(rows[1][12]).toBe('Абонаментни услуги')
  })

  it('липсващ ЕИК дава празна клетка, а не „null"', () => {
    const r = buildInvoiceRows([{ name: 'БЕЗ ЕИК ЕООД', eik: null, price: 100 }], OPTS)
    expect(r[0][4]).toBe('')
  })

  it('всеки ред е с толкова колони, колкото са заглавията', () => {
    expect(rows.every(r => r.length === INVOICE_HEADERS.length)).toBe(true)
  })

  it('не пипа подадения масив', () => {
    const original = [...clients]
    buildInvoiceRows(clients, OPTS)
    expect(clients).toEqual(original)
  })
})

describe('toCsv', () => {
  it('редовете са с CRLF и точка и запетая, файлът завършва с нов ред', () => {
    const csv = toCsv(['A', 'B'], [['1', '2'], ['3', '4']])
    expect(csv).toBe('A;B\r\n1;2\r\n3;4\r\n')
  })
  it('заглавията също минават през екраниране', () => {
    expect(toCsv(['A;B'], [])).toBe('"A;B"\r\n')
  })
})

describe('checkInvoiceRows', () => {
  it('изброява фирмите без ЕИК и с нулева сума', () => {
    const w = checkInvoiceRows([
      { name: 'С ВСИЧКО ЕООД', eik: '123456789', price: 100 },
      { name: 'БЕЗ ЕИК ЕООД', eik: '  ', price: 100 },
      { name: 'НУЛЕВА ЕООД', eik: '123456789', price: 0 },
    ])
    expect(w.missingEik).toEqual(['БЕЗ ЕИК ЕООД'])
    expect(w.zeroPrice).toEqual(['НУЛЕВА ЕООД'])
  })
  it('чист набор → празни списъци', () => {
    const w = checkInvoiceRows([{ name: 'Х', eik: '1', price: 1 }])
    expect(w.missingEik).toEqual([])
    expect(w.zeroPrice).toEqual([])
  })
})
