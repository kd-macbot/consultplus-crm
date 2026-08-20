import { describe, it, expect } from 'vitest'
import { redact } from './monitoring'

// Стектрейсът може да носи лични данни — съобщение от Postgres спокойно връща
// стойността на реда, счупил constraint. Тези тестове пазят именно това.
describe('redact', () => {
  it('маха ЕГН', () => {
    expect(redact('duplicate key (egn)=(8501014567)')).toBe('duplicate key (egn)=([ЕГН])')
  })

  it('НЕ пипа ЕИК — публичен е и е нужен за разследване', () => {
    expect(redact('ЕИК 205123456')).toBe('ЕИК 205123456')          // 9 цифри
    expect(redact('ЕИК 2051234567890')).toBe('ЕИК 2051234567890')  // 13 цифри
  })

  it('маха телефони в българските формати', () => {
    expect(redact('тел. +359 888 123 456')).toBe('тел. [телефон]')
    expect(redact('тел. 0888123456')).toBe('тел. [телефон]')
    expect(redact('обади се на 0888 123 456 днес')).toBe('обади се на [телефон] днес')
  })

  it('различава ЕГН от слят телефон по месеца', () => {
    // 3-4 позиция „01" е месец → ЕГН
    expect(redact('8501014567')).toBe('[ЕГН]')
    // „41" е месец за родените след 2000 → пак ЕГН, макар да почва с 08
    expect(redact('0841014567')).toBe('[ЕГН]')
    // „88" не е месец → телефон
    expect(redact('0888123456')).toBe('[телефон]')
  })

  it('маха имейли', () => {
    expect(redact('failed for ivan.petrov@firma.bg')).toBe('failed for [имейл]')
  })

  it('маха IBAN', () => {
    expect(redact('сметка BG80BNBG96611020345678')).toBe('сметка [IBAN]')
  })

  it('оставя техническата част четима', () => {
    const msg = 'TypeError: Cannot read properties of undefined (reading "value_text")'
    expect(redact(msg)).toBe(msg)
  })

  it('чисти няколко неща в едно съобщение', () => {
    const out = redact('клиент 8501014567, тел 0888123456, мейл a@b.bg')
    expect(out).not.toMatch(/8501014567|0888123456|a@b\.bg/)
    expect(out).toContain('[ЕГН]')
    expect(out).toContain('[телефон]')
    expect(out).toContain('[имейл]')
  })

  it('не чупи празен низ', () => {
    expect(redact('')).toBe('')
  })
})
