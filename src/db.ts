import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'USD' | 'LRD'

export const UNIT_TYPES = ['Piece', 'Carton', 'Sheet', 'Bundle', 'Roll', 'Yard', 'Gallon', 'Bucket', 'Pack', 'Other']

export interface ProductOption {
  name: string // e.g. "Size", "Color"
  values: string[] // e.g. ["18x18", "24x24"]
}

export interface Product {
  id?: number
  name: string
  category: string
  description: string
  images: Blob[]
  options: ProductOption[] // structured Size/Color-style options; empty = freeform single/multi-variant product
  archived: boolean // true = deactivated/discontinued, hidden from the main product feed
  createdAt: number
  updatedAt: number
}

export interface Variant {
  id?: number
  productId: number
  label: string // e.g. "Double, Foam, Grade A", "Blue Gallon", or "Standard"
  optionValues: string[] // parallel to Product.options — the combination this variant represents; empty for freeform variants
  sku?: string
  costPrice: number
  costUnknown: boolean // true when cost hasn't been entered yet (quick sale of a walk-in item)
  sellPrice: number
  currency: Currency
  stockMyShop: number
  stockVishalShop: number
  lowStockThreshold: number
  order: number // ordering for cheap -> premium display; lower sorts first
  createdAt: number
  updatedAt: number
}

export type TransferDirection = 'out' | 'in' // out = my shop -> Vishal's; in = Vishal's -> my shop

export interface StockTransfer {
  id?: number
  variantId: number
  productId: number
  direction: TransferDirection
  qty: number
  date: string // yyyy-MM-dd, user-picked transfer date
  note?: string
  createdAt: number
}

export type FulfillmentLocation = 'myShop' | 'vishalShop'

export interface Sale {
  id?: number
  productId?: number
  variantId?: number
  itemName: string // product name at time of sale
  category?: string
  variant?: string // variant/size label at time of sale
  qty: number
  unitType?: string // Carton, Sheet, Bundle, Yard, Gallon, Bucket, Piece, Pack, or a custom unit
  soldFor: number // total sale price for the qty, in `currency`
  costAtSale: number // total cost for the qty
  currency: Currency
  // A single line can be split-paid across both currencies at the register
  // (e.g. $5 + L$400 for one item) -- when that happens, `soldFor`/`currency`
  // hold the primary portion and these hold the rest. Absent when the line
  // was paid in a single currency.
  secondaryAmount?: number
  secondaryCurrency?: Currency
  timestamp: number // epoch ms
  customerNumber: number // running ticket number, never resets, never reused
  customerName?: string // optional override label if the customer is known/renamed
  orderNumber: number // one per checkout/invoice (starts at 1000), shared by every line item in that sale
  location: FulfillmentLocation // which shop's stock this line was deducted from
  tbs: boolean // "to be shipped/picked up" — customer already paid, goods still in store
  pickedUp: boolean // for tbs sales: whether stock has actually been handed over yet
}

export interface Category {
  id?: number
  name: string
  allowedUnits?: string[] // undefined/empty = all unit types allowed
}

export interface Setting {
  key: string
  value: string
}

export interface DrawerCount {
  id?: number
  timestamp: number
  usdActual: number
  lrdActual: number
  note?: string
  // End-of-day balancing widget (Sales tab): money paid out of the drawer
  // that day (e.g. sent to Vishal, personal draws) -- absent for older
  // counts logged before this existed, or ones logged without an EOD close.
  outboundUsd?: number
  outboundLrd?: number
}

export type WarehouseLedgerDirection = 'in' | 'out' // in = received from source; out = sent to source

// A purely informational log of stock moving to/from external depots (e.g.
// Vishal Store, or other custom sources). Deliberately NOT linked to
// Variant.stockMyShop/stockVishalShop -- it never touches real inventory
// counts, unlike the Warehouse Book transfer feature in Inventory.
export interface WarehouseLedgerEntry {
  id?: number
  timestamp: number
  source: string // e.g. "Vishal Store", or a custom source name
  direction: WarehouseLedgerDirection
  description: string // free text, e.g. "12 bags cement"
  qty?: number
  note?: string
}

export const db = new Dexie('LedgrDB') as Dexie & {
  products: EntityTable<Product, 'id'>
  variants: EntityTable<Variant, 'id'>
  sales: EntityTable<Sale, 'id'>
  categories: EntityTable<Category, 'id'>
  settings: EntityTable<Setting, 'key'>
  drawerCounts: EntityTable<DrawerCount, 'id'>
  stockTransfers: EntityTable<StockTransfer, 'id'>
  warehouseLedger: EntityTable<WarehouseLedgerEntry, 'id'>
}

db.version(1).stores({
  items: '++id, name, category, sku, stock, currency, createdAt',
  sales: '++id, itemId, itemName, category, currency, timestamp',
  categories: '++id, &name',
  settings: '&key',
})

