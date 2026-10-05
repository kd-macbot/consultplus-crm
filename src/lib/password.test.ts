import { describe, it, expect } from 'vitest'
import {
  generatePassword, hasConfusingChars, isAcceptablePassword,
  PASSWORD_ALPHABET, DEFAULT_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH,
} from './password'

describe('generatePassword', () => {
  it('дава поисканата дължина', () => {
    expect(generatePassword()).toHaveLength(DEFAULT_PASSWORD_LENGTH)
    expect(generatePassword(20)).toHaveLength(20)
  })

  it('не слиза под 8 знака, колкото и да се иска', () => {
    expect(generatePassword(3).length).toBeGreaterThanOrEqual(8)
    expect(generatePassword(0).length).toBeGreaterThanOrEqual(8)
  })

  it('НЯМА знаци, които се бъркат при преписване (0 O 1 l I 5 S 2 Z 8 B)', () => {
    // Паролата се чете на глас или се преписва — една сбъркана буква
    // значи втори разговор.
    for (let i = 0; i < 300; i++) {
      expect(hasConfusingChars(generatePassword())).toBe(false)
    }
  })

  it('всеки знак е от разрешената азбука', () => {
    for (let i = 0; i < 100; i++) {
      for (const ch of generatePassword()) {
        expect(PASSWORD_ALPHABET).toContain(ch)
      }
    }
  })

  it('винаги има главна, малка, цифра и знак', () => {
    // Иначе на всеки N-ти път излиза парола само от букви.
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword()
      expect(/[A-Z]/.test(pw)).toBe(true)
      expect(/[a-z]/.test(pw)).toBe(true)
      expect(/[0-9]/.test(pw)).toBe(true)
      expect(/[!@#$%*\-+=]/.test(pw)).toBe(true)
    }
  })

  it('задължителните знаци НЕ стоят винаги в началото', () => {
    // Без разбъркване първите четири са главна, малка, цифра, знак —
    // тоест мястото на символа би било предвидимо.
    const firstIsSymbol = Array.from({ length: 200 }, () => generatePassword())
      .filter(pw => /[!@#$%*\-+=]/.test(pw[0])).length
    expect(firstIsSymbol).toBeGreaterThan(0)
  })

  it('две поредни пароли не съвпадат', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()))
    expect(seen.size).toBe(200)
  })
})

describe('isAcceptablePassword', () => {
  it('под минимума не минава — същата граница като в edge функцията', () => {
    expect(isAcceptablePassword('abc')).toBe(false)
    expect(isAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true)
    expect(isAcceptablePassword('')).toBe(false)
  })

  it('генерираната винаги минава', () => {
    expect(isAcceptablePassword(generatePassword())).toBe(true)
  })
})
