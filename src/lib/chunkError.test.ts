import { describe, it, expect } from 'vitest'
import { isChunkLoadError } from './chunkError'

describe('isChunkLoadError', () => {
  it('познава съобщението на Chrome — точно това дойде в Sentry', () => {
    expect(isChunkLoadError(new Error(
      'Failed to fetch dynamically imported module: https://cplus360.com/assets/WorkSheet-B_cxqKVn.js',
    ))).toBe(true)
  })

  it('познава Firefox и Safari', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
  })

  it('познава провален стил на Vite', () => {
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/Clients-abc.css'))).toBe(true)
  })

  it('не се води по главни и малки букви', () => {
    expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: /x.js'))).toBe(true)
  })

  // Това е същината: обикновената мрежова грешка НЕ бива да води до
  // презареждане — иначе лоша мрежа върти таба на колегата в кръг.
  it('ОТКАЗВА обикновено „Failed to fetch"', () => {
    expect(isChunkLoadError(new Error('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(new Error('TypeError: NetworkError when attempting to fetch resource.'))).toBe(false)
  })

  it('отказва грешки на приложението', () => {
    expect(isChunkLoadError(new Error('Записът виси (15000 ms)'))).toBe(false)
    expect(isChunkLoadError(new Error('JWT expired'))).toBe(false)
  })

  it('преживява всякаква форма на входа', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
    expect(isChunkLoadError({ message: 42 })).toBe(false)
    expect(isChunkLoadError(new Error(''))).toBe(false)
  })

  it('приема и чист низ, и обект със съобщение', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /a.js')).toBe(true)
    expect(isChunkLoadError({ message: 'error loading dynamically imported module' })).toBe(true)
  })
})
