import { describe, it, expect } from 'vitest'
import {
  verifySession, readOAuthRedirect, describeOAuthError,
  NO_PROFILE_MESSAGE, DEACTIVATED_MESSAGE,
} from './session'

describe('verifySession', () => {
  it('без сесия е анонимен', () => {
    expect(verifySession(false, null)).toEqual({ status: 'anonymous' })
  })

  it('без сесия не гледа профила изобщо', () => {
    // Кеширан профил в localStorage НЕ е вход.
    expect(verifySession(false, { is_active: true })).toEqual({ status: 'anonymous' })
  })

  it('сесия + активен профил влиза', () => {
    expect(verifySession(true, { is_active: true })).toEqual({ status: 'ok' })
  })

  it('сесия БЕЗ профил се отказва с обяснение', () => {
    // Случаят „колега от 365, на когото никой не е правил акаунт".
    expect(verifySession(true, null)).toEqual({ status: 'denied', reason: NO_PROFILE_MESSAGE })
  })

  it('деактивиран профил се отказва, а не влиза', () => {
    // Регресията, заради която съществува този файл: проверката я имаше
    // само при вход с парола.
    expect(verifySession(true, { is_active: false }))
      .toEqual({ status: 'denied', reason: DEACTIVATED_MESSAGE })
  })

  it('липсващ is_active се брои за активен (стари редове)', () => {
    // Колоната е `not null default true`, но профил без полето в select-а
    // не бива да изхвърля човека.
    expect(verifySession(true, {})).toEqual({ status: 'ok' })
  })
})

describe('readOAuthRedirect', () => {
  it('чист адрес не носи нищо', () => {
    expect(readOAuthRedirect('')).toEqual({ kind: 'none' })
    expect(readOAuthRedirect('?')).toEqual({ kind: 'none' })
  })

  it('не се подвежда от чужди параметри', () => {
    expect(readOAuthRedirect('?month=2026-05')).toEqual({ kind: 'none' })
  })

  it('хваща кода за обмяна', () => {
    expect(readOAuthRedirect('?code=abc123')).toEqual({ kind: 'code', code: 'abc123' })
  })

  it('работи и без водещо „?"', () => {
    expect(readOAuthRedirect('code=abc123')).toEqual({ kind: 'code', code: 'abc123' })
  })

  it('грешката бие кода', () => {
    const r = readOAuthRedirect('?error=access_denied&code=abc')
    expect(r.kind).toBe('error')
  })

  it('превежда реалната грешка от 06.10.2026', () => {
    // Точният адрес, който се получи, докато Azure не върна имейл claim.
    const r = readOAuthRedirect(
      '?error=server_error&error_code=unexpected_failure' +
      '&error_description=Error+getting+user+email+from+external+provider'
    )
    expect(r).toEqual({
      kind: 'error',
      message: 'Microsoft не върна имейл адрес за този акаунт. Обърнете се към администратор.',
    })
  })

  it('отказът на потребителя не е авария', () => {
    const r = readOAuthRedirect('?error=access_denied&error_description=The+user+has+denied+access')
    expect(r).toEqual({ kind: 'error', message: 'Входът с Microsoft беше прекратен.' })
  })
})

describe('describeOAuthError', () => {
  it('непознатата грешка минава както е, за да е диагностицируема', () => {
    expect(describeOAuthError('server_error', 'Something odd happened'))
      .toBe('Входът с Microsoft не стана: Something odd happened')
  })

  it('грешка без описание пак дава смислен текст', () => {
    expect(describeOAuthError('server_error', ''))
      .toBe('Входът с Microsoft не стана. Опитайте пак или влезте с парола.')
  })
})
