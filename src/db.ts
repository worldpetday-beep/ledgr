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

// An extra way to sell the same underlying stock -- e.g. Zinc 14G's stock
// is counted in sheets, but it can also go out by the bundle: { unit:
// "Bundle", factor: 20, price: 55, currency: "USD" } means 1 bundle = 20
// sheets, sold for $55. `factor` is always in the variant's own base unit
// (whatever stockMyShop/stockVishalShop count in). The variant's own
// costPrice/sellPrice/currency remain the implicit first sell-unit
// (factor 1, at the base unit) -- these are strictly additional options
// layered on top, never a replacement for them.
export interface SellUnit {
  unit: string
  factor: number
  price: number
  currency: Currency
  // true = this unit's price was deliberately set by hand and should never
  // be overwritten by the rolling average of what's actually being
  // charged; false/absent = the average keeps this price current.
  manual?: boolean
}

export interface Variant {
  id?: number
  productId: number
  label: string // e.g. "Double, Foam, Grade A", "Blue Gallon", or "Standard"
  optionValues: string[] // parallel to Product.options — the combination this variant represents; empty for freeform variants
  sku?: string
  costPrice: number // always per the variant's base unit, always USD
  costUnknown: boolean // true when cost hasn't been entered yet (quick sale of a walk-in item)
  sellPrice: number // per the variant's base unit, in `currency`
  currency: Currency
  // true = sellPrice was deliberately set by hand and should never be
  // overwritten by the rolling average of what's actually being charged
  // for the base unit; false/absent = the average keeps it current. A
  // fresh variant with no sales yet just keeps whatever price it was
  // given until the first real sale starts the average.
  sellPriceManual?: boolean
  sellUnits?: SellUnit[] // additional ways to sell this same stock -- see SellUnit
  stockMyShop: number
  stockVishalShop: number
  lowStockThreshold: number
  order: number // ordering for cheap -> premium display; lower sorts first
  // Set when a checkout auto-creates or auto-routes this variant from an
  // unverified free-text sale line (see writeTicketLines in
  // RecordSaleSheet.tsx) -- drives the "NEW" badge in Inventory while
  // newSince is under 72h old. Never set for variants added by hand
  // through the product editor.
  isNew?: boolean
  newSince?: number
  // Non-visual, background-only: every other variant ID this one has ever
  // shared a checkout with (deduped), updated after each sale for future
  // "frequently sold with" statistical analysis. Never shown directly in
  // the UI as of this writing.
  frequentlySoldWith?: number[]
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
  soldFor: number // total sale price for the qty, in `currency` -- frozen forever, never re-totalled
  // How much of `soldFor` was actually collected at the register when this
  // line was recorded, in `currency`. Missing on sales from before this
  // field existed, or equal to soldFor -- both read as "fully paid" by
  // owingOf()/collectPayment(). Less than soldFor means the customer still
  // owes the difference; increased later via collectPayment() as they pay
  // it down, without ever touching soldFor itself.
  paidAmount?: number
  costAtSale: number // total cost for the qty
  currency: Currency
  // A single line can be split-paid across both currencies at the register
  // (e.g. $5 + L$400 for one item) -- when that happens, `soldFor`/`currency`
  // hold the primary portion and these hold the rest. Absent when the line
  // was paid in a single currency.
  secondaryAmount?: number
  secondaryCurrency?: Currency
  // Exchange rate (LRD per USD) in effect when this line was recorded --
  // lets the amount convert to the other currency correctly later even
  // after the shop's rate setting changes, instead of re-pricing an old
  // sale at today's rate. Absent on sales recorded before this field
  // existed; callers fall back to the current rate for those.
  rateAtSale?: number
  timestamp: number // epoch ms
  customerNumber: number // running ticket number, never resets, never reused
  customerName?: string // optional override label if the customer is known/renamed
  orderNumber: number // one per checkout/invoice (starts at 1000), shared by every line item in that sale
  location: FulfillmentLocation // which shop's stock this line was deducted from
  tbs: boolean // "to be shipped/picked up" — customer already paid, goods still in store
  pickedUp: boolean // for tbs sales: whether stock has actually been handed over yet
  // Set by the Natural Language Input Auto-Matcher when the typed order
  // line ended in a trailing "/tag" source-switch flag (e.g. "/bro") --
  // sourceTag is the raw flag, sourceNote the resolved human-readable
  // explanation shown wherever the sale is reviewed.
  sourceTag?: string
  sourceNote?: string
  // Soft-delete marker: "removing" a sale line (from today's ledger or the
  // Book Tab's full history) never actually erases the row -- it's stamped
  // voided instead so historical data is always recoverable/auditable.
  // Every read path across the app filters these out of totals/lists.
  voidedAt?: number
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

// One itemized "money out of the drawer" line -- who/what it was for, what
// kind of outflow (lend/personal/sent to another location/expense/etc.),
// and how much in which currency.
export interface DrawerOut {
  id: string
  name: string
  kind: string
  cur: Currency
  amt: number
}

export const DRAWER_OUT_KINDS = ['Lend', 'Taken home', 'Sent to brother', 'Expense', 'Gave out']

export interface DrawerCount {
  id?: number
  timestamp: number
  usdActual: number
  lrdActual: number
  note?: string
  // End-of-day balancing widget: money paid out of the drawer that day --
  // outboundUsd/outboundLrd are the legacy flat totals (still written for
  // older callers), outs is the itemized breakdown the Drawer tab actually
  // edits; when present it's the source of truth and outboundUsd/Lrd are
  // just its sum, kept in sync for anything still reading the old fields.
  outboundUsd?: number
  outboundLrd?: number
  outs?: DrawerOut[]
  // Editable override for "what the drawer opened with" -- defaults to the
  // previous day's counted total when absent, but can be typed over if the
  // drawer actually started different.
  openUsdOverride?: number
  openLrdOverride?: number
  closed?: boolean
  // Photos of the physical ledger/receipt/calculator for this day, kept as
  // a fallback for when there's only time to see the total and snap a
  // picture rather than itemize every line. Any file type is accepted, not
  // just images (e.g. a scanned PDF), so this isn't restricted to photos.
  attachments?: Blob[]
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
  abbreviations: EntityTable<AbbreviationRule, 'id'>
  customUnits: EntityTable<CustomUnit, 'id'>
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

// v12: ledger-scan abbreviation alias engine — a growable dictionary mapping
// this shop's handwritten shorthand to full item descriptions, seeded from
// the owner's own conventions.
db.version(12)
  .stores({
    abbreviations: '++id, pattern, createdAt',
  })
  .upgrade(async (tx) => {
    const now = Date.now()
    await tx.table('abbreviations').bulkAdd(SEED_ABBREVIATION_RULES.map((r) => ({ ...r, createdAt: now })))
  })

// A custom quantity qualifier/unit typed once into the "Other" field during
// Record Sale (e.g. "bag", "roll") -- saved permanently so it renders as a
// selectable pill alongside the built-in UNIT_TYPES in every future sale,
// instead of having to be retyped from scratch each time.
export interface CustomUnit {
  id?: number
  label: string
  createdAt: number
}

// v13: persistent custom quantity qualifiers (Record Sale "Other" unit).
db.version(13).stores({
  customUnits: '++id, &label, createdAt',
})

// v14: nested, smartphone-home-screen-style catalog folders. Existing
// products are untouched (folderId stays undefined = top level of the
// catalog, exactly where they already appeared).
db.version(14).stores({
  products: '++id, name, category, createdAt, archived, folderId',
  folders: '++id, parentId, name, order',
})

// v15: the nested-folder catalog is deprecated and removed in favor of a
// flat, group-nested table (products grouped by their own variants, no
// folder level in between) -- the `folders` table is dropped entirely and
// any leftover `folderId` is stripped from existing products so nothing
// stale lingers in the schema.
db.version(15)
  .stores({
    products: '++id, name, category, createdAt, archived',
    folders: null,
  })
  .upgrade(async (tx) => {
    await tx
      .table('products')
      .toCollection()
      .modify((p) => {
        delete p.folderId
      })
  })

export const NEXT_ORDER_NUMBER_KEY = 'nextOrderNumber'
export const ORDER_NUMBER_BASE = 1000
export const WAREHOUSE_SOURCES_KEY = 'warehouseSources'
export const DEFAULT_WAREHOUSE_SOURCES = ['Vishal Store']

// Editable/addable list of counter locations this ledger records sales
// for -- purely a settings-level list for now (not yet wired onto Sale
// rows; that's data-model work for the next migration pass).
export const BRANCHES_KEY = 'branches'
export const DEFAULT_BRANCHES = ['My Shop']

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

// Saves a custom quantity qualifier the first time it's typed so it shows
// up as a selectable pill in every future sale; a no-op if it's already
// saved (case-insensitive) or matches a built-in UNIT_TYPES entry.
export async function saveCustomUnit(label: string): Promise<void> {
  const clean = label.trim()
  if (!clean || UNIT_TYPES.some((u) => u.toLowerCase() === clean.toLowerCase())) return
  const existing = await db.customUnits.where('label').equalsIgnoreCase(clean).first()
  if (existing) return
  await db.customUnits.add({ label: clean, createdAt: Date.now() })
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
    const stillReferenced = await db.sales.where('orderNumber').equals(orderNumber).and((s) => !s.voidedAt).count()
    if (stillReferenced === 0) {
      await db.settings.put({ key: NEXT_ORDER_NUMBER_KEY, value: String(orderNumber) })
    }
  })
}

export const DEFAULT_CATEGORIES = ['General', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Clothing']

// A short-hand this shop writes in the ledger book (e.g. "bdl", "fam mat")
// mapped to its full item-description meaning. Seeded from the owner's own
// handwriting conventions; grows over time as unrecognized abbreviations get
// manually matched during ledger-scan review (see src/lib/abbreviations.ts).
export interface AbbreviationRule {
  id?: number
  pattern: string // matched case-insensitively; may be a single token ("pcs") or a full phrase
  expansion: string
  createdAt: number
}

export const SEED_ABBREVIATION_RULES: { pattern: string; expansion: string }[] = [
  { pattern: 'pcs', expansion: 'pieces' },
  { pattern: '8" st. spec. double mat', expansion: '8" star special double mattress' },
  { pattern: 'ctn', expansion: 'carton' },
  { pattern: 'bdl', expansion: 'bundle' },
  { pattern: 'fam mat', expansion: 'family mattress' },
  { pattern: 'eleg', expansion: 'elegance' },
  { pattern: 'yrd', expansion: 'yard' },
]
