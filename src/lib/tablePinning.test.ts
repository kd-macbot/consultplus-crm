import { describe, it, expect } from 'vitest'
import { computePinLayout, lastPinnedId, countActiveFilters, PIN_WIDTH } from './tablePinning'

describe('computePinLayout', () => {
  it('admin: #, отметка и име — отместванията се трупат без застъпване', () => {
    const l = computePinLayout({ canEdit: true, nameColId: 'name', firstVisibleId: 'name' })
    expect(l.left._index).toBe(0)
    expect(l.left._select).toBe(PIN_WIDTH.index)                      // 50
    expect(l.left.name).toBe(PIN_WIDTH.index + PIN_WIDTH.select)      // 90
  })

  it('всяко отместване е точно сборът от ширините преди него', () => {
    const l = computePinLayout({ canEdit: true, nameColId: 'name', firstVisibleId: 'name' })
    const ids = Object.keys(l.left).sort((a, b) => l.left[a] - l.left[b])
    let acc = 0
    for (const id of ids) {
      expect(l.left[id]).toBe(acc)
      acc += l.width[id]
    }
  })

  it('без отметка (служител) името се качва с 40 px наляво', () => {
    const l = computePinLayout({ canEdit: false, nameColId: 'name', firstVisibleId: 'name' })
    expect(l.width._select).toBeUndefined()
    expect(l.left._select).toBeUndefined()
    expect(l.left.name).toBe(PIN_WIDTH.index)   // 50
  })

  it('името НЕ се замразява, ако колегата го е извлачил по средата', () => {
    const l = computePinLayout({ canEdit: true, nameColId: 'name', firstVisibleId: 'status' })
    expect(l.left.name).toBeUndefined()
    expect(Object.keys(l.left)).toEqual(['_index', '_select'])
  })

  it('скрита колона с име → замразяват се само служебните', () => {
    const l = computePinLayout({ canEdit: true, nameColId: null, firstVisibleId: 'status' })
    expect(Object.keys(l.left)).toEqual(['_index', '_select'])
  })
})

describe('lastPinnedId', () => {
  it('най-дясната замразена носи сянката', () => {
    expect(lastPinnedId(computePinLayout({ canEdit: true, nameColId: 'name', firstVisibleId: 'name' }))).toBe('name')
    expect(lastPinnedId(computePinLayout({ canEdit: true, nameColId: 'name', firstVisibleId: 'x' }))).toBe('_select')
    expect(lastPinnedId(computePinLayout({ canEdit: false, nameColId: null, firstVisibleId: 'x' }))).toBe('_index')
  })
})

describe('countActiveFilters', () => {
  const base = { columnFilters: [], globalFilter: '', tagFilter: [] }

  it('нищо вдигнато → 0, тоест бутонът не се показва', () => {
    expect(countActiveFilters(base)).toBe(0)
  })

  it('брои търсенето, колоните и таговете заедно', () => {
    expect(countActiveFilters({
      columnFilters: [{ id: 'status', value: 'Активна' }, { id: 'acc', value: 'Иван' }],
      globalFilter: 'ЕООД',
      tagFilter: ['t1', 't2'],
    })).toBe(5)
  })

  it('само интервали в търсенето НЕ са филтър', () => {
    expect(countActiveFilters({ ...base, globalFilter: '   ' })).toBe(0)
  })

  it('празна стойност на колона не се брои', () => {
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'a', value: '' }] })).toBe(0)
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'a', value: null }] })).toBe(0)
  })

  it('филтърът на „Фирма" е „буква|текст" — само разделителят НЕ е филтър', () => {
    // Изчистване на двете полета оставя „|" и броячът щеше да казва 1,
    // а списъкът да е пълен.
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'name', value: '|' }] })).toBe(0)
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'name', value: 'А|' }] })).toBe(1)
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'name', value: '|ЕООД' }] })).toBe(1)
  })

  it('„(Празно)" Е филтър — стеснява списъка', () => {
    expect(countActiveFilters({ ...base, columnFilters: [{ id: 'a', value: '__empty__' }] })).toBe(1)
  })
})
