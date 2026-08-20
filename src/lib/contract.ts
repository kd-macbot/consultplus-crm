/**
 * Изготвяне на договор от шаблон.
 *
 * Шаблонът е текст с маркери {фирма}, {еик}, … и лек маркъп за оформлението
 * (# ## ### - и **удебелен**). Стойностите се сглобяват от данните за клиента, показват се
 * на потребителя за проверка/редакция и чак тогава се вливат в текста.
 *
 * Нищо тук не пипа базата — само чисти функции, за да са тестваеми.
 */

// ==================== ПРАВНА ФОРМА ====================

/**
 * Имената на фирмите в CRM-а включват правната форма („АВОМИС ЕООД").
 * Договорът обаче я иска отделно: „[НАИМЕНОВАНИЕ]“ [ЕООД/ООД] — иначе излиза
 * „АВОМИС ЕООД“ ЕООД.
 *
 * Подредбата е от най-дългата към най-късата, за да не отхапе „ООД" от „ЕООД".
 */
const LEGAL_FORMS = ['АДСИЦ', 'ДЗЗД', 'ЕООД', 'ЕАД', 'ООД', 'АД', 'ЕТ', 'СД', 'КД'] as const

export function splitLegalForm(fullName: string): { name: string; form: string } {
  const trimmed = (fullName ?? '').trim()
  for (const form of LEGAL_FORMS) {
    // Само в КРАЯ на името и като отделна дума — „АСИ 75 ЕООД" да, „ЕТАЖ" не.
    const re = new RegExp(`(^|\\s)${form}\\.?$`)
    const m = trimmed.match(re)
    if (m) return { name: trimmed.slice(0, m.index).trim(), form }
  }
  // Физически лица, ЗП, адвокатски съдружия — формата се попълва ръчно.
  return { name: trimmed, form: '' }
}

// ==================== ТРАНСЛИТЕРАЦИЯ ====================

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
}

/**
 * Транслитерация по Закона за транслитерацията. Запазва регистъра: дума с
 * главни букви остава с главни (АВОМИС → AVOMIS), иначе само първата.
 *
 * Изключението по чл. 4, ал. 2 — окончанието „-ия" в края на думата се предава
 * с „-ia" (София → Sofia, а не Sofiya).
 */
export function transliterate(text: string): string {
  if (!text) return ''
  return text.replace(/[\wА-Яа-яЁёЍѝ]+|./gu, chunk => {
    if (!/[А-Яа-я]/.test(chunk)) return chunk
    const isUpper = chunk === chunk.toUpperCase() && chunk.length > 1
    const base = chunk.replace(/ия$/u, 'ia@')  // @ маркира вече готово окончание
    let out = ''
    for (const ch of base) {
      if (ch === '@') continue
      const lower = ch.toLowerCase()
      const mapped = TRANSLIT[lower]
      if (mapped === undefined) { out += ch; continue }
      out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1)
    }
    return isUpper ? out.toUpperCase() : out
  })
}

// ==================== ПОЛЕТА НА ДОГОВОРА ====================

export type ContractFieldKey =
  | 'фирма' | 'правна_форма' | 'еик' | 'адрес' | 'управител' | 'имейл'
  | 'лице_за_контакт' | 'хонорар' | 'дата' | 'в_сила_от'
  | 'фирма_en' | 'правна_форма_en' | 'адрес_en' | 'управител_en' | 'лице_за_контакт_en'
  | 'егн' | 'адрес_лице' | 'лк_номер' | 'лк_дата' | 'лк_мвр' | 'пол'

export const GENDERS = ['мъж', 'жена'] as const

/**
 * Родът в българския текст: „Долуподписан{пол:ият|ата}" дава „Долуподписаният"
 * при мъж и „Долуподписаната" при жена. Първият вариант е мъжки, вторият —
 * женски. Маркерът е общ, за да може admin да го ползва навсякъде в шаблона,
 * вместо да държим списък с конкретни думи в кода.
 */
export const GENDER_RE = /\{пол:([^|}]*)\|([^}]*)\}/g

export function applyGender(text: string, gender: string | undefined): string {
  const female = (gender ?? '').trim() === 'жена'
  return text.replace(new RegExp(GENDER_RE.source, 'g'), (_, m, f) => (female ? f : m))
}