db.version(2).stores({
  items: '++id, name, category, sku, stock, currency, createdAt',
  sales: '++id, itemId, itemName, category, currency, timestamp, customerNumber',
  categories: '++id, &name',
  settings: '&key',
})

db.version(3)
  .stores({
    items: '++id, name, category, sku, stock, currency, createdAt, costUnknown',
    sales: '++id, itemId, itemName, category, currency, timestamp, customerNumber, tbs',
    categories: '++id, &name',
    settings: '&key',
    drawerCounts: '++id, timestamp',
  })
  .upgrade(async (tx) => {
    await tx.table('items').toCollection().modify((item) => {
      item.costUnknown = false
    })
    await tx.table('sales').toCollection().modify((sale) => {
      sale.tbs = false
      sale.pickedUp = true
    })
  })

db.version(4).stores({
  items: '++id, name, category, sku, stock, currency, createdAt, costUnknown',
  sales: '++id, itemId, itemName, category, currency, timestamp, customerNumber, tbs',
  categories: '++id, &name',
  settings: '&key',
  drawerCounts: '++id, timestamp',
})

// v5: split the old flat "items" catalog into Products (name/category/image)
// each holding one or more Variants (their own cost/sell price and stock).
// Every existing item becomes a product with exactly one variant so nothing
// is lost, and existing sales get remapped from itemId to productId/variantId.
db.version(5)
  .stores({
    items: null,
    products: '++id, name, category, createdAt',
    variants: '++id, productId, label, sku, stock, costUnknown, order',
    sales: '++id, productId, variantId, itemName, category, currency, timestamp, customerNumber, tbs',
    categories: '++id, &name',
    settings: '&key',
    drawerCounts: '++id, timestamp',
  })
  .upgrade(async (tx) => {
    const oldItems = await tx.table('items').toArray()
    const idMap = new Map<number, { productId: number; variantId: number }>()

    for (const item of oldItems) {
      const productId = await tx.table('products').add({
        name: item.name,
        category: item.category,
        image: item.image,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })
      const variantId = await tx.table('variants').add({
        productId,
        label: (item.variant && item.variant.trim()) || 'Standard',
        sku: item.sku,
        costPrice: item.costPrice,
        costUnknown: item.costUnknown,
        sellPrice: item.sellPrice,
        currency: item.currency,
        stock: item.stock,
        lowStockThreshold: item.lowStockThreshold,
        order: 0,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })
      idMap.set(item.id, { productId, variantId })
    }

    await tx.table('sales').toCollection().modify((sale) => {
      const mapped = sale.itemId != null ? idMap.get(sale.itemId) : undefined
      if (mapped) {
        sale.productId = mapped.productId
        sale.variantId = mapped.variantId
      }
      delete sale.itemId
    })
  })

// v6: split each variant's single stock count into two shop-specific counts
// so stock moving between the two physical locations can be tracked as an
// explicit transfer instead of a silent edit. Existing stock becomes the
// "my shop" balance; Vishal's shop starts at 0 until a transfer moves stock
// there.
db.version(6)
  .stores({
    variants: '++id, productId, label, sku, stockMyShop, stockVishalShop, costUnknown, order',
    stockTransfers: '++id, variantId, productId, direction, date, createdAt',
  })
  .upgrade(async (tx) => {
    await tx.table('variants').toCollection().modify((variant) => {
      variant.stockMyShop = variant.stock ?? 0
      variant.stockVishalShop = 0
      delete variant.stock
    })
  })

// v7: add a dedicated order-number sequence (starting at 1000) separate from
// customerNumber. One order can span multiple sale rows (one per line item
// in an invoice) that were all submitted together and share the same exact
// timestamp; each such group becomes one order and gets one order number,
// assigned chronologically so historical sales keep a sensible sequence.
db.version(7)
  .stores({
    sales: '++id, productId, variantId, itemName, category, currency, timestamp, customerNumber, tbs, orderNumber',
  })
  .upgrade(async (tx) => {
    const allSales = await tx.table('sales').orderBy('timestamp').toArray()
    const groupOrder: string[] = []
    const groups = new Map<string, number[]>()
    for (const sale of allSales) {
      const key = `${sale.customerNumber}:${sale.timestamp}`
      if (!groups.has(key)) {
        groups.set(key, [])
        groupOrder.push(key)
      }
      groups.get(key)!.push(sale.id)
    }

    let counter = ORDER_NUMBER_BASE
    for (const key of groupOrder) {
      const orderNumber = counter++
      for (const id of groups.get(key)!) {
        await tx.table('sales').update(id, { orderNumber })
      }
    }
    await tx.table('settings').put({ key: NEXT_ORDER_NUMBER_KEY, value: String(counter) })
  })

