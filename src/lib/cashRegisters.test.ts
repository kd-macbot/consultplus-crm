import { describe, it, expect } from 'vitest'
import { annualTurnover } from './cashRegisters'
import type { CashRegisterTurnover } from './types'

function t(p: Partial<CashRegisterTurnover>): CashRegisterTurnover {
  return {
    id: 'x', register_id: 'r', year: 2026, month: 1,
    turnover_20: 0, storno_20: 0, turnover_9: 0, storno_9: 0,
    invoices_cash_20: 0, invoices_cash_9: 0,
    credit_note_20: 0, credit_note_9: 0,
    other_fiscal_20: 0, other_fiscal_9: 0,
    updated_at: '', ...p,
  }
}

describe('annualTurnover', () => {
  it('празна година → нули', () => {
    expect(annualTurnover([])).toEqual({ ka: 0, storno: 0, ko: 0 })
  })

  it('липсващите месеци се пропускат, не чупят сбора', () => {
    const r = annualTurnover([undefined, t({ turnover_20: 100 }), undefined])
    expect(r).toEqual({ ka: 100, storno: 0, ko: 100 })
  })

  it('20% и 9% се СЪБИРАТ — справката е за оборота, не за ДДС', () => {
    const r = annualTurnover([t({ turnover_20: 100, turnover_9: 25, storno_20: 10, storno_9: 5 })])
    expect(r.ka).toBe(125)
    expect(r.storno).toBe(15)
  })

  it('КО = КА − СТОРНО през всички месеци', () => {
    const r = annualTurnover([
      t({ turnover_20: 1000, storno_20: 100 }),
      t({ turnover_9: 500, storno_9: 50 }),
      t({ turnover_20: 200, turnover_9: 300, storno_20: 20 }),
    ])
    expect(r.ka).toBe(2000)
    expect(r.storno).toBe(170)
    expect(r.ko).toBe(1830)
  })

  it('сторно над оборота дава отрицателно КО — не се крие', () => {
    const r = annualTurnover([t({ turnover_20: 50, storno_20: 80 })])
    expect(r.ko).toBe(-30)
  })
})
