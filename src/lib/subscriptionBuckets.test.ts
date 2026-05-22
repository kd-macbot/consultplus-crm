import { describe, it, expect } from 'vitest'
import { inBucket } from './subscriptionBuckets'

describe('inBucket', () => {
  it('all → винаги true', () => {
    expect(inBucket(0, 'all')).toBe(true)
    expect(inBucket(9999, 'all')).toBe(true)
    expect(inBucket(null, 'all')).toBe(true)
  })

  it('zero → само 0 (и null/undefined се броят за 0)', () => {
    expect(inBucket(0, 'zero')).toBe(true)
    expect(inBucket(null, 'zero')).toBe(true)
    expect(inBucket(undefined, 'zero')).toBe(true)
    expect(inBucket(1, 'zero')).toBe(false)
  })

  it('low → (0, 200)', () => {
    expect(inBucket(0, 'low')).toBe(false)
    expect(inBucket(1, 'low')).toBe(true)
    expect(inBucket(199.99, 'low')).toBe(true)
    expect(inBucket(200, 'low')).toBe(false)
  })

  it('mid → [200, 500]', () => {
    expect(inBucket(200, 'mid')).toBe(true)
    expect(inBucket(500, 'mid')).toBe(true)
    expect(inBucket(199.99, 'mid')).toBe(false)
    expect(inBucket(500.01, 'mid')).toBe(false)
  })

  it('high → > 500', () => {
    expect(inBucket(500, 'high')).toBe(false)
    expect(inBucket(500.01, 'high')).toBe(true)
  })

  it('границите не се припокриват (всяка сума пада точно в 1 непразен bucket)', () => {
    const buckets = ['zero', 'low', 'mid', 'high'] as const
    for (const amount of [0, 1, 100, 200, 350, 500, 501, 1000]) {
      const hits = buckets.filter(b => inBucket(amount, b))
      expect(hits).toHaveLength(1)
    }
  })
})