export type ContractFieldDef = {
  key: ContractFieldKey
  label: string
  hint: string
  /** Празно поле спира генерирането — договор с дупка на това място не върши работа. */
  required: boolean
  /** Само за двуезичния шаблон. */
  bilingualOnly?: boolean
  multiline?: boolean
  /**
   * Лични данни, които не се пазят в историята (ЕГН, лична карта). Влизат в
   * разпечатката, но в базата отиват маскирани — виж maskSensitive.
   */
  sensitive?: boolean
  /** Стойностите за падащо меню; при липса полето е свободен текст. */
  options?: readonly string[]
}

export const CONTRACT_FIELDS: ContractFieldDef[] = [
  { key: 'фирма', label: 'Наименование на фирмата', hint: 'от Клиенти, без правната форма', required: true },
  { key: 'правна_форма', label: 'Правна форма', hint: 'ЕООД / ООД / АД…', required: true },
  { key: 'еик', label: 'ЕИК', hint: 'от Контакти', required: true },
  { key: 'адрес', label: 'Седалище и адрес на управление', hint: 'от Контакти', required: true, multiline: true },
  { key: 'управител', label: 'Представляващ (трите имена)', hint: 'от Контакти → собственик', required: true },
  { key: 'имейл', label: 'Имейл за кореспонденция', hint: 'от Контакти', required: true },
  { key: 'лице_за_контакт', label: 'Лице за контакт (име, телефон)', hint: 'от Контакти', required: true },
  { key: 'хонорар', label: 'Месечно възнаграждение (EUR, без ДДС)', hint: 'от колона „Хонорар"', required: true },
  { key: 'дата', label: 'Дата на сключване', hint: 'днес', required: true },
  { key: 'в_сила_от', label: 'Влиза в сила от (чл. 36)', hint: '1-во число на следващия месец', required: true },
  { key: 'фирма_en', label: 'Наименование на латиница', hint: 'авто транслитерация — сверете с официалното име', required: true, bilingualOnly: true },
  { key: 'правна_форма_en', label: 'Правна форма (EN)', hint: 'LTD / JSC…', required: true, bilingualOnly: true },
  { key: 'адрес_en', label: 'Адрес на латиница', hint: 'авто транслитерация', required: true, bilingualOnly: true, multiline: true },
  { key: 'управител_en', label: 'Представляващ на латиница', hint: 'авто транслитерация', required: true, bilingualOnly: true },
  { key: 'лице_за_контакт_en', label: 'Лице за контакт (EN)', hint: 'авто транслитерация', required: true, bilingualOnly: true },
  // Пълномощно — тези ги няма в CRM-а и се попълват на ръка при всяко изготвяне.
  { key: 'егн', label: 'ЕГН на упълномощителя', hint: 'не се пази в историята', required: true, sensitive: true },
  { key: 'адрес_лице', label: 'Постоянен адрес (на физическото лице)', hint: 'област, община, град, улица, №, ет.', required: true, multiline: true },
  { key: 'лк_номер', label: 'Лична карта №', hint: 'не се пази в историята', required: true, sensitive: true },
  { key: 'лк_дата', label: 'ЛК издадена на', hint: 'ДД.ММ.ГГГГ — не се пази в историята', required: true, sensitive: true },
  { key: 'лк_мвр', label: 'ЛК издадена от МВР — гр.', hint: 'не се пази в историята', required: true, sensitive: true },
  { key: 'пол', label: 'Пол на упълномощителя', hint: 'мени окончанията в текста', required: true, options: GENDERS },
]

/**
 * Стойностите за записване в историята: личните данни се заменят с точки.
 * Разпечатката ги съдържа, базата — не. Така в историята се вижда кога и за
 * кого е издаден документът, без ЕГН и лична карта да лежат в crm_contracts.
 */
export const MASK = '••••••'

export function maskSensitive(values: Partial<ContractValues>): Partial<ContractValues> {
  const out = { ...values }
  for (const f of CONTRACT_FIELDS) {
    if (f.sensitive && (out[f.key] ?? '').trim()) out[f.key] = MASK
  }
  return out
}

/** Има ли шаблонът поле с лични данни — за предупреждението в UI. */
export function hasSensitiveFields(body: string): boolean {
  const used = usedFields(body)
  return CONTRACT_FIELDS.some(f => f.sensitive && used.has(f.key))
}

export type ContractValues = Record<ContractFieldKey, string>

