import {
  db,
  releaseOrderNumberIfLatest,
  reserveNextOrderNumber,
  type Currency,
  type FulfillmentLocation,
  type Product,
  type Sale,
  type Variant,
} from '../db'

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

// A single blended USD figure for one sale line, for aggregates (total
// revenue, best-sellers, profit) that need one number to sum across a mix
// of USD- and LRD-priced sales -- adding a $10 line and an L$4000 line
// together as raw numbers ("4010") is meaningless; this converts the LRD
// portion at the rate actually in effect when it was recorded first.
export function saleValueUsd(sale: Sale, currentRate: number): number {
  const rate = sale.rateAtSale ?? currentRate
  return usdAmountOf(sale) + lrdAmountOf(sale) / rate
}

// costAtSale is always USD (see Variant.costPrice) regardless of what
// currency the sale itself was priced in, so profit is just the blended
// USD sale value minus that -- no separate conversion needed on the cost
// side.
export function saleProfitUsd(sale: Sale, currentRate: number): number {
  return saleValueUsd(sale, currentRate) - sale.costAtSale
}

// Missing paidAmount (every sale recorded before this field existed) reads
// as "fully paid" -- that was the implicit assumption the whole app made
// before balances were tracked at all, so it stays true for old records.
export function owingOf(sale: Sale): number {
  const paid = sale.paidAmount ?? sale.soldFor
  return Math.max(0, sale.soldFor - paid)
}

export function owingUsd(sale: Sale, currentRate: number): number {
  const rate = sale.rateAtSale ?? currentRate
  const owed = owingOf(sale)
  return sale.currency === 'USD' ? owed : owed / rate
}

// How much of this line's *own* currency was actually collected (not just
// agreed) -- a split-currency line's secondary half is treated as always
// collected (both halves get handed over at the register in the same
// motion), only the primary side can be partially paid via paidAmount.
// Used for a cash drawer's "money that actually came in" figure, which is
// a different question from "value of goods sold" (usdAmountOf/
// lrdAmountOf) whenever a sale was left with a balance owing.
export function paidUsdAmountOf(sale: Sale): number {
  const paidPrimary = sale.paidAmount ?? sale.soldFor
  if (sale.currency === 'USD') return paidPrimary
  if (sale.secondaryCurrency === 'USD') return sale.secondaryAmount ?? 0
  return 0
}
export function paidLrdAmountOf(sale: Sale): number {
  const paidPrimary = sale.paidAmount ?? sale.soldFor
  if (sale.currency === 'LRD') return paidPrimary
  if (sale.secondaryCurrency === 'LRD') return sale.secondaryAmount ?? 0
  return 0
}

// Applies a payment (in the order's currency) against an order's still-open
// balance, oldest line first, capping each line's paidAmount at its own
// soldFor -- soldFor itself is never touched, so this never re-totals a
// sale, it only records that more of it has now actually been collected.
//
// Also writes a brand-new, separately-dated "payoff" line for the payment
// itself (today, not whatever day the original goods went out), fully
// paid, no product attached. It's what actually shows up as its own card
// in Book, distinctly colored -- and it counts as cash collected but
// never as goods sold, since the goods were already counted sold on the
// day they left.
export async function collectPayment(
  order: { lines: Sale[]; currency: Currency; customerNumber: number },
  amount: number,
  currentRate: number,
): Promise<void> {
  let remaining = amount
  await db.transaction('rw', db.sales, db.settings, async () => {
    for (const l of order.lines) {
      if (remaining <= 0) break
      const owed = owingOf(l)
      if (owed <= 0) continue
      const applied = Math.min(owed, remaining)
      remaining -= applied
      await db.sales.update(l.id!, { paidAmount: (l.paidAmount ?? l.soldFor) + applied })
    }

    const orderNumber = await reserveNextOrderNumber()
    await db.sales.add({
      itemName: 'Balance payment',
      qty: 1,
      soldFor: amount,
      paidAmount: amount,
      costAtSale: 0,
      currency: order.currency,
      rateAtSale: currentRate,
      timestamp: Date.now(),
      customerNumber: order.customerNumber,
      orderNumber,
      location: 'myShop',
      tbs: false,
      pickedUp: true,
      isPayoff: true,
    })
  })
}

export function customerLabelOf(sale: Pick<Sale, 'customerNumber' | 'customerName'>): string {
  return sale.customerName || `Customer ${String(sale.customerNumber).padStart(3, '0')}`
}

// Every list/total across the app reads through this instead of raw
// db.sales.toArray() results, so a voided line never has to be individually
// excluded at each call site.
export function withoutVoided(sales: Sale[]): Sale[] {
  return sales.filter((s) => !s.voidedAt)
}

// "Removes" a sale line without ever erasing it: stock is restored exactly
// like a real delete would, the order number is recycled the same way, but
// the row itself is only stamped voidedAt, not dropped from the table --
// the full history stays intact and recoverable, it's just filtered out of
// every normal view via withoutVoided().
export async function deleteSaleLine(sale: Sale): Promise<void> {
  await db.transaction('rw', db.sales, db.variants, async () => {
    await db.sales.update(sale.id!, { voidedAt: Date.now() })
    const stockWasDeducted = !sale.tbs || sale.pickedUp
    if (stockWasDeducted && sale.variantId) {
      const variant = await db.variants.get(sale.variantId)
      if (variant) {
        const updated =
          sale.location === 'vishalShop'
            ? { stockVishalShop: variant.stockVishalShop + sale.qty }
            : { stockMyShop: variant.stockMyShop + sale.qty }
        await db.variants.update(sale.variantId, { ...updated, updatedAt: Date.now() })
      }
    }
  })
  await releaseOrderNumberIfLatest(sale.orderNumber)
}

