import { describe, it, expect } from 'vitest'
import { normalize, scoreMatch, rankCommands, isPaletteHotkey, type CommandEntry } from './commandPalette'

const page = (label: string): CommandEntry => ({ id: `p:${label}`, kind: 'page', label })
const client = (label: string): CommandEntry => ({ id: `c:${label}`, kind: 'client', label })

describe('normalize', () => {
  it('маха регистъра и излишните интервали', () => {
    expect(normalize('  Касови   АПАРАТИ ')).toBe('касови апарати')
  })

  it('маха кавичките — колегите ги пишат в имената на фирми', () => {
    expect(normalize('„АВОМИС" ЕООД')).toBe('авомис еоод')
  })
})

describe('scoreMatch', () => {
  it('точното съвпадение бие всичко', () => {
    expect(scoreMatch('Задачи', 'задачи')).toBe(4)
  })

  it('започва с търсеното > дума започва > някъде вътре', () => {
    expect(scoreMatch('Касови апарати', 'кас')).toBe(3)
    expect(scoreMatch('Касови апарати', 'апар')).toBe(2)
    expect(scoreMatch('Личен чек лист', 'ек')).toBe(1)
  })

  it('нула при липса на съвпадение и при празна заявка', () => {
    expect(scoreMatch('Задачи', 'ххх')).toBe(0)
    expect(scoreMatch('Задачи', '   ')).toBe(0)
  })
})

describe('rankCommands', () => {
  it('празна заявка → само страниците (фирмите са 186, биха задръстили)', () => {
    const r = rankCommands([page('Табло'), client('АВОМИС ЕООД')], '')
    expect(r.map(e => e.label)).toEqual(['Табло'])
  })

  it('страницата бие фирмата при равно съвпадение', () => {
    const r = rankCommands([client('Касова фирма'), page('Касови апарати')], 'кас')
    expect(r[0].label).toBe('Касови апарати')
  })

  it('по-доброто съвпадение бие вида — фирма с точно име е първа', () => {
    const r = rankCommands([page('Клиенти'), client('Кли')], 'кли')
    expect(r[0].label).toBe('Кли')
  })

  it('намира фирма по дума в средата на името', () => {
    const r = rankCommands([client('ФЛЕАР ЕВРОПА ООД')], 'европа')
    expect(r).toHaveLength(1)
  })

  it('несъвпадащите изобщо не влизат', () => {
    const r = rankCommands([page('Табло'), client('АВОМИС')], 'ххх')
    expect(r).toEqual([])
  })

  it('спазва тавана на резултатите', () => {
    const many = Array.from({ length: 50 }, (_, i) => client(`Фирма ${i}`))
    expect(rankCommands(many, 'фирма', { limit: 5 })).toHaveLength(5)
  })

  it('при равен резултат подредбата е по азбука (българска)', () => {
    const r = rankCommands([client('Бета ООД'), client('Алфа ООД')], 'о')
    expect(r.map(e => e.label)).toEqual(['Алфа ООД', 'Бета ООД'])
  })
})

describe('isPaletteHotkey', () => {
  it('хваща Ctrl+K и ⌘K при латиница', () => {
    expect(isPaletteHotkey({ ctrlKey: true, key: 'k', code: 'KeyK' })).toBe(true)
    expect(isPaletteHotkey({ metaKey: true, key: 'k', code: 'KeyK' })).toBe(true)
  })

  it('хваща и при БЪЛГАРСКА подредба — key е кирилско „к"', () => {
    expect(isPaletteHotkey({ ctrlKey: true, key: 'к', code: 'KeyK' })).toBe(true)
  })

  it('хваща по физическия клавиш дори при непозната подредба', () => {
    expect(isPaletteHotkey({ ctrlKey: true, key: 'ك', code: 'KeyK' })).toBe(true)
  })

  it('хваща по key, ако клавиатурата не праща code', () => {
    expect(isPaletteHotkey({ ctrlKey: true, key: 'К' })).toBe(true)
  })

  it('без Ctrl/Cmd не е шорткът — иначе всяко „к" би отваряло търсенето', () => {
    expect(isPaletteHotkey({ key: 'k', code: 'KeyK' })).toBe(false)
  })

  it('Ctrl+Alt+K е друга комбинация', () => {
    expect(isPaletteHotkey({ ctrlKey: true, altKey: true, key: 'k', code: 'KeyK' })).toBe(false)
  })

  it('друг клавиш с Ctrl не пипа', () => {
    expect(isPaletteHotkey({ ctrlKey: true, key: 'p', code: 'KeyP' })).toBe(false)
  })
})