/** Правната форма на латиница — както се изписва в англоезични договори. */
const LEGAL_FORM_EN: Record<string, string> = {
  ЕООД: 'LTD', ООД: 'LTD', ЕАД: 'JSC', АД: 'JSC',
  ЕТ: 'Sole Trader', СД: 'General Partnership', КД: 'Limited Partnership',
  ДЗЗД: 'Civil Partnership', АДСИЦ: 'REIT',
}

export function formatFee(fee: number | null | undefined): string {
  if (fee == null || !Number.isFinite(fee)) return ''
  // Кръгли суми без стотинки — „250", не „250.00"; иначе с две знака.
  return Number.isInteger(fee) ? String(fee) : fee.toFixed(2)
}

/** ДД.ММ.ГГГГ — както е навсякъде в системата (виж formatDate в utils). */
function dmy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Абонаментните договори тръгват от началото на следващия месец (чл. 16). */
export function nextMonthStart(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1)
}

export type ContractSource = {
  clientName: string
  eik?: string | null
  address?: string | null
  ownerName?: string | null
  ownerPhone?: string | null
  companyEmail?: string | null
  ownerEmail?: string | null
  managerName?: string | null
  fee?: number | null
  today?: Date
}

/** Сглобява предложените стойности. Всяка от тях е редактируема в UI преди печат. */
export function buildContractValues(src: ContractSource): ContractValues {
  const today = src.today ?? new Date()
  const { name, form } = splitLegalForm(src.clientName)

  const contactName = (src.managerName || src.ownerName || '').trim()
  const phone = (src.ownerPhone || '').trim()
  const contact = [contactName, phone].filter(Boolean).join(', ')

  const address = (src.address || '').trim()
  const manager = (src.ownerName || '').trim()

  return {
    фирма: name,
    правна_форма: form,
    еик: (src.eik || '').trim(),
    адрес: address,
    управител: manager,
    // Договорът иска адрес за кореспонденция — фирменият имейл, а ако липсва,
    // личният на собственика.
    имейл: (src.companyEmail || src.ownerEmail || '').trim(),
    лице_за_контакт: contact,
    хонорар: formatFee(src.fee),
    дата: dmy(today),
    в_сила_от: dmy(nextMonthStart(today)),
    фирма_en: transliterate(name),
    правна_форма_en: LEGAL_FORM_EN[form] ?? '',
    адрес_en: transliterate(address),
    управител_en: transliterate(manager),
    лице_за_контакт_en: contact ? transliterate(contactName) + (phone ? `, ${phone}` : '') : '',
    // Няма ги в CRM-а — попълват се на ръка при изготвяне на пълномощно.
    егн: '', адрес_лице: '', лк_номер: '', лк_дата: '', лк_мвр: '',
    пол: GENDERS[0],
  }
}

// ==================== ПОПЪЛВАНЕ ====================

/** Кои маркери реално се срещат в даден шаблон. */
export function usedFields(body: string): Set<string> {
  const out = new Set((body.match(/\{[a-zа-я_]+\}/gu) ?? []).map(m => m.slice(1, -1)))
  // „{пол:ият|ата}" не е обикновен маркер, но означава, че шаблонът зависи от
  // пола — иначе полето нямаше да се покаже за попълване.
  if (new RegExp(GENDER_RE.source).test(body)) out.add('пол')
  return out
}

/**
 * Полетата, които този шаблон изисква и които са празни. Договор с празно
 * място не се генерира — по-добре ясно съобщение „липсва ЕИК", отколкото
 * документ с дупка, който някой ще подпише.
 */
export function missingFields(body: string, values: Partial<ContractValues>): ContractFieldDef[] {
  const used = usedFields(body)
  return CONTRACT_FIELDS.filter(f => f.required && used.has(f.key) && !(values[f.key] ?? '').trim())
}

/**
 * Попълва маркерите със стойностите.
 *
 * С `bold` попълненото се обгръща в `**…**` — така в готовия документ личи
 * кое е конкретно за този клиент и кое е типовият текст на договора. Празна
 * стойност не се обгръща, за да не остане празен удебелен интервал.
 */
