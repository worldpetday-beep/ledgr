import type { Currency, Sale } from '../db'

export interface PriceStats {
  avg: number
  min: number
  max: number
  count: number
}

// Per-unit price actually charged across every non-voided sale of this
// variant recorded under this exact unit and currency -- mixing in a
// different unit or currency would average together numbers that aren't
// comparable (a bundle price and a sheet price, or an old LRD rate against
// today's). `sales` should already be voided-filtered by the caller.
export function priceStatsFor(sales: Sale[], variantId: number, unitType: string, currency: Currency): PriceStats {
  const perUnitPrices: number[] = []
  for (const s of sales) {
    if (s.variantId !== variantId) continue
    if ((s.unitType ?? '') !== unitType) continue
    if (s.currency !== currency) continue
    if (s.qty <= 0) continue
    perUnitPrices.push(s.soldFor / s.qty)
  }
  if (perUnitPrices.length === 0) return { avg: 0, min: 0, max: 0, count: 0 }
  const sum = perUnitPrices.reduce((a, b) => a + b, 0)
  return {
    avg: sum / perUnitPrices.length,
    min: Math.min(...perUnitPrices),
    max: Math.max(...perUnitPrices),
    count: perUnitPrices.length,
  }
}
