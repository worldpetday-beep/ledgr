import type { Currency, SellUnit, Variant } from '../db'
import { guessUnit } from './unitGuess'

// Every way a variant can be sold, base unit first. A variant with no
// extra sellUnits behaves exactly as it always has -- this never touches
// stored data, it just always treats the variant's own costPrice/
// sellPrice/currency as the implicit first row.
export function sellUnitsOf(variant: Variant, productName: string, category: string): SellUnit[] {
  const base: SellUnit = {
    unit: guessUnit(`${productName} ${variant.label}`, category),
    factor: 1,
    price: variant.sellPrice,
    currency: variant.currency,
  }
  return [base, ...(variant.sellUnits ?? [])]
}

// Profit for one unit of `su`, converted into that unit's own currency so
// it's a fair subtraction (costPrice is always USD, su.price may not be).
export function profitOfUnit(su: SellUnit, costPerBaseUsd: number, rate: number): number {
  const costForUnit = costPerBaseUsd * su.factor
  const costInUnitCurrency = su.currency === 'USD' ? costForUnit : costForUnit * rate
  return su.price - costInUnitCurrency
}

export function marginPctOfUnit(su: SellUnit, costPerBaseUsd: number, rate: number): number {
  const costForUnit = costPerBaseUsd * su.factor
  const costInUnitCurrency = su.currency === 'USD' ? costForUnit : costForUnit * rate
  if (su.price <= 0) return 0
  return ((su.price - costInUnitCurrency) / su.price) * 100
}

// Converts an amount from one currency to another using a single exchange
// rate (LRD per USD).
export function convertAmount(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount
  return from === 'USD' ? amount * rate : amount / rate
}
