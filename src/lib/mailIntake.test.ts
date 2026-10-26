import { describe, it, expect } from 'vitest'
import {
  parseFromHeader, isAllowedSender, hasKeyword, normalizeEik, normalizeEmail,
  normalizePhone, validateExtraction, screenEmail, cleanSubject, resolveName,
  senderProven,
} from './mailIntake'

const STAFF = ['ivan@consultplus.bg', 'Radka.Nikolova@consultplus.bg', 'kalin@gmail.com', null, '']

describe('parseFromHeader', () => {
  it('вади адреса от „Име <адрес>"', () => {
    expect(parseFromHeader('Радка Николова <r.nikolova@consultplus.bg>')).toBe('r.nikolova@consultplus.bg')
  })
  it('приема и гол адрес', () => {
    expect(parseFromHeader('  IVAN@consultplus.BG ')).toBe('ivan@consultplus.bg')
  })
  it('връща празно за нещо, което не е адрес', () => {
    expect(parseFromHeader('Радка Николова')).toBe('')
    expect(parseFromHeader('a@b')).toBe('')
    expect(parseFromHeader(null)).toBe('')
    expect(parseFromHeader('')).toBe('')
  })
})

describe('isAllowedSender', () => {
  it('пуска всеки от фирмения домейн', () => {
    expect(isAllowedSender('nov.kolega@consultplus.bg', [])).toBe(true)
  })
  // Колегите без попълнен имейл в Персонал са доста — домейнът ги покрива.
  it('пуска колега от Персонал и с друг домейн', () => {
    expect(isAllowedSender('Калин <kalin@gmail.com>', STAFF)).toBe(true)
  })
  it('не се води по регистър', () => {
    expect(isAllowedSender('KALIN@GMAIL.COM', STAFF)).toBe(true)
    expect(isAllowedSender('radka.nikolova@consultplus.bg', STAFF)).toBe(true)
  })
  it('спира непознат подател', () => {
    expect(isAllowedSender('spam@example.com', STAFF)).toBe(false)
  })
  // Домейнът се проверява като СУФИКС след „@", не като „съдържа".
  it('спира домейн, който само прилича', () => {
    expect(isAllowedSender('a@consultplus.bg.evil.com', STAFF)).toBe(false)
    expect(isAllowedSender('a@notconsultplus.bg', STAFF)).toBe(false)
  })
  it('спира празно и безсмислено', () => {
    expect(isAllowedSender('', STAFF)).toBe(false)
    expect(isAllowedSender(null, STAFF)).toBe(false)
    expect(isAllowedSender('Радка', STAFF)).toBe(false)
  })
})

describe('hasKeyword', () => {
  // Препращането лепи отпред какво ли не — затова „съдържа", не „започва с".
  it('намира думата след префикса на препращането', () => {
    expect(hasKeyword('Fwd: възможност — нова фирма')).toBe(true)
    expect(hasKeyword('Препратено: ВЪЗМОЖНОСТ')).toBe(true)
    expect(hasKeyword('RE: FW: запитване възможности')).toBe(true)
  })
  it('отказва тема без думата', () => {
    expect(hasKeyword('Fwd: запитване')).toBe(false)
    expect(hasKeyword('')).toBe(false)
    expect(hasKeyword(null)).toBe(false)
  })
})

describe('normalizeEik', () => {
  it('приема 9 и 13 цифри', () => {
    expect(normalizeEik('203912345')).toBe('203912345')
    expect(normalizeEik('2039123450001')).toBe('2039123450001')
  })
  it('маха разделителите', () => {
    expect(normalizeEik('203 912 345')).toBe('203912345')
    expect(normalizeEik('ЕИК: 203912345')).toBe('203912345')
  })
  // Урокът от серийните номера на КЕП: по-добре празно, отколкото
  // правдоподобно сгрешено число.
  it('отказва всичко друго вместо да налучква', () => {
    expect(normalizeEik('20391234')).toBeNull()
    expect(normalizeEik('2.03912345e+08')).toBeNull()
    expect(normalizeEik('няма')).toBeNull()
    expect(normalizeEik(203912345)).toBeNull()
    expect(normalizeEik(null)).toBeNull()
  })
})

