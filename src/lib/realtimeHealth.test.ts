import { describe, it, expect, beforeEach } from 'vitest'
import { setRealtimeHealthy, __store } from './realtimeHealth'

// Дългият staleTime на мастър заявките важи САМО докато абонаментът е жив.
// Ако този превключвател се счупи, колега би гледал стари данни половин час,
// без да подозира — затова е покрит.
describe('realtimeHealth', () => {
  beforeEach(() => setRealtimeHealthy(false))

  it('стартира като НЕпотвърден — до доказано обратното кешът е кратък', () => {
    expect(__store.get()).toBe(false)
  })

  it('SUBSCRIBED вдига, падането сваля', () => {
    setRealtimeHealthy(true)
    expect(__store.get()).toBe(true)
    setRealtimeHealthy(false)
    expect(__store.get()).toBe(false)
  })

  it('известява абонатите при промяна', () => {
    let calls = 0
    const off = __store.subscribe(() => { calls++ })
    setRealtimeHealthy(true)
    expect(calls).toBe(1)
    off()
    setRealtimeHealthy(false)
    expect(calls).toBe(1)   // след отписване вече не известява
  })

  it('НЕ известява при същата стойност — иначе всяко биене на сърцето би пререндирало', () => {
    let calls = 0
    const off = __store.subscribe(() => { calls++ })
    setRealtimeHealthy(true)
    setRealtimeHealthy(true)
    setRealtimeHealthy(true)
    expect(calls).toBe(1)
    off()
  })
})
