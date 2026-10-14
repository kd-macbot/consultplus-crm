import { describe, it, expect } from 'vitest'
import { requestStarted, requestFinished, connectionSnapshot } from './connectionClock'

// Модулно състояние — тестовете се пишат така, че да не си пречат
// (всеки връща брояча там, където го е заварил).
describe('connectionClock', () => {
  it('брои заявките в полет', () => {
    const before = connectionSnapshot().inFlight
    requestStarted()
    requestStarted()
    expect(connectionSnapshot().inFlight).toBe(before + 2)
    requestFinished(true)
    requestFinished(true)
    expect(connectionSnapshot().inFlight).toBe(before)
  })

  it('броячът НЕ пада под нула', () => {
    // Защита срещу разминаване при отменена заявка — отрицателен брояч
    // щеше да скрие следващото задръстване.
    for (let i = 0; i < 5; i++) requestFinished(false)
    expect(connectionSnapshot().inFlight).toBeGreaterThanOrEqual(0)
  })

  it('ОТГОВОР от сървъра нулира часовника, провалът — не', () => {
    requestStarted()
    requestFinished(true)
    expect(connectionSnapshot().sinceLastOkMs).toBeLessThan(1000)

    const afterOk = connectionSnapshot().sinceLastOkMs
    requestStarted()
    requestFinished(false)
    // Провалът не бива да изглежда като „връзката работи".
    expect(connectionSnapshot().sinceLastOkMs).toBeGreaterThanOrEqual(afterOk)
  })

  it('дава пълния набор полета, без да хвърля без DOM', () => {
    const snap = connectionSnapshot()
    expect(Object.keys(snap).sort()).toEqual([
      'hiddenNow', 'inFlight', 'lastHiddenMs', 'online', 'pageAgeMs', 'sinceLastOkMs',
    ])
    expect(snap.pageAgeMs).toBeGreaterThanOrEqual(0)
  })
})
