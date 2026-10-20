import { describe, it, expect } from 'vitest'
import {
  peopleOptions, matchesPerson, matchesRating, activeFilterCount, EMPTY_FILTER,
} from './profileFilters'

describe('peopleOptions', () => {
  it('дава по едно име на човек, подредени по азбучен ред', () => {
    const r = peopleOptions(['Петър Петров', 'Иван Иванов', 'Петър Петров'])
    expect(r.names).toEqual(['Иван Иванов', 'Петър Петров'])
    expect(r.hasEmpty).toBe(false)
  })

  // Същината: стойността е свободен текст. Двоен интервал или друг регистър
  // не бива да прави втори ред в менюто — иначе всеки показва част от фирмите.
  it('слива различните изписи на едно и също име', () => {
    const r = peopleOptions(['Иван Иванов', 'иван  иванов', ' ИВАН ИВАНОВ '])
    expect(r.names).toHaveLength(1)
  })

  it('показва ПЪРВИЯ срещнат изпис, не изчистен вариант', () => {
    expect(peopleOptions(['ИВАН ИВАНОВ', 'Иван Иванов']).names).toEqual(['ИВАН ИВАНОВ'])
  })

  it('чисти само интервалите по краищата и двойните вътре', () => {
    expect(peopleOptions([' Иван  Иванов ']).names).toEqual(['Иван Иванов'])
  })

  it('отчита празните отделно, вместо да ги слага в менюто', () => {
    const r = peopleOptions(['Иван Иванов', '', null, undefined, '   '])
    expect(r.names).toEqual(['Иван Иванов'])
    expect(r.hasEmpty).toBe(true)
  })

  it('празен вход дава празно меню', () => {
    expect(peopleOptions([])).toEqual({ names: [], hasEmpty: false })
  })
})

describe('matchesPerson', () => {
  it('празен филтър пуска всичко, включително незададените', () => {
    expect(matchesPerson('Иван Иванов', '')).toBe(true)
    expect(matchesPerson('', '')).toBe(true)
  })

  it('сравнява нормализирано, не с ===', () => {
    expect(matchesPerson('иван  иванов', 'Иван Иванов')).toBe(true)
    expect(matchesPerson(' Иван Иванов ', 'Иван Иванов')).toBe(true)
  })

  it('различен човек не минава', () => {
    expect(matchesPerson('Петър Петров', 'Иван Иванов')).toBe(false)
  })

  it('„без" хваща само незададените', () => {
    expect(matchesPerson('', EMPTY_FILTER)).toBe(true)
    expect(matchesPerson('   ', EMPTY_FILTER)).toBe(true)
    expect(matchesPerson(null, EMPTY_FILTER)).toBe(true)
    expect(matchesPerson('Иван Иванов', EMPTY_FILTER)).toBe(false)
  })
})

describe('matchesRating', () => {
  it('празен филтър пуска всичко', () => {
    expect(matchesRating('opt1', '')).toBe(true)
    expect(matchesRating('', '')).toBe(true)
  })

  it('сравнява точно по id на опцията', () => {
    expect(matchesRating('opt1', 'opt1')).toBe(true)
    expect(matchesRating('opt2', 'opt1')).toBe(false)
  })

  it('„без" хваща само неоценените', () => {
    expect(matchesRating('', EMPTY_FILTER)).toBe(true)
    expect(matchesRating('opt1', EMPTY_FILTER)).toBe(false)
  })
})

describe('activeFilterCount', () => {
  const none = { search: '', accountant: '', responsible: '', rating: '' }

  it('брои нула, когато нищо не е зададено', () => {
    expect(activeFilterCount(none)).toBe(0)
  })

  it('търсене само от интервали НЕ се брои', () => {
    expect(activeFilterCount({ ...none, search: '   ' })).toBe(0)
  })

  it('брои всеки активен филтър', () => {
    expect(activeFilterCount({ search: 'омекс', accountant: 'Иван', responsible: '', rating: '' })).toBe(2)
    expect(activeFilterCount({ search: 'x', accountant: 'a', responsible: 'b', rating: 'c' })).toBe(4)
  })

  it('„без" също се брои за активен филтър', () => {
    expect(activeFilterCount({ ...none, rating: EMPTY_FILTER })).toBe(1)
  })
})
