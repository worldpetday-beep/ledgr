import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'USD' | 'LRD'

export interface Item {
  id?: number
  name: string
  category: string
  variant: string // free text: size, color, pack, etc.
  sku?: string
  costPrice: number
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
}

export interface Category {
  id?: number
  name: string
}

export interface Setting {
  key: string
  value: string
}

export const db = new Dexie('LedgrDB') as Dexie & {
  items: EntityTable<Item, 'id'>
  sales: EntityTable<Sale, 'id'>
  categories: EntityTable<Category, 'id'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  items: '++id, name, category, sku, stock, currency, createdAt',
  sales: '++id, itemId, itemName, category, currency, timestamp',
  categories: '++id, &name',
  settings: '&key',
})

export function profitOf(sale: Sale): number {
  return sale.soldFor - sale.costAtSale
}

export const DEFAULT_CATEGORIES = ['General', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Clothing']
