import { describe, it, expect } from 'vitest'
import {
  splitLegalForm, transliterate, buildContractValues, fillTemplate,
  missingFields, usedFields, renderContractHtml, formatFee, nextMonthStart,
  isBilingualBody, parseBilingualRows, splitKeepSections,
  maskSensitive, hasSensitiveFields, MASK, applyGender,
} from './contract'

describe('splitLegalForm', () => {
  it('отделя правната форма от края на името', () => {
    expect(splitLegalForm('АВОМИС ЕООД')).toEqual({ name: 'АВОМИС', form: 'ЕООД' })
    expect(splitLegalForm('2Б ООД')).toEqual({ name: '2Б', form: 'ООД' })
    expect(splitLegalForm('АСИ 75 ЕАД')).toEqual({ name: 'АСИ 75', form: 'ЕАД' })
  })

  it('не бърка ЕООД с ООД (по-дългата форма печели)', () => {
    expect(splitLegalForm('ТЕСТ ЕООД').form).toBe('ЕООД')
  })

  it('оставя формата празна, когато името няма такава', () => {
    // Физически лица, ЗП, адвокатски съдружия — 15 такива в реалните данни.
    expect(splitLegalForm('ЗП ВЕЛИ КАРАХОДЖЕВ')).toEqual({ name: 'ЗП ВЕЛИ КАРАХОДЖЕВ', form: '' })
    expect(splitLegalForm('Д-Р ПЕНКА АТАНАСОВА').form).toBe('')
  })

  it('не отхапва форма, скрита в средата или в друга дума', () => {
    expect(splitLegalForm('ООД СЕРВИЗ').form).toBe('')
    expect(splitLegalForm('ПРОДАД').form).toBe('')
  })
})

describe('transliterate', () => {
  it('спазва официалната таблица', () => {
    expect(transliterate('Жельо')).toBe('Zhelyo')
    expect(transliterate('Щерев')).toBe('Shterev')
    expect(transliterate('Цветан Чолаков')).toBe('Tsvetan Cholakov')
    expect(transliterate('Ъгъл')).toBe('Agal')
  })

  it('предава окончанието -ия като -ia (чл. 4, ал. 2)', () => {
    expect(transliterate('София')).toBe('Sofia')
    expect(transliterate('Мария')).toBe('Maria')
    // …но само в края на думата
    expect(transliterate('Иван')).toBe('Ivan')
  })

  it('запазва изцяло главните имена главни', () => {
    expect(transliterate('АВОМИС')).toBe('AVOMIS')
    expect(transliterate('ЖИТО')).toBe('ZHITO')
  })

  it('не пипа цифри, пунктуация и латиница', () => {
    expect(transliterate('ул. „Златю Бояджиев“ №1, ет. 3'))
      .toBe('ul. „Zlatyu Boyadzhiev“ №1, et. 3')
    expect(transliterate('')).toBe('')
  })
})

describe('buildContractValues', () => {
  const src = {
    clientName: 'АВОМИС ЕООД',
    eik: '123456789',
    address: 'гр. Пловдив, ул. Тест 5',
    ownerName: 'Иван Петров Георгиев',
    ownerPhone: '0888123456',
    companyEmail: 'office@avomis.bg',
    fee: 250,
    today: new Date(2026, 7, 19),  // 19.08.2026
  }

  it('попълва българските полета от данните на клиента', () => {
    const v = buildContractValues(src)
    expect(v.фирма).toBe('АВОМИС')
    expect(v.правна_форма).toBe('ЕООД')
    expect(v.еик).toBe('123456789')
    expect(v.управител).toBe('Иван Петров Георгиев')
    expect(v.имейл).toBe('office@avomis.bg')
    expect(v.лице_за_контакт).toBe('Иван Петров Георгиев, 0888123456')
    expect(v.хонорар).toBe('250')
  })

  it('датата е днес, а „в сила от" — 1-во число на следващия месец', () => {
    const v = buildContractValues(src)
    expect(v.дата).toBe('19.08.2026')
    expect(v.в_сила_от).toBe('01.09.2026')
  })

  it('прехвърля декември в януари следващата година', () => {
    expect(nextMonthStart(new Date(2026, 11, 15))).toEqual(new Date(2027, 0, 1))
  })

  it('транслитерира латинските полета и превежда правната форма', () => {
    const v = buildContractValues(src)
    expect(v.фирма_en).toBe('AVOMIS')
    expect(v.правна_форма_en).toBe('LTD')
    expect(v.управител_en).toBe('Ivan Petrov Georgiev')
    // Телефонът остава както си е — не се транслитерира.
    expect(v.лице_за_контакт_en).toBe('Ivan Petrov Georgiev, 0888123456')
  })

  it('пада към личния имейл, ако липсва фирмен', () => {
    const v = buildContractValues({ ...src, companyEmail: null, ownerEmail: 'ivan@gmail.com' })
    expect(v.имейл).toBe('ivan@gmail.com')
  })

  it('предпочита мениджъра за лице за контакт', () => {
    const v = buildContractValues({ ...src, managerName: 'Мария Иванова' })
    expect(v.лице_за_контакт).toBe('Мария Иванова, 0888123456')
  })

  it('оставя празно вместо да измисля, когато данните липсват', () => {
    const v = buildContractValues({ clientName: 'САМПО', today: new Date(2026, 0, 5) })
    expect(v.еик).toBe('')
    expect(v.адрес).toBe('')
    expect(v.правна_форма).toBe('')
    expect(v.хонорар).toBe('')
  })
})