export const EXCHANGE_RATE_KEY = 'exchangeRateLrdPerUsd'
export const DEFAULT_EXCHANGE_RATE = 180

export function profitOf(sale: Sale): number {
  return sale.soldFor - sale.costAtSale
}

const NEXT_CUSTOMER_NUMBER_KEY = 'nextCustomerNumber'

// Reserves and returns the next customer number, incrementing the stored
// counter so numbers never reset and never get reused even after deletes.
export async function reserveNextCustomerNumber(): Promise<number> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(NEXT_CUSTOMER_NUMBER_KEY)
    const current = row ? parseInt(row.value, 10) : 1
    await db.settings.put({ key: NEXT_CUSTOMER_NUMBER_KEY, value: String(current + 1) })
    return current
  })
}

export function peekNextCustomerNumber(row: Setting | undefined): number {
  return row ? parseInt(row.value, 10) : 1
}

export { NEXT_CUSTOMER_NUMBER_KEY }

// v8: add an "archived" flag to products so discontinued/seasonal items can
// be hidden from the main feed without deleting their history. Existing
// products default to not archived.
db.version(8)
  .stores({
    products: '++id, name, category, createdAt, archived',
  })
  .upgrade(async (tx) => {
    await tx.table('products').toCollection().modify((product) => {
      product.archived = false
    })
  })

// v9: move from a single Product.image to a Product.images[] gallery, add a
// Description field, and add structured Options (e.g. Size/Color) with a
// parallel Variant.optionValues[] so option-based variants can be generated
// as a matrix while existing freeform-labeled variants keep working as-is
// (they just get an empty optionValues array).
db.version(9)
  .stores({
    products: '++id, name, category, createdAt, archived',
    variants: '++id, productId, label, sku, stockMyShop, stockVishalShop, costUnknown, order',
  })
  .upgrade(async (tx) => {
    await tx.table('products').toCollection().modify((product) => {
      product.images = product.image ? [product.image] : []
      delete product.image
      product.description = product.description ?? ''
      product.options = product.options ?? []
    })
    await tx.table('variants').toCollection().modify((variant) => {
      variant.optionValues = variant.optionValues ?? []
    })
  })

// v10: record which shop's stock a sale line was fulfilled from, so a
// checkout can pull from either location instead of always the main shop.
// Every sale recorded before this defaulted to deducting from "my shop"
// stock, so that's the correct historical value for existing rows.
db.version(10)
  .stores({
    sales: '++id, productId, variantId, itemName, category, currency, timestamp, customerNumber, tbs, orderNumber, location',
  })
  .upgrade(async (tx) => {
    await tx.table('sales').toCollection().modify((sale) => {
      sale.location = sale.location ?? 'myShop'
    })
  })

// v11: new Warehouse Ledger table -- a purely informational journal of stock
// moving to/from external depots, separate from the real two-location stock
// transfer feature already in Inventory.
db.version(11).stores({
  warehouseLedger: '++id, timestamp, source, direction',
})

export const NEXT_ORDER_NUMBER_KEY = 'nextOrderNumber'
export const ORDER_NUMBER_BASE = 1000
export const WAREHOUSE_SOURCES_KEY = 'warehouseSources'
export const DEFAULT_WAREHOUSE_SOURCES = ['Vishal Store']

// Reserves and returns the next order number for a whole invoice (shared by
// every line item submitted together), starting at ORDER_NUMBER_BASE and
// never resetting or reusing a number even after deletes.
export async function reserveNextOrderNumber(): Promise<number> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(NEXT_ORDER_NUMBER_KEY)
    const current = row ? parseInt(row.value, 10) : ORDER_NUMBER_BASE
    await db.settings.put({ key: NEXT_ORDER_NUMBER_KEY, value: String(current + 1) })
    return current
  })
}

// If the order being freed was the single most-recently-issued number (and no
// sale rows still reference it), roll the counter back so the very next sale
// reuses that exact number instead of leaving a permanent gap. Deleting an
// older/historical order never renumbers anything -- only the latest one is
// recyclable, matching a physical ledger where you'd cross out and reuse the
// last line, not renumber everything above it.
export async function releaseOrderNumberIfLatest(orderNumber: number): Promise<void> {
  return db.transaction('rw', db.settings, db.sales, async () => {
    const row = await db.settings.get(NEXT_ORDER_NUMBER_KEY)
    const nextToIssue = row ? parseInt(row.value, 10) : ORDER_NUMBER_BASE
    if (orderNumber !== nextToIssue - 1) return
    const stillReferenced = await db.sales.where('orderNumber').equals(orderNumber).count()
    if (stillReferenced === 0) {
      await db.settings.put({ key: NEXT_ORDER_NUMBER_KEY, value: String(orderNumber) })
    }
  })
}

export const DEFAULT_CATEGORIES = ['General', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Clothing']
