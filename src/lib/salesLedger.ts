import type { Sale } from '../db'

// A single sale line can carry a primary currency+amount and, for a
// split-currency payment, a secondary currency+amount. These pull out
// "how much of this line was in USD / LRD" regardless of which one was
// primary, for the daybook's two fixed currency columns.
export function lrdAmountOf(sale: Sale): number {
  if (sale.currency === 'LRD') return sale.soldFor
  if (sale.secondaryCurrency === 'LRD') return sale.secondaryAmount ?? 0
  return 0
}

export function usdAmountOf(sale: Sale): number {
  if (sale.currency === 'USD') return sale.soldFor
  if (sale.secondaryCurrency === 'USD') return sale.secondaryAmount ?? 0
  return 0
}

export function customerLabelOf(sale: Pick<Sale, 'customerNumber' | 'customerName'>): string {
  return sale.customerName || `Customer ${String(sale.customerNumber).padStart(3, '0')}`
}