describe('normalizeEmail / normalizePhone', () => {
  it('приема смислен имейл', () => {
    expect(normalizeEmail(' Office@Firma.BG ')).toBe('office@firma.bg')
  })
  it('отказва нескопосан имейл', () => {
    expect(normalizeEmail('няма')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })
  it('пази телефона както е писан', () => {
    expect(normalizePhone(' +359 888 123 456 ')).toBe('+359 888 123 456')
    expect(normalizePhone('02/981-23-45')).toBe('02/981-23-45')
  })
  it('отказва телефон без цифри или твърде къс', () => {
    expect(normalizePhone('няма телефон')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('validateExtraction', () => {
  it('приема попълнен отговор', () => {
    const r = validateExtraction({
      name: 'АВОМИС ЕООД', eik: '203912345', contact_person: 'Иван Иванов',
      contact_phone: '+359888123456', contact_email: 'ivan@avomis.bg',
      notes: 'Търси счетоводител от януари.',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('АВОМИС ЕООД')
  })

  // ПРОМЕНЕНО ПОВЕДЕНИЕ (10.2026): липсващо име вече НЕ е отказ. Най-честото
  // запитване е от физическо лице без фирма и писмото се губеше безследно.
  it('отказва само когато отговорът изобщо не е обект', () => {
    expect(validateExtraction(null).ok).toBe(false)
    expect(validateExtraction('АВОМИС').ok).toBe(false)
    expect(validateExtraction(42).ok).toBe(false)
  })

  it('без име взема лицето за контакт', () => {
    const r = validateExtraction({ name: '', contact_person: 'Анелия Делийчева' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('Анелия Делийчева')
  })

  it('без име и без лице взема темата', () => {
    const r = validateExtraction({}, { subject: 'Fwd: възможност — АВОМИС ЕООД' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('АВОМИС ЕООД')
  })

  it('в краен случай взема подателя', () => {
    const r = validateExtraction({}, { subject: 'Fwd: възможност', from: 'ivan@consultplus.bg' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('ivan@consultplus.bg')
  })

  it('не остава съвсем без име', () => {
    const r = validateExtraction({})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('(без име)')
  })

  // Същината: невалидно поле става ПРАЗНО, не „каквото каза моделът".
  it('зачиства невалидните полета, вместо да ги приема', () => {
    const r = validateExtraction({
      name: 'АВОМИС ЕООД', eik: 'не знам', contact_phone: 'няма',
      contact_email: 'няма', contact_person: 42,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.eik).toBeNull()
      expect(r.value.contact_phone).toBeNull()
      expect(r.value.contact_email).toBeNull()
      expect(r.value.contact_person).toBeNull()
    }
  })

  it('реже дългите полета, за да не надува реда', () => {
    const r = validateExtraction({ name: 'х'.repeat(500), notes: 'у'.repeat(9000) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toHaveLength(200)
      expect(r.value.notes).toHaveLength(4000)
    }
  })

  it('свива празните знаци', () => {
    const r = validateExtraction({ name: '  АВОМИС   ЕООД \n ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('АВОМИС ЕООД')
  })

  it('не пропуска чужди полета в реда', () => {
    const r = validateExtraction({ name: 'АВОМИС', stage: 'Печеливш', deleted: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.value).sort()).toEqual(
      ['contact_email', 'contact_person', 'contact_phone', 'eik', 'name', 'notes'],
    )
  })
})

describe('screenEmail', () => {
  it('пуска препратено от колега с вярна тема', () => {
    expect(screenEmail('r.nikolova@consultplus.bg', 'Fwd: възможност', STAFF)).toEqual({ accept: true })
  })
  it('отказва чужд подател, преди да гледа темата', () => {
    const v = screenEmail('spam@example.com', 'Fwd: възможност', STAFF)
    expect(v).toEqual({ accept: false, reason: 'подателят не е от кантората' })
  })
  it('отказва свой подател без ключовата дума', () => {
    const v = screenEmail('ivan@consultplus.bg', 'Fwd: фактура', STAFF)
    expect(v.accept).toBe(false)
    if (!v.accept) expect(v.reason).toContain('темата')
  })
})

describe('cleanSubject', () => {
  it('маха префиксите на препращането и ключовата дума', () => {
    expect(cleanSubject('Fwd: възможност — АВОМИС ЕООД')).toBe('АВОМИС ЕООД')
    expect(cleanSubject('Препратено: Възможност: ново запитване')).toBe('ново запитване')
  })

  // Префиксите се трупат — „RE: FW: Fwd:" е обичайна гледка.
  it('маха НАТРУПАНИТЕ префикси', () => {
    expect(cleanSubject('RE: FW: Fwd: възможност - ОМЕКС ООД')).toBe('ОМЕКС ООД')
  })

  it('връща празно, когато няма нищо освен служебното', () => {
    expect(cleanSubject('Fwd: възможност')).toBe('')
    expect(cleanSubject('възможности')).toBe('')
    expect(cleanSubject('')).toBe('')
    expect(cleanSubject(null)).toBe('')
  })

  it('не пипа тема без служебни части', () => {
    expect(cleanSubject('АВОМИС ЕООД')).toBe('АВОМИС ЕООД')
  })
})

describe('resolveName', () => {
  it('предпочита фирмата пред всичко', () => {
    expect(resolveName('АВОМИС ЕООД', 'Иван', 'Fwd: възможност — друго', 'a@b.bg'))
      .toBe('АВОМИС ЕООД')
  })

  it('слиза по веригата', () => {
    expect(resolveName(null, 'Иван Иванов', 'Fwd: възможност — х', 'a@b.bg')).toBe('Иван Иванов')
    expect(resolveName(null, null, 'Fwd: възможност — ОМЕКС', 'a@b.bg')).toBe('ОМЕКС')
    expect(resolveName(null, null, 'Fwd: възможност', 'Иван <a@b.bg>')).toBe('a@b.bg')
    expect(resolveName(null, null, null, null)).toBe('(без име)')
  })

  it('реже свръхдълго име', () => {
    expect(resolveName('х'.repeat(500), null, null, null)).toHaveLength(200)
  })
})

describe('senderProven', () => {
  const FROM = 'Калин Диев <k.diev@consultplus.bg>'

  it('приема готова DMARC присъда', () => {
    expect(senderProven('mx.cloudflare.net; dmarc=pass; spf=pass', FROM)).toBe(true)
  })

  // Случаят на кантората: consultplus.bg НЯМА DMARC запис, но SPF минава.
  it('приема SPF, минал за СЪЩИЯ домейн', () => {
    const h = 'mx.cloudflare.net; spf=pass smtp.mailfrom=consultplus.bg; dmarc=none'
    expect(senderProven(h, FROM)).toBe(true)
  })

  it('приема DKIM, минал за същия домейн', () => {
    const h = 'mx.cloudflare.net; spf=fail; dkim=pass header.d=consultplus.bg; dmarc=none'
    expect(senderProven(h, FROM)).toBe(true)
  })

  // СЪЩИНАТА: SPF може да мине за ЧУЖД домейн, докато в „From" пише нашият.
  // Точно това подправяне трябва да се спре.
  it('ОТКАЗВА SPF, минал за чужд домейн', () => {
    const h = 'mx.cloudflare.net; spf=pass smtp.mailfrom=evil.example.com; dmarc=none'
    expect(senderProven(h, FROM)).toBe(false)
  })

  it('ОТКАЗВА DKIM, подписан от чужд домейн', () => {
    const h = 'mx.cloudflare.net; dkim=pass header.d=evil.example.com'
    expect(senderProven(h, FROM)).toBe(false)
  })

  it('приема поддомейн (свободно подравняване)', () => {
    const h = 'mx.cloudflare.net; spf=pass smtp.mailfrom=mail.consultplus.bg'
    expect(senderProven(h, FROM)).toBe(true)
  })

  // „spf=pass" от единия метод не бива да се сдвоява с „header.d" от другия.
  it('не смесва двата метода през разделителя', () => {
    const h = 'mx.cloudflare.net; spf=pass smtp.mailfrom=evil.com; dkim=fail header.d=consultplus.bg'
    expect(senderProven(h, FROM)).toBe(false)
  })

  it('отказва при провалени проверки', () => {
    expect(senderProven('mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail', FROM)).toBe(false)
    expect(senderProven('mx.cloudflare.net; spf=none; dmarc=none', FROM)).toBe(false)
  })

  it('отказва при липсваща заглавка или подател', () => {
    expect(senderProven('', FROM)).toBe(false)
    expect(senderProven(null, FROM)).toBe(false)
    expect(senderProven('spf=pass smtp.mailfrom=consultplus.bg', '')).toBe(false)
    expect(senderProven('spf=pass smtp.mailfrom=consultplus.bg', 'не е адрес')).toBe(false)
  })

  it('не се води по регистър', () => {
    const h = 'MX.CLOUDFLARE.NET; SPF=PASS smtp.mailfrom=CONSULTPLUS.BG'
    expect(senderProven(h, 'K.DIEV@CONSULTPLUS.BG')).toBe(true)
  })
})
