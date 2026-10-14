import { describe, it, expect } from 'vitest'
import { resolveBuildId, looksUnexpanded } from './buildId'

describe('looksUnexpanded', () => {
  it('разпознава незаместен шаблон', () => {
    expect(looksUnexpanded('${CF_PAGES_COMMIT_SHA}')).toBe(true)
  })
  it('истинският SHA минава', () => {
    expect(looksUnexpanded('5f476499fc24b37c4557d18d0e8cbdd515d2e311')).toBe(false)
  })
})

describe('resolveBuildId', () => {
  it('взима CF_PAGES_COMMIT_SHA, когато Cloudflare го подаде', () => {
    expect(resolveBuildId({ CF_PAGES_COMMIT_SHA: 'abc123' })).toBe('abc123')
  })

  it('ръчната стойност бие автоматичната', () => {
    expect(resolveBuildId({ VITE_BUILD_ID: 'ръчен', CF_PAGES_COMMIT_SHA: 'abc123' }))
      .toBe('ръчен')
  })

  it('НЕЗАМЕСТЕН шаблон се прескача — това е истинският капан', () => {
    // Точно случаят от 14.10.2026: в панела на Cloudflare е въведено
    // „${CF_PAGES_COMMIT_SHA}", а то не се разширява и влиза буквално.
    expect(resolveBuildId({
      VITE_BUILD_ID: '${CF_PAGES_COMMIT_SHA}',
      CF_PAGES_COMMIT_SHA: 'abc123',
    })).toBe('abc123')
  })

  it('незаместен и без резерва пада до dev, не до низа', () => {
    expect(resolveBuildId({ VITE_BUILD_ID: '${CF_PAGES_COMMIT_SHA}' })).toBe('dev')
  })

  it('празно и само интервали се прескачат', () => {
    expect(resolveBuildId({ VITE_BUILD_ID: '', CF_PAGES_COMMIT_SHA: 'abc' })).toBe('abc')
    expect(resolveBuildId({ VITE_BUILD_ID: '   ', CF_PAGES_COMMIT_SHA: 'abc' })).toBe('abc')
  })

  it('празна среда дава dev', () => {
    expect(resolveBuildId({})).toBe('dev')
  })

  it('маха празните знаци в краищата', () => {
    expect(resolveBuildId({ CF_PAGES_COMMIT_SHA: '  abc123\n' })).toBe('abc123')
  })
})