describe('formatFee', () => {
  it('кръглите суми са без стотинки', () => {
    expect(formatFee(250)).toBe('250')
    expect(formatFee(250.5)).toBe('250.50')
    expect(formatFee(null)).toBe('')
    expect(formatFee(undefined)).toBe('')
  })
})

describe('fillTemplate и missingFields', () => {
  const body = 'Днес, {дата}, „{фирма}“ {правна_форма} с ЕИК {еик} — {хонорар} EUR.'

  it('заменя всички срещания на маркера', () => {
    const out = fillTemplate('{фирма} и пак {фирма}', { фирма: 'АВОМИС' })
    expect(out).toBe('АВОМИС и пак АВОМИС')
  })

  it('попълва целия ред', () => {
    const out = fillTemplate(body, {
      дата: '19.08.2026', фирма: 'АВОМИС', правна_форма: 'ЕООД', еик: '123456789', хонорар: '250',
    })
    expect(out).toBe('Днес, 19.08.2026, „АВОМИС“ ЕООД с ЕИК 123456789 — 250 EUR.')
    expect(out).not.toContain('{')
  })

  it('разпознава кои маркери ползва шаблонът', () => {
    expect(usedFields(body)).toEqual(new Set(['дата', 'фирма', 'правна_форма', 'еик', 'хонорар']))
  })

  it('връща липсващите задължителни полета', () => {
    const missing = missingFields(body, { дата: '19.08.2026', фирма: 'АВОМИС', правна_форма: 'ЕООД' })
    expect(missing.map(f => f.key)).toEqual(['еик', 'хонорар'])
  })

  it('не се оплаква от поле, което шаблонът не ползва', () => {
    // Едноезичният шаблон няма {фирма_en} — не бива да го иска.
    expect(missingFields(body, { дата: 'x', фирма: 'x', правна_форма: 'x', еик: 'x', хонорар: 'x' })).toEqual([])
  })

  it('брои само празнините — интервалът не е стойност', () => {
    expect(missingFields('{еик}', { еик: '   ' }).map(f => f.key)).toEqual(['еик'])
  })
})

describe('renderContractHtml', () => {
  it('превръща маркъпа в заглавия и абзаци', () => {
    expect(renderContractHtml('# ДОГОВОР')).toBe('<h1>ДОГОВОР</h1>')
    expect(renderContractHtml('## подзаглавие')).toBe('<h2>подзаглавие</h2>')
    expect(renderContractHtml('### I. Предмет')).toBe('<h3>I. Предмет</h3>')
    expect(renderContractHtml('обикновен ред')).toBe('<p>обикновен ред</p>')
  })

  it('групира последователните булети в един списък', () => {
    expect(renderContractHtml('- едно\n- две\nкрай'))
      .toBe('<ul>\n<li>едно</li>\n<li>две</li>\n</ul>\n<p>край</p>')
  })

  it('затваря списъка и в края на текста', () => {
    expect(renderContractHtml('- едно')).toBe('<ul>\n<li>едно</li>\n</ul>')
  })

  it('екранира HTML от текста на договора', () => {
    // Шаблонът се редактира от admin, а стойностите идват от базата — нито
    // едното не бива да може да инжектира маркъп в готовия документ.
    expect(renderContractHtml('<script>alert(1)</script>'))
      .toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })
})

