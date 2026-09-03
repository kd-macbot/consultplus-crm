import { describe, it, expect } from 'vitest'
import { credentialKey, groupSharedLogins, sameLoginOthers } from './bankAccess'
import type { BankAccess } from './types'

function row(p: Partial<BankAccess> & { client_id: string }): BankAccess {
  return {
    bank: null, url: null, username: null, password: null, app_code: null,
    access_type: 'shared', has_2fa: false, we_pay: false, notes: null,
    updated_at: '', updated_by: null, ...p,
  }
}

describe('credentialKey', () => {
  it('без потребител няма ключ — входът не се идентифицира', () => {
    expect(credentialKey('ДСК', null)).toBeNull()
    expect(credentialKey('ДСК', '   ')).toBeNull()
  })

  it('регистърът и празните знаци не правят два входа от един', () => {
    expect(credentialKey('ДСК', ' KonsultPlus ')).toBe(credentialKey('дск', 'konsultplus'))
  })

  it('един потребител в РАЗЛИЧНИ банки са различни входове', () => {
    expect(credentialKey('ДСК', 'konsult')).not.toBe(credentialKey('ОББ', 'konsult'))
  })
})

describe('groupSharedLogins', () => {
  it('единичните редове не са група', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ДСК', username: 'ivan' }),
      row({ client_id: 'b', bank: 'ОББ', username: 'petar' }),
    ])
    expect(g).toEqual([])
  })

  it('събира фирмите с един и същ вход', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ДСК', username: 'konsult', password: 'x' }),
      row({ client_id: 'b', bank: 'ДСК', username: 'KONSULT', password: 'x' }),
      row({ client_id: 'c', bank: 'ДСК', username: 'konsult ', password: 'x' }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].clientIds.sort()).toEqual(['a', 'b', 'c'])
    expect(g[0].distinctPasswords).toBe(1)
  })

  it('различните пароли в групата се броят — това е разминаването', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ДСК', username: 'konsult', password: 'нова' }),
      row({ client_id: 'b', bank: 'ДСК', username: 'konsult', password: 'стара' }),
    ])
    expect(g[0].distinctPasswords).toBe(2)
  })

  it('липсващата парола също е разминаване, не се пропуска', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ДСК', username: 'konsult', password: 'x' }),
      row({ client_id: 'b', bank: 'ДСК', username: 'konsult', password: null }),
    ])
    expect(g[0].distinctPasswords).toBe(2)
  })

  it('редовете без потребител се пропускат, колкото и да са', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ДСК' }),
      row({ client_id: 'b', bank: 'ДСК' }),
    ])
    expect(g).toEqual([])
  })

  it('подредба по брой фирми, низходящо', () => {
    const g = groupSharedLogins([
      row({ client_id: 'a', bank: 'ОББ', username: 'two' }),
      row({ client_id: 'b', bank: 'ОББ', username: 'two' }),
      row({ client_id: 'c', bank: 'ДСК', username: 'three' }),
      row({ client_id: 'd', bank: 'ДСК', username: 'three' }),
      row({ client_id: 'e', bank: 'ДСК', username: 'three' }),
    ])
    expect(g.map(x => x.clientIds.length)).toEqual([3, 2])
  })
})

describe('sameLoginOthers', () => {
  const rows = [
    row({ client_id: 'a', bank: 'ДСК', username: 'konsult' }),
    row({ client_id: 'b', bank: 'ДСК', username: 'konsult' }),
    row({ client_id: 'c', bank: 'ДСК', username: 'друг' }),
  ]

  it('връща другите фирми със същия вход, без самата редактирана', () => {
    expect(sameLoginOthers(rows, 'a', 'ДСК', 'konsult')).toEqual(['b'])
  })

  it('празен списък при уникален вход', () => {
    expect(sameLoginOthers(rows, 'c', 'ДСК', 'друг')).toEqual([])
  })

  it('без потребител не се сменя нищо чуждо', () => {
    expect(sameLoginOthers(rows, 'a', 'ДСК', '')).toEqual([])
  })
})
