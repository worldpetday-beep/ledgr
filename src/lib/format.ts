import type { Currency } from '../db'

const SYMBOLS: Record<Currency, string> = { USD: '$', LRD: 'L$' }

export function money(amount: number, currency: Currency): string {
  const symbol = SYMBOLS[currency]
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function isLowStock(stock: number, threshold: number): boolean {
  return stock <= threshold
}
