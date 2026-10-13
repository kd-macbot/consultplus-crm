import { describe, it, expect } from 'vitest'
import { makeDraftStore, type SimpleStorage } from './formDraft'

function fakeStorage(initial: Record<string, string> = {}): SimpleStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v },
    removeItem: (k) => { delete data[k] },
  }
}

type Draft = { title: string; body: string; pinned: boolean }
const filled = (d: Partial<Draft>) => !!(d.title?.trim() || d.body?.trim())

describe('makeDraftStore', () => {
  it('записва и чете', () => {
    const s = fakeStorage()
    const store = makeDraftStore<Draft>('k', filled, s)
    store.write({ title: 'Нова задача', body: '', pinned: false })
    expect(store.read()).toEqual({ title: 'Нова задача', body: '', pinned: false })
  })

  it('празен storage връща null, не хвърля', () => {
    const store = makeDraftStore<Draft>('k', filled, fakeStorage())
    expect(store.read()).toBeNull()
    expect(store.hasContent()).toBe(false)
  })

  it('clear маха черновата', () => {
    const s = fakeStorage()
    const store = makeDraftStore<Draft>('k', filled, s)
    store.write({ title: 'нещо', body: '', pinned: false })
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('hasContent различава писано от непипнато', () => {
    const s = fakeStorage()
    const store = makeDraftStore<Draft>('k', filled, s)
    // Отворен и затворен модал без да е писано — НЕ бива да се отваря пак.
    store.write({ title: '', body: '', pinned: false })
    expect(store.hasContent()).toBe(false)
    store.write({ title: 'Проверка НАП', body: '', pinned: false })
    expect(store.hasContent()).toBe(true)
  })

  it('само интервали не са съдържание', () => {
    const s = fakeStorage()
    const store = makeDraftStore<Draft>('k', filled, s)
    store.write({ title: '   ', body: '\n ', pinned: false })
    expect(store.hasContent()).toBe(false)
  })

  it('повреден JSON не чупи формата', () => {
    const store = makeDraftStore<Draft>('k', filled, fakeStorage({ k: '{счупено' }))
    expect(store.read()).toBeNull()
    expect(store.hasContent()).toBe(false)
  })

  it('чужд запис под същия ключ се игнорира', () => {
    // Масив или скалар под ключа — не е нашата чернова.
    expect(makeDraftStore<Draft>('k', filled, fakeStorage({ k: '[1,2]' })).read()).toBeNull()
    expect(makeDraftStore<Draft>('k', filled, fakeStorage({ k: '"низ"' })).read()).toBeNull()
    expect(makeDraftStore<Draft>('k', filled, fakeStorage({ k: 'null' })).read()).toBeNull()
  })

  it('липсващ storage не чупи нищо', () => {
    // Частен прозорец / блокиран storage.
    const store = makeDraftStore<Draft>('k', filled, null)
    expect(() => store.write({ title: 'a', body: '', pinned: false })).not.toThrow()
    expect(store.read()).toBeNull()
    expect(store.hasContent()).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })

  it('storage, който хвърля при запис, не чупи формата', () => {
    const throwing: SimpleStorage = {
      getItem: () => { throw new Error('блокиран') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('блокиран') },
    }
    const store = makeDraftStore<Draft>('k', filled, throwing)
    expect(() => store.write({ title: 'a', body: '', pinned: false })).not.toThrow()
    expect(store.read()).toBeNull()
    expect(() => store.clear()).not.toThrow()
  })

  it('isFilled, който хвърля, се брои за празно', () => {
    const s = fakeStorage()
    const store = makeDraftStore<Draft>('k', (d) => { throw new Error(String(d)) }, s)
    store.write({ title: 'a', body: '', pinned: false })
    expect(store.hasContent()).toBe(false)
  })

  it('два ключа не се смесват', () => {
    const s = fakeStorage()
    const a = makeDraftStore<Draft>('task', filled, s)
    const b = makeDraftStore<Draft>('news', filled, s)
    a.write({ title: 'задача', body: '', pinned: false })
    b.write({ title: 'новина', body: '', pinned: false })
    expect(a.read()?.title).toBe('задача')
    expect(b.read()?.title).toBe('новина')
    a.clear()
    expect(b.read()?.title).toBe('новина')
  })
})
