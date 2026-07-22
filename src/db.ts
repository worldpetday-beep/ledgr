import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'USD' | 'LRD'

export interface Item {
  id?: number
  name: string
  category: string
  variant: string // free text: size, color, pack, etc.
  sku?: string
  costPrice: number
  costUnknown: boolean // true when cost hasn't been entered yet (quick sale of a walk-in item)
  sellPrice: number
  currency: Currency
  stock: number
  lowStockThreshold: number
  createdAt: number
  updatedAt: number
}

export interface Sale {
  id?: number
  itemId?: number // undefined if item wasn't in inventory yet
  itemName: string
  category?: string
  variant?: string
  qty: number
  soldFor: number // total sale price for the qty
  costAtSale: number // total cost for the qty
  currency: Currency
  timestamp: number // epoch ms
  customerNumber: number // running ticket number, never resets, never reused
  tbs: boolean // "to be shipped/picked up" — customer already paid, goods still in store
  pickedUp: boolean // for tbs sales: whether stock has actually been handed over yet
}

export interface Category {
  id?: number
  name: string
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
  items: EntityTable<Item, 'id'>
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