describe('двуезичен маркъп', () => {
  const bi = [
    '# ДОГОВОР',
    '@@',
    '# CONTRACT',
    '',
    'Днес, 19.08.2026 г.',
    '@@',
    'Today, 19.08.2026',
  ].join('\n')

  it('разпознава двуезичен шаблон по разделителя', () => {
    expect(isBilingualBody(bi)).toBe(true)
    expect(isBilingualBody('# ДОГОВОР\nобикновен текст')).toBe(false)
    // „@@" насред ред не е разделител — само на самостоятелен ред.
    expect(isBilingualBody('текст @@ друг текст')).toBe(false)
  })

  it('разделя на редове и колони', () => {
    expect(parseBilingualRows(bi)).toEqual([
      ['# ДОГОВОР', '# CONTRACT'],
      ['Днес, 19.08.2026 г.', 'Today, 19.08.2026'],
    ])
  })

  it('пази многоредовите клетки цели', () => {
    const rows = parseBilingualRows('ред1\nред2\n@@\nline1\nline2')
    expect(rows).toEqual([['ред1\nред2', 'line1\nline2']])
  })

  it('рендира таблица с две колони', () => {
    const html = renderContractHtml(bi)
    expect(html).toContain('<table class="bi">')
    expect(html).toContain('<td><h1>ДОГОВОР</h1></td><td><h1>CONTRACT</h1></td>')
    expect(html).toContain('<td><p>Днес, 19.08.2026 г.</p></td><td><p>Today, 19.08.2026</p></td>')
  })

  it('ред без разделител заема цялата ширина', () => {
    const html = renderContractHtml('# ДОГОВОР\n@@\n# CONTRACT\n\nобщ ред за двете колони')
    expect(html).toContain('<td colspan="2"><p>общ ред за двете колони</p></td>')
  })

  it('едноезичният шаблон си остава без таблица', () => {
    expect(renderContractHtml('# ДОГОВОР\nтекст')).toBe('<h1>ДОГОВОР</h1>\n<p>текст</p>')
  })

  it('групира булети вътре в колоната', () => {
    const html = renderContractHtml('- едно\n- две\n@@\n- one\n- two')
    expect(html).toContain('<td><ul>\n<li>едно</li>\n<li>две</li>\n</ul></td>')
    expect(html).toContain('<td><ul>\n<li>one</li>\n<li>two</li>\n</ul></td>')
  })
})

describe('неделими секции', () => {
  it('разделя по маркера „===" на самостоятелен ред', () => {
    expect(splitKeepSections('едно\n===\nдве')).toEqual(['едно', 'две'])
    expect(splitKeepSections('едно\nдве')).toEqual(['едно\nдве'])
  })

  it('приема и по-дълга черта, с интервали около нея', () => {
    expect(splitKeepSections('едно\n =====  \nдве')).toEqual(['едно', 'две'])
  })

  it('не се подвежда от „===" насред ред', () => {
    expect(splitKeepSections('а === б')).toEqual(['а === б'])
  })

  it('в едноезичен договор секцията излиза в собствен блок', () => {
    const html = renderContractHtml('текст\n===\nподписи')
    expect(html).toBe('<p>текст</p>\n<div class="keep">\n<p>подписи</p>\n</div>')
  })

  it('в двуезичен договор секцията е отделно tbody', () => {
    const html = renderContractHtml('текст\n@@\ntext\n\n===\nподписи\n@@\nsignatures')
    expect(html).toContain('<tbody>\n<tr><td><p>текст</p></td><td><p>text</p></td></tr>\n</tbody>')
    expect(html).toContain('<tbody class="keep">\n<tr><td><p>подписи</p></td><td><p>signatures</p></td></tr>\n</tbody>')
  })

  it('без маркер си остава едно tbody', () => {
    const html = renderContractHtml('а\n@@\nb')
    expect(html).toContain('<tbody>')
    expect(html).not.toContain('class="keep"')
  })
})

