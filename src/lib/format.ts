import type { FocusEvent } from 'react'
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

const MONROVIA_TZ = 'Africa/Monrovia'

// Liberia is UTC+0 year-round (no DST) — format in that timezone regardless
// of the device's own timezone so records stay consistent across devices.
export function formatTimeMonrovia(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { timeZone: MONROVIA_TZ, hour: 'numeric', minute: '2-digit' })
}

export function formatDateTimeMonrovia(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: MONROVIA_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Selects the input's full value on focus so the first keystroke replaces a
// pre-filled default (e.g. "1" or "0") instead of appending to it. Deferred
// one tick because a mouse click's own caret placement happens right after
// the focus event and would otherwise collapse the selection immediately.
export function selectOnFocus(e: FocusEvent<HTMLInputElement>): void {
  const el = e.target
  setTimeout(() => el.select(), 0)
}
