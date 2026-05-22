// Филтър по размер на хонорара (Абонаменти).
export type AmountBucket = 'all' | 'zero' | 'low' | 'mid' | 'high'

export const BUCKET_LABEL: Record<AmountBucket, string> = {
  all: 'Всички',
  zero: '0 €',
  low: '< 200 €',
  mid: '200-500 €',
  high: '> 500 €',
}

export function inBucket(amount: number | null | undefined, b: AmountBucket): boolean {
  const v = amount ?? 0
  switch (b) {
    case 'all': return true
    case 'zero': return v === 0
    case 'low': return v > 0 && v < 200
    case 'mid': return v >= 200 && v <= 500
    case 'high': return v > 500
  }
}