describe('удебеляване на попълненото', () => {
  it('обгръща стойностите в ** при bold', () => {
    const out = fillTemplate('фирма {фирма} с ЕИК {еик}', { фирма: 'АВОМИС', еик: '123' }, { bold: true })
    expect(out).toBe('фирма **АВОМИС** с ЕИК **123**')
  })

  it('без опцията текстът си остава чист', () => {
    expect(fillTemplate('{фирма}', { фирма: 'АВОМИС' })).toBe('АВОМИС')
  })

  it('не обгръща празна стойност — иначе остава празен получер интервал', () => {
    expect(fillTemplate('{фирма}', { фирма: '' }, { bold: true })).toBe('')
    expect(fillTemplate('{фирма}', { фирма: '  ' }, { bold: true })).toBe('  ')
  })

  it('рендира ** като <strong>', () => {
    expect(renderContractHtml('текст **АВОМИС** край'))
      .toBe('<p>текст <strong>АВОМИС</strong> край</p>')
  })

  it('удебелява и в заглавия и в булети', () => {
    expect(renderContractHtml('### Раздел **X**')).toBe('<h3>Раздел <strong>X</strong></h3>')
    expect(renderContractHtml('- едно **две**')).toBe('<ul>\n<li>едно <strong>две</strong></li>\n</ul>')
  })

  it('екранирането остава — удебеленото не е дупка за маркъп', () => {
    expect(renderContractHtml('**<script>**'))
      .toBe('<p><strong>&lt;script&gt;</strong></p>')
  })

  it('самотна двойка звездички не се пипа', () => {
    expect(renderContractHtml('текст ** край')).toBe('<p>текст ** край</p>')
  })
})

describe('лични данни в пълномощното', () => {
  const v = { управител: 'Иван Петров', егн: '8001011234', лк_номер: '123456789', лк_дата: '01.01.2020', лк_мвр: 'Пловдив', адрес_лице: 'гр. Пловдив, ул. Тест 1' }

  it('маскира ЕГН и данните от личната карта', () => {
    const m = maskSensitive(v)
    expect(m.егн).toBe(MASK)
    expect(m.лк_номер).toBe(MASK)
    expect(m.лк_дата).toBe(MASK)
    expect(m.лк_мвр).toBe(MASK)
  })

  it('не пипа останалите полета', () => {
    const m = maskSensitive(v)
    expect(m.управител).toBe('Иван Петров')
    expect(m.адрес_лице).toBe('гр. Пловдив, ул. Тест 1')
  })

  it('празно поле си остава празно — не става точки', () => {
    expect(maskSensitive({ егн: '' }).егн).toBe('')
    expect(maskSensitive({ егн: '  ' }).егн).toBe('  ')
  })

  it('не променя подадения обект', () => {
    const orig = { егн: '8001011234' }
    maskSensitive(orig)
    expect(orig.егн).toBe('8001011234')
  })

  it('разпознава шаблон с лични данни', () => {
    expect(hasSensitiveFields('ЕГН {егн}')).toBe(true)
    expect(hasSensitiveFields('лична карта {лк_номер}')).toBe(true)
    expect(hasSensitiveFields('фирма {фирма} с ЕИК {еик}')).toBe(false)
  })

  it('маскираното наистина липсва в записания текст', () => {
    const body = 'Долуподписаният {управител}, ЕГН {егн}, ЛК № {лк_номер}'
    const saved = fillTemplate(body, maskSensitive(v), { bold: true })
    expect(saved).not.toContain('8001011234')
    expect(saved).not.toContain('123456789')
    expect(saved).toContain('Иван Петров')
  })
})

describe('род по пол', () => {
  const body = 'Долуподписан{пол:ият|ата} {управител}, граждан{пол:ин|ка}, притежаващ{пол:|а} ЛК'

  it('мъжки род взима първия вариант', () => {
    expect(applyGender(body, 'мъж'))
      .toBe('Долуподписаният {управител}, гражданин, притежаващ ЛК')
  })

  it('женски род взима втория', () => {
    expect(applyGender(body, 'жена'))
      .toBe('Долуподписаната {управител}, гражданка, притежаваща ЛК')
  })

  it('без стойност пада към мъжки — както е в правния език', () => {
    expect(applyGender(body, undefined)).toBe(applyGender(body, 'мъж'))
    expect(applyGender(body, '')).toBe(applyGender(body, 'мъж'))
  })

  it('празен вариант е позволен (притежаващ / притежаваща)', () => {
    expect(applyGender('работещ{пол:|а}', 'мъж')).toBe('работещ')
    expect(applyGender('работещ{пол:|а}', 'жена')).toBe('работеща')
  })

  it('fillTemplate прилага рода заедно със стойностите', () => {
    const out = fillTemplate('Долуподписан{пол:ият|ата} {управител}',
      { управител: 'Мария Иванова', пол: 'жена' })
    expect(out).toBe('Долуподписаната Мария Иванова')
  })

  it('шаблон с род иска полето „пол"', () => {
    expect(usedFields('Долуподписан{пол:ият|ата}').has('пол')).toBe(true)
    expect(usedFields('обикновен текст').has('пол')).toBe(false)
  })

  it('текст без маркер не се пипа', () => {
    expect(applyGender('нищо за мен', 'жена')).toBe('нищо за мен')
  })
})
