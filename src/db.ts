import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'USD' | 'LRD'

export const UNIT_TYPES = ['Piece', 'Carton', 'Sheet', 'Bundle', 'Yard', 'Gallon', 'Bucket', 'Pack', 'Other']

export interface Product {
  id?: number
  name: string
  category: string
  image?: Blob
  createdAt: number
  updatedAt: number
}

export interface Variant {
  id?: number
  productId: number
  label: string // e.g. "Double, Foam, Grade A", "Blue Gallon", or "Standard"
  sku?: string
  costPrice: number
  costUnknown: boolean // true when cost hasn't been entered yet (quick sale of a walk-in item)
  sellPrice: number
  currency: Currency
  stock: number
  lowStockThreshold: number
  order: number // ordering for cheap -> premium display; lower sorts first
  createdAt: number
  updatedAt: number
}

export interface Sale {
  id?: number
  productId?: number
  variantId?: number
  itemName: string // product name at time of sale
  category?: string
  variant?: string // variant/size label at time of sale
  qty: number
  unitType?: string // Carton, Sheet, Bundle, Yard, Gallon, Bucket, Piece, Pack, or a custom unit
  soldFor: number // total sale price for the qty
  costAtSale: number // total cost for the qty
  currency: Currency
  timestamp: number // epoch ms
  customerNumber: number // running ticket number, never resets, never reused
  customerName?: string // optional override label if the customer is known/renamed
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
}

export const db = new Dexie('LedgrDB') as Dexie & {
  products: EntityTable<Product, 'id'>
  variants: EntityTable<Variant, 'id'>
  sales: EntityTable<Sale, 'id'>
  categories: EntityTable<Category, 'id'>
  settings: EntityTable<Setting, 'key'>
  drawerCounts: EntityTable<DrawerCount, 'id'>
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

export const DEFAULT_CATEGORIES = ['General', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Clothing']
