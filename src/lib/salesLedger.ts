import { db, releaseOrderNumberIfLatest, type Currency, type FulfillmentLocation, type Sale } from '../db'

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

// Deletes a sale line, restoring stock to wherever it was originally
// deducted from, and recycles the order number if that was the last line of
// the most-recently-issued order (no-op otherwise).
export async function deleteSaleLine(sale: Sale): Promise<void> {
  await db.transaction('rw', db.sales, db.variants, async () => {
    await db.sales.delete(sale.id!)
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
    })
  })
}