export async function markSalePickedUp(sale: Sale): Promise<void> {
  await db.transaction('rw', db.sales, db.variants, async () => {
    await db.sales.update(sale.id!, { pickedUp: true })
    if (sale.variantId) {
      const variant = await db.variants.get(sale.variantId)
      if (variant) {
        const updated =
          sale.location === 'vishalShop'
            ? { stockVishalShop: Math.max(0, variant.stockVishalShop - sale.qty) }
            : { stockMyShop: Math.max(0, variant.stockMyShop - sale.qty) }
        await db.variants.update(sale.variantId, { ...updated, updatedAt: Date.now() })
      }
    }
  })
}

export interface SaleEditPatch {
  qty: number
  unitType: string
  usdAmount: number
  lrdAmount: number
  location: FulfillmentLocation
  itemName?: string
  costAtSale?: number
}

// Edits an already-recorded sale line's qty/unit/price/location. Stock is
// reconciled by first restoring whatever the original line deducted, then
// deducting the new qty from the (possibly different) new location, so this
// is correct whether qty, location, both, or neither actually changed.
export async function editSaleLine(sale: Sale, patch: SaleEditPatch): Promise<void> {
  const primaryCurrency: Currency = patch.usdAmount > 0 ? 'USD' : 'LRD'
  const primaryAmount = primaryCurrency === 'USD' ? patch.usdAmount : patch.lrdAmount
  const hasSecondary = patch.usdAmount > 0 && patch.lrdAmount > 0

  await db.transaction('rw', db.sales, db.variants, async () => {
    const stockAffected = !sale.tbs || sale.pickedUp
    if (stockAffected && sale.variantId) {
      const variant = await db.variants.get(sale.variantId)
      if (variant) {
        const restored =
          sale.location === 'vishalShop'
            ? { stockVishalShop: variant.stockVishalShop + sale.qty }
            : { stockMyShop: variant.stockMyShop + sale.qty }
        await db.variants.update(sale.variantId, { ...restored, updatedAt: Date.now() })

        const afterRestore = await db.variants.get(sale.variantId)
        if (afterRestore) {
          const deducted =
            patch.location === 'vishalShop'
              ? { stockVishalShop: Math.max(0, afterRestore.stockVishalShop - patch.qty) }
              : { stockMyShop: Math.max(0, afterRestore.stockMyShop - patch.qty) }
          await db.variants.update(sale.variantId, { ...deducted, updatedAt: Date.now() })
        }
      }
    }

    await db.sales.update(sale.id!, {
      qty: patch.qty,
      unitType: patch.unitType,
      soldFor: primaryAmount,
      currency: primaryCurrency,
      secondaryAmount: hasSecondary ? patch.lrdAmount : undefined,
      secondaryCurrency: hasSecondary ? 'LRD' : undefined,
      location: patch.location,
      ...(patch.itemName !== undefined ? { itemName: patch.itemName } : {}),
      ...(patch.costAtSale !== undefined ? { costAtSale: patch.costAtSale } : {}),
    })
  })
}

// Re-points an already-recorded sale line at a different product/variant --
// "products to prices and all" reeditability, not just the free-text name.
// Whatever stock the original line deducted is restored to the OLD variant
// first, then the same qty is deducted from the NEW variant, so inventory
// stays correct no matter how far off the original match was. costAtSale is
// refreshed from the new variant's current cost price (qty-scaled) since the
// line now genuinely represents a different item.
export async function relinkSaleLine(sale: Sale, product: Product, variant: Variant | null): Promise<void> {
  await db.transaction('rw', db.sales, db.variants, async () => {
    const stockAffected = !sale.tbs || sale.pickedUp
    if (stockAffected && sale.variantId) {
      const oldVariant = await db.variants.get(sale.variantId)
      if (oldVariant) {
        const restored =
          sale.location === 'vishalShop'
            ? { stockVishalShop: oldVariant.stockVishalShop + sale.qty }
            : { stockMyShop: oldVariant.stockMyShop + sale.qty }
        await db.variants.update(sale.variantId, { ...restored, updatedAt: Date.now() })
      }
    }
    if (stockAffected && variant?.id != null) {
      const freshNewVariant = await db.variants.get(variant.id)
      if (freshNewVariant) {
        const deducted =
          sale.location === 'vishalShop'
            ? { stockVishalShop: Math.max(0, freshNewVariant.stockVishalShop - sale.qty) }
            : { stockMyShop: Math.max(0, freshNewVariant.stockMyShop - sale.qty) }
        await db.variants.update(variant.id, { ...deducted, updatedAt: Date.now() })
      }
    }

    await db.sales.update(sale.id!, {
      productId: product.id,
      variantId: variant?.id,
      itemName: product.name,
      category: product.category,
      variant: variant && variant.label !== 'Standard' ? variant.label : undefined,
      costAtSale: variant ? variant.costPrice * sale.qty : sale.costAtSale,
    })
  })
}