export function fillTemplate(
  body: string, values: Partial<ContractValues>, opts: { bold?: boolean } = {},
): string {
  // Родът се решава преди заместването — иначе окончанието би могло да попадне
  // вътре в удебелена стойност.
  let out = applyGender(body, values.пол)
  for (const f of CONTRACT_FIELDS) {
    const raw = values[f.key] ?? ''
    const v = opts.bold && raw.trim() ? `**${raw}**` : raw
    out = out.split(`{${f.key}}`).join(v)
  }
  return out
}

// ==================== РЕНДИРАНЕ ====================

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/** Регулярният израз за удебеления текст — един източник за HTML и за preview-то. */
export const BOLD_RE = /\*\*([^*]+)\*\*/g

/** Екранира текста и превръща `**…**` в <strong>. */
function inline(s: string): string {
  return escapeHtml(s).replace(BOLD_RE, '<strong>$1</strong>')
}

/**
 * Разделителят между двете езикови колони в двуезичен шаблон. Стои на
 * самостоятелен ред; празен ред разделя редовете на таблицата.
 */
export const LANG_SEPARATOR = '@@'

/**
 * Празен ред в документа. Обикновеният празен ред в шаблона не става — в
 * двуезичните той разделя редовете на таблицата, а в едноезичните затваря
 * списък. Затова изрично: „~" на самостоятелен ред = един празен ред.
 */
export const SPACER = '~'

/**
 * Маркер за неделима секция: „===" на самостоятелен ред. Всичко след него до
 * следващия маркер се държи като едно цяло при печат — не се цепи между
 * страници, а ако не се събира, слиза цяло на следващата. Ползва се за
 * контактите с банковата сметка и за подписите, които не бива да се разкъсват.
 */
export const KEEP_SEPARATOR = '==='

export function splitKeepSections(text: string): string[] {
  return text.split(/\n\s*={3,}\s*\n/)
}

/** Шаблонът двуезичен ли е — по съдържание, не по флага в базата (admin го редактира). */
export function isBilingualBody(text: string): boolean {
  return text.split('\n').some(l => l.trim() === LANG_SEPARATOR)
}

/**
 * Двуезичният шаблон → редове на таблица [BG, EN].
 * Ред без разделител заема цялата ширина (връща се само с една страна).
 */
export function parseBilingualRows(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const parts: string[] = []
      let cur: string[] = []
      for (const raw of block.split('\n')) {
        if (raw.trim() === LANG_SEPARATOR) { parts.push(cur.join('\n')); cur = [] }
        else cur.push(raw)
      }
      parts.push(cur.join('\n'))
      return parts
    })
}

/** Блоковете на един език → HTML (заглавия, абзаци, групирани булети). */
function renderBlock(text: string): string {
  const out: string[] = []
  let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    if (line === SPACER) { closeList(); out.push('<p class="spacer"></p>'); continue }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(line.slice(2))}</li>`)
      continue
    }
    closeList()
    if (line.startsWith('### ')) out.push(`<h3>${inline(line.slice(4))}</h3>`)
    else if (line.startsWith('## ')) out.push(`<h2>${inline(line.slice(3))}</h2>`)
    else if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`)
    else out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

/**
 * Маркъп → HTML за преглед и печат.
 *   # заглавие · ## подзаглавие · ### раздел · - булет · останалото = абзац
 *
 * Двуезичните шаблони се рендират като таблица с две равни колони (BG | EN),
 * точно както е в оригиналния Word документ — редовете се разделят с празен
 * ред, а колоните с „@@" на самостоятелен ред.
 */
export function renderContractHtml(text: string): string {
  const sections = splitKeepSections(text)

  if (!isBilingualBody(text)) {
    return sections
      .map((sec, i) => (i === 0 ? renderBlock(sec) : `<div class="keep">\n${renderBlock(sec)}\n</div>`))
      .join('\n')
  }

  const bodies = sections.map((sec, i) => {
    const rows = parseBilingualRows(sec).map(parts => {
      // Ред без разделител (или с празна втора страна) заема цялата ширина.
      if (parts.length < 2) return `<tr><td colspan="2">${renderBlock(parts[0] ?? '')}</td></tr>`
      return `<tr><td>${renderBlock(parts[0])}</td><td>${renderBlock(parts[1])}</td></tr>`
    })
    return `<tbody${i === 0 ? '' : ' class="keep"'}>\n${rows.join('\n')}\n</tbody>`
  })
  return `<table class="bi">\n${bodies.join('\n')}\n</table>`
}
