import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES, UNIT_TYPES, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Product, type Variant, type TransferDirection } from '../db'
import { Button, Modal, Field, inputClass, Pill, BottomSheet } from '../components/ui'
import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  MoreVerticalIcon,
  SortIcon,
  FilterIcon,
  BoxesIcon,
  ChevronRightIcon,
  EditIcon,
} from '../components/icons'
import { ProductDetailView } from '../components/ProductDetailView'
import { AddProductFastEntryModal } from '../components/AddProductFastEntryModal'
import { CatalogEntryCard } from '../components/CatalogEntryCard'
import { WarehouseLogLedger } from '../components/WarehouseLogLedger'
import { FillMissingCostsView } from '../components/FillMissingCostsView'
import {
  ShopifyShell,
  ShopifyHeaderIconButton,
  shopifyInputClass,
  shopifyChipClass,
  shopifyIconButtonClass,
} from '../components/ShopifyShell'
import { dateKeyMonrovia, formatShortDateMonrovia, isLowStock, selectOnFocus, variantDisplayLabel } from '../lib/format'
import { withoutVoided } from '../lib/salesLedger'
import { familySortKey } from '../lib/itemMatch'
import { reorderVariantLabel, formatMattressLabel, guessCategory, MATTRESS_NAME_RE } from '../lib/catalogCleanup'
import { guessUnit } from '../lib/unitGuess'
import { format } from 'date-fns'

// Missing cost = never entered (costUnknown) OR left at a literal zero,
// which in practice almost always means the same thing: nobody's typed a
// real cost in yet.
function hasMissingCost(v: Variant): boolean {
  return v.costUnknown || !v.costPrice
}

function availableOf(variants: Variant[]): number {
  return variants.reduce((s, v) => s + v.stockMyShop + v.stockVishalShop, 0)
}

// One SKU row's display text -- "Product" alone for a loose/base variant,
// "Product — Variant" once there's a real differentiator. Skips the
// "Product — " prefix when the variant label already names the product
// itself (e.g. a mattress variant already ending in "Mattress"), so rows
// don't read "Mattress — 8in Double Simple Mattress".
function skuRowLabel(productName: string, variantLabel: string): string {
  const resolved = variantDisplayLabel(productName, variantLabel)
  if (resolved === productName) return productName
  if (resolved.toLowerCase().includes(productName.toLowerCase())) return resolved
  return `${productName} — ${resolved}`
}

const DEAD_STOCK_WINDOW_MS = 60 * 24 * 60 * 60 * 1000

type Chip = 'all' | 'lowStock' | 'missingCost' | 'archived'
type SortBy = 'name' | 'stockAsc' | 'stockDesc' | 'dateAdded' | 'salesVelocity'
type SourceLocationFilter = 'all' | 'storeFloor' | 'warehouse'
type PriceBaselineFilter = 'all' | 'missingSP' | 'missingCP'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'A to Z Alphabetical' },
  { value: 'stockDesc', label: 'Inventory Balance (High to Low)' },
  { value: 'salesVelocity', label: 'Sales Velocity (Highest Selling First)' },
  { value: 'stockAsc', label: 'Inventory (lowest first)' },
  { value: 'dateAdded', label: 'Date added (newest first)' },
]

export default function Inventory() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const allVariants = useLiveQuery(() => db.variants.toArray(), [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState<Chip>('all')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  // Sales Velocity normally ranks by all-time qty sold -- picking an exact
  // date range (e.g. June 4th - 10th) narrows that to just what actually
  // sold in that window instead.
  const [velocityFrom, setVelocityFrom] = useState<string | null>(null)
  const [velocityTo, setVelocityTo] = useState<string | null>(null)

  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [transferSheetOpen, setTransferSheetOpen] = useState(false)
  const [warehouseLogOpen, setWarehouseLogOpen] = useState(false)
  const [fillCostsOpen, setFillCostsOpen] = useState(false)

  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [sourceLocationFilter, setSourceLocationFilter] = useState<SourceLocationFilter>('all')
  const [priceBaselineFilter, setPriceBaselineFilter] = useState<PriceBaselineFilter>('all')

  const [detailProductId, setDetailProductId] = useState<number | 'new' | null>(null)

  // Selection is an always-available affordance -- no separate "select
  // mode" toggle to enter/exit first.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  const [groupTarget, setGroupTarget] = useState<'new' | number>(-1)
  const [groupNewName, setGroupNewName] = useState('')
  const [groupTargetQuery, setGroupTargetQuery] = useState('')

  const [unitsModalOpen, setUnitsModalOpen] = useState(false)
  const [unitsCategoryName, setUnitsCategoryName] = useState('')
  const [unitsDraft, setUnitsDraft] = useState<string[]>([])

  const [transferDirection, setTransferDirection] = useState<TransferDirection>('out')
  const [transferProductId, setTransferProductId] = useState<number | ''>('')
  const [transferVariantId, setTransferVariantId] = useState<number | ''>('')
  const [transferQty, setTransferQty] = useState<number>(0)
  const [transferDate, setTransferDate] = useState(() => format(Date.now(), 'yyyy-MM-dd'))
  const [transferError, setTransferError] = useState<string | null>(null)

  const recentTransfers = useLiveQuery(
    () => db.stockTransfers.orderBy('createdAt').reverse().limit(10).toArray(),
    [],
  )

  const variantsByProduct = useMemo(() => {
    const map = new Map<number, Variant[]>()
    for (const v of allVariants ?? []) {
      const list = map.get(v.productId) ?? []
      list.push(v)
      map.set(v.productId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.sellPrice - b.sellPrice)
    return map
  }, [allVariants])

  // Family/duplicate detector: flags products whose names reduce to the same
  // family key -- either the same words in a different order ("4 inch nail"
  // / "nail 4 inch"), or the same words minus a differing size number
  // ("10\" double elegance mattrass" / "double 15\" elegance mattrass") --
  // so a product that was accidentally re-created as its own standalone
  // item for every size gets surfaced for review instead of silently
  // cluttering the catalog. Detection is purely a read-only scan -- the
  // actual merge reuses mergeSelectedIntoGroup(), which only reparents
  // variants (keeping their IDs, so past Sale rows stay exactly as
  // recorded) and never touches db.sales.
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, Product[]>()
    for (const p of products ?? []) {
      if (p.archived) continue
      const key = familySortKey(p.name)
      if (!key) continue
      const list = byKey.get(key) ?? []
      list.push(p)
      byKey.set(key, list)
    }
    return Array.from(byKey.values()).filter((list) => list.length > 1)
  }, [products])
  const [dismissedDuplicateKeys, setDismissedDuplicateKeys] = useState<Set<string>>(new Set())
  const visibleDuplicateGroups = duplicateGroups.filter((g) => !dismissedDuplicateKeys.has(familySortKey(g[0].name)))

  function reviewDuplicateGroup(group: Product[]) {
    setSelectedIds(new Set(group.map((p) => p.id!)))
    setGroupTarget(group[0].id!)
    setGroupSheetOpen(true)
  }

  function dismissDuplicateGroup(group: Product[]) {
    setDismissedDuplicateKeys((prev) => new Set(prev).add(familySortKey(group[0].name)))
  }

  const allCategories = useMemo(() => {
    const fromProducts = new Set((products ?? []).map((p) => p.category))
    const fromDb = new Set((categories ?? []).map((c) => c.name))
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...fromDb, ...fromProducts])).sort()
  }, [products, categories])

  const chipCounts = useMemo(() => {
    const active = (products ?? []).filter((p) => !p.archived)
    let lowStock = 0
    let missingCost = 0
    for (const p of active) {
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.some((v) => isLowStock(v.stockMyShop + v.stockVishalShop, v.lowStockThreshold))) lowStock++
      if (variants.some(hasMissingCost)) missingCost++
    }
    const archived = (products ?? []).filter((p) => p.archived).length
    return { lowStock, missingCost, archived }
  }, [products, variantsByProduct])

  // Sales history backing both the Sales Velocity sort and Dead Stock
  // detection -- qty sold per product (all-time) and which variants have
  // sold at all within the last 60 days.
  const allSalesRaw = useLiveQuery(() => db.sales.toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  const salesQtyByProduct = useMemo(() => {
    const from = velocityFrom && velocityTo && velocityTo < velocityFrom ? velocityTo : velocityFrom
    const to = velocityFrom && velocityTo && velocityTo < velocityFrom ? velocityFrom : (velocityTo ?? velocityFrom)
    const map = new Map<number, number>()
    for (const s of allSales ?? []) {
      if (s.productId == null) continue
      if (from) {
        const key = dateKeyMonrovia(s.timestamp)
        if (key < from || key > (to ?? from)) continue
      }
      map.set(s.productId, (map.get(s.productId) ?? 0) + s.qty)
    }
    return map
  }, [allSales, velocityFrom, velocityTo])
  const recentSaleVariantIds = useMemo(() => {
    const cutoff = Date.now() - DEAD_STOCK_WINDOW_MS
    const set = new Set<number>()
    for (const s of allSales ?? []) {
      if (s.variantId != null && s.timestamp >= cutoff) set.add(s.variantId)
    }
    return set
  }, [allSales])
  // Dead Stock: every variant under this product has gone 60 days with zero
  // sales (a product with no variants at all isn't "dead", just empty).
  function isDeadStockProduct(product: Product): boolean {
    const variants = variantsByProduct.get(product.id!) ?? []
    return variants.length > 0 && variants.every((v) => !recentSaleVariantIds.has(v.id!))
  }

  const [isolateDeadStock, setIsolateDeadStock] = useState(false)
  const [deadStockDrawerOpen, setDeadStockDrawerOpen] = useState(false)

  // Flat, group-nested table: every product is listed (grouped visually by
  // its own variants beneath it) -- always sorted, never bucketed into a
  // folder hierarchy.
  const filtered = useMemo(() => {
    let list = products ?? []

    if (activeChip === 'archived') {
      list = list.filter((p) => p.archived)
    } else {
      list = list.filter((p) => !p.archived)
      if (activeChip === 'lowStock') {
        list = list.filter((p) =>
          (variantsByProduct.get(p.id!) ?? []).some((v) => isLowStock(v.stockMyShop + v.stockVishalShop, v.lowStockThreshold)),
        )
      } else if (activeChip === 'missingCost') {
        list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some(hasMissingCost))
      }
    }

    if (categoryFilter !== 'All') list = list.filter((p) => p.category === categoryFilter)
    if (sourceLocationFilter === 'storeFloor') {
      list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some((v) => v.stockMyShop > 0))
    } else if (sourceLocationFilter === 'warehouse') {
      list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some((v) => v.stockVishalShop > 0))
    }
    if (priceBaselineFilter === 'missingSP') {
      list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some((v) => !v.sellPrice))
    } else if (priceBaselineFilter === 'missingCP') {
      list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some(hasMissingCost))
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true
        return (variantsByProduct.get(p.id!) ?? []).some(
          (v) => v.label.toLowerCase().includes(q) || v.sku?.toLowerCase().includes(q),
        )
      })
    }

    const sorted = [...list]
    if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'stockAsc') sorted.sort((a, b) => availableOf(variantsByProduct.get(a.id!) ?? []) - availableOf(variantsByProduct.get(b.id!) ?? []))
    else if (sortBy === 'stockDesc') sorted.sort((a, b) => availableOf(variantsByProduct.get(b.id!) ?? []) - availableOf(variantsByProduct.get(a.id!) ?? []))
    else if (sortBy === 'dateAdded') sorted.sort((a, b) => b.createdAt - a.createdAt)
    else if (sortBy === 'salesVelocity') sorted.sort((a, b) => (salesQtyByProduct.get(b.id!) ?? 0) - (salesQtyByProduct.get(a.id!) ?? 0))
    return sorted
  }, [products, query, activeChip, categoryFilter, sourceLocationFilter, priceBaselineFilter, sortBy, variantsByProduct, salesQtyByProduct])

  // When isolating dead stock, products that are fully dead (every variant
  // has gone 60 days with zero sales) drop out of the main list entirely
  // and collect in a separate collapsible drawer below.
  const { activeList, deadStockList } = useMemo(() => {
    if (!isolateDeadStock) return { activeList: filtered, deadStockList: [] as Product[] }
    const active: Product[] = []
    const dead: Product[] = []
    for (const p of filtered) (isDeadStockProduct(p) ? dead : active).push(p)
    return { activeList: active, deadStockList: dead }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, isolateDeadStock, recentSaleVariantIds, variantsByProduct])

  // SKU view: the same filtered products, flattened to one row per variant
  // (not per product) and grouped by category -- "labeled and ordered by
  // the product" instead of a flat, unsorted dump. A loose product's one
  // "Standard" variant shows just the product name; an actual differentiated
  // variant shows "Product — Variant".
  function buildSkuGroups(list: Product[]) {
    const byCategory = new Map<string, { productId: number; productName: string; variant: Variant }[]>()
    for (const p of list) {
      const variants = [...(variantsByProduct.get(p.id!) ?? [])].sort((a, b) => a.order - b.order)
      const rows = byCategory.get(p.category) ?? []
      for (const v of variants) rows.push({ productId: p.id!, productName: p.name, variant: v })
      byCategory.set(p.category, rows)
    }
    for (const rows of byCategory.values()) {
      rows.sort((a, b) => a.productName.localeCompare(b.productName) || a.variant.order - b.variant.order)
    }
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }
  const skuGroups = useMemo(() => buildSkuGroups(activeList), [activeList, variantsByProduct])
  const skuRowCount = skuGroups.reduce((s, [, rows]) => s + rows.length, 0)
  const deadStockSkuGroups = useMemo(() => buildSkuGroups(deadStockList), [deadStockList, variantsByProduct])

  const transferVariantOptions = transferProductId ? variantsByProduct.get(transferProductId) ?? [] : []

  async function submitTransfer() {
    setTransferError(null)
    if (!transferProductId || !transferVariantId) {
      setTransferError('Pick a product and variant to transfer.')
      return
    }
    if (!transferQty || transferQty <= 0) {
      setTransferError('Quantity must be at least 1.')
      return
    }

    const productId = transferProductId
    const variantId = transferVariantId

    await db.transaction('rw', db.variants, db.stockTransfers, async () => {
      const variant = await db.variants.get(variantId)
      if (!variant) return
      const updated =
        transferDirection === 'out'
          ? { stockMyShop: Math.max(0, variant.stockMyShop - transferQty), stockVishalShop: variant.stockVishalShop + transferQty }
          : { stockVishalShop: Math.max(0, variant.stockVishalShop - transferQty), stockMyShop: variant.stockMyShop + transferQty }
      await db.variants.update(variantId, { ...updated, updatedAt: Date.now() })
      await db.stockTransfers.add({
        variantId,
        productId,
        direction: transferDirection,
        qty: transferQty,
        date: transferDate,
        createdAt: Date.now(),
      })
    })

    setTransferQty(0)
    setTransferVariantId('')
  }


  // "Select Filtered": whatever the top search bar's query currently
  // matches gets checked in one tap, instead of hand-picking each row --
  // `filtered` already applies that same query (plus the active chip/sort),
  // so this just adopts its result set wholesale.
  function selectFiltered() {
    setSelectedIds(new Set(filtered.map((p) => p.id!)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // "Move to…" -- the one merge/organize action: reparents every selected
  // product's variant(s) under either a brand-new product or an existing
  // one. Variant IDs are always kept (so historical Sale rows never
  // change); a variant still on the generic "Standard" label gets renamed
  // to its old source product's name, and every resulting label is run
  // through reorderVariantLabel() to drop the redundant "SourceName — "
  // prefix and reorder into the shop's SIZE-quality-TYPE reading order.
  // A brand-new target product gets its category auto-guessed from its
  // name (Mattresses/Generators/Zinc Sheets/etc.) instead of always
  // landing in "General".
  async function mergeSelectedIntoGroup() {
    const sourceIds = Array.from(selectedIds)
    if (sourceIds.length === 0) return
    const now = Date.now()

    const targetId = await db.transaction('rw', db.products, db.variants, async () => {
      let target: number
      if (groupTarget === 'new') {
        const name = groupNewName.trim()
        if (!name) return null
        target = (await db.products.add({
          name,
          category: guessCategory(name) ?? 'General',
          description: '',
          images: [],
          options: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        })) as number
      } else {
        target = groupTarget
      }

      const targetProduct = await db.products.get(target)
      const isMattress = !!targetProduct && MATTRESS_NAME_RE.test(targetProduct.name)
      const relabel = isMattress ? formatMattressLabel : reorderVariantLabel

      for (const sourceId of sourceIds) {
        if (sourceId === target) continue
        const source = await db.products.get(sourceId)
        if (!source) continue
        const vs = await db.variants.where('productId').equals(sourceId).toArray()
        for (const v of vs) {
          const rawLabel = v.label === 'Standard' ? source.name : v.label
          const label = relabel(rawLabel)
          await db.variants.update(v.id!, { productId: target, label, updatedAt: now })
        }
        await db.products.delete(sourceId)
      }

      return target
    })

    setGroupSheetOpen(false)
    setGroupNewName('')
    setGroupTarget('new')
    clearSelection()
    if (targetId != null) {
      const targetProduct = await db.products.get(targetId)
      if (targetProduct) setQuery(targetProduct.name)
    }
  }

  // Scans every variant/product once and cleans up existing data in place
  // -- never reparents, never deletes, never touches ids/stock/sale
  // history. Reorders each variant's label (see reorderVariantLabel) and
  // backfills a real category for any product still sitting on "General"
  // whose name matches a known keyword. Safe to run repeatedly: anything
  // already clean is simply left alone (no-op, no write).
  async function cleanUpCatalog() {
    let labelsChanged = 0
    let categoriesChanged = 0
    await db.transaction('rw', db.products, db.variants, async () => {
      const allProducts = await db.products.toArray()
      for (const p of allProducts) {
        if ((!p.category || p.category === 'General')) {
          const guess = guessCategory(p.name)
          if (guess) {
            await db.products.update(p.id!, { category: guess, updatedAt: Date.now() })
            categoriesChanged++
          }
        }
      }
      const productById = new Map(allProducts.map((p) => [p.id!, p]))
      const allVariants = await db.variants.toArray()
      for (const v of allVariants) {
        const product = productById.get(v.productId)
        const isMattress = !!product && MATTRESS_NAME_RE.test(product.name)
        const next = isMattress ? formatMattressLabel(v.label) : reorderVariantLabel(v.label)
        if (next !== v.label) {
          await db.variants.update(v.id!, { label: next, updatedAt: Date.now() })
          labelsChanged++
        }
      }
    })
    window.alert(`Cleaned up ${labelsChanged} variant name${labelsChanged === 1 ? '' : 's'} and ${categoriesChanged} product categor${categoriesChanged === 1 ? 'y' : 'ies'}.`)
  }

  function openUnitsEditor(categoryName: string) {
    const existing = (categories ?? []).find((c) => c.name === categoryName)
    setUnitsCategoryName(categoryName)
    setUnitsDraft(existing?.allowedUnits ?? [])
    setUnitsModalOpen(true)
  }

  async function saveUnitsEditor() {
    const existing = (categories ?? []).find((c) => c.name === unitsCategoryName)
    if (existing?.id) {
      await db.categories.update(existing.id, { allowedUnits: unitsDraft })
    } else {
      await db.categories.add({ name: unitsCategoryName, allowedUnits: unitsDraft })
    }
    setUnitsModalOpen(false)
  }

  function toggleDraftUnit(u: string) {
    setUnitsDraft((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]))
  }

  const CHIPS: { key: Chip; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: 0 },
    { key: 'lowStock', label: 'Low stock', count: chipCounts.lowStock },
    { key: 'missingCost', label: 'Missing cost', count: chipCounts.missingCost },
    { key: 'archived', label: 'Archived', count: chipCounts.archived },
  ]

  return (
    <ShopifyShell
      title="Stock"
      headerRight={
        <>
          <ShopifyHeaderIconButton onClick={() => setDetailProductId('new')} label="Add product">
            <PlusIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
          <ShopifyHeaderIconButton onClick={() => setMoreMenuOpen(true)} label="More options">
            <MoreVerticalIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Clean top: search + sort/filter icons, an add-product button,
            then the real category chips -- the app's own scan/filter
            controls (Select Filtered/Move to…) only appear once there's
            something to act on, instead of sitting there unused. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 [color:var(--cl-ink-3)]" />
            <input
              className={shopifyInputClass + ' pl-9'}
              placeholder="Search by product, variant, or SKU"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button onClick={() => setSortSheetOpen(true)} className={shopifyIconButtonClass} aria-label="Sort by" title="Sort by">
            <SortIcon className="h-4 w-4" />
          </button>
          <button onClick={() => setFilterSheetOpen(true)} className={shopifyIconButtonClass} aria-label="Filter by" title="Filter by">
            <FilterIcon className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => setDetailProductId('new')}
          className="btn ghost"
          style={{ borderRadius: 999, borderColor: 'var(--cl-line)', letterSpacing: '.02em' }}
        >
          + Add product or variant
        </button>

        {/* Real category chips (All / Roofing / Mattresses / ...), scrollable
            left-to-right -- a direct shortcut into categoryFilter instead of
            burying it inside the Filter by sheet. */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button onClick={() => setCategoryFilter('All')} className={shopifyChipClass(categoryFilter === 'All')}>
            All
          </button>
          {allCategories.map((c) => (
            <button key={c} onClick={() => setCategoryFilter(c)} className={shopifyChipClass(categoryFilter === c)}>
              {c}
            </button>
          ))}
        </div>

        {sortBy === 'salesVelocity' && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="shrink-0 text-xs font-semibold [color:var(--cl-ink-3)]">Velocity range</span>
            <label
              className="relative inline-flex shrink-0 cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-bold"
              style={{
                borderColor: velocityFrom ? 'var(--cl-ink)' : 'var(--cl-line)',
                background: velocityFrom ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: velocityFrom ? 'white' : 'var(--cl-ink-2)',
              }}
            >
              From {velocityFrom ? formatShortDateMonrovia(new Date(`${velocityFrom}T12:00:00`).getTime()) : 'all time'}
              <input type="date" value={velocityFrom ?? ''} onChange={(e) => setVelocityFrom(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <label
              className="relative inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-bold"
              style={{
                borderColor: velocityTo ? 'var(--cl-ink)' : 'var(--cl-line)',
                background: velocityTo ? 'var(--cl-ink)' : 'var(--cl-card)',
                color: velocityTo ? 'white' : 'var(--cl-ink-2)',
                cursor: velocityFrom ? 'pointer' : 'default',
                opacity: velocityFrom ? 1 : 0.4,
              }}
            >
              To {velocityTo ? formatShortDateMonrovia(new Date(`${velocityTo}T12:00:00`).getTime()) : velocityFrom ? 'same day' : '…'}
              <input type="date" disabled={!velocityFrom} value={velocityTo ?? ''} onChange={(e) => setVelocityTo(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            {velocityFrom && (
              <button onClick={() => { setVelocityFrom(null); setVelocityTo(null) }} className="shrink-0 text-xs font-semibold [color:var(--cl-ink-3)]">
                ✕ Clear
              </button>
            )}
          </div>
        )}

        {(query.trim() || selectedIds.size > 0) && (
          <div className="flex flex-col gap-2 rounded-xl border [border-color:var(--cl-line)] [background:var(--cl-line-2)] p-2">
            <div className="flex items-center gap-2">
              <button
                onClick={selectFiltered}
                disabled={!query.trim()}
                className="flex-1 rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-card)] px-3 py-1.5 text-sm font-semibold [color:var(--cl-ink)] disabled:opacity-30"
              >
                Select Filtered{query.trim() ? ` (${filtered.length})` : ''}
              </button>
              <button
                onClick={() => setGroupSheetOpen(true)}
                disabled={selectedIds.size === 0}
                className="shrink-0 rounded-lg [background:var(--cl-ink)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-30"
              >
                Move to…
              </button>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium [color:var(--cl-ink)]">{selectedIds.size} selected</span>
                <button onClick={clearSelection} className="font-medium [color:var(--cl-ink-2)]">Clear</button>
              </div>
            )}
          </div>
        )}

        {visibleDuplicateGroups.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-amber-800">
              {visibleDuplicateGroups.length} possible duplicate/same-family item{visibleDuplicateGroups.length === 1 ? '' : 's'} found
            </span>
            {visibleDuplicateGroups.map((group) => (
              <div key={familySortKey(group[0].name)} className="flex items-center justify-between gap-2 rounded-lg [background:var(--cl-card)] px-2.5 py-1.5">
                <span className="min-w-0 truncate text-xs [color:var(--cl-ink)]">{group.map((p) => p.name).join('  ·  ')}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => dismissDuplicateGroup(group)} className="text-xs font-medium [color:var(--cl-ink-3)]">
                    Dismiss
                  </button>
                  <button onClick={() => reviewDuplicateGroup(group)} className="text-xs font-semibold text-amber-700">
                    Review &amp; Merge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {skuGroups.map(([category, rows]) => (
            <div key={category}>
              <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide [color:var(--cl-ink-3)]">
                {category} ({rows.length})
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((row) => (
                  <CatalogEntryCard
                    key={`${row.productId}-${row.variant.id}`}
                    title={skuRowLabel(row.productName, row.variant.label)}
                    cost={row.variant.costPrice}
                    sell={row.variant.sellPrice}
                    currency={row.variant.currency}
                    unit={guessUnit(`${row.productName} ${row.variant.label}`, category)}
                    qty={row.variant.stockMyShop + row.variant.stockVishalShop}
                    rate={rate}
                    highlightSell
                    onEditCost={(next) => db.variants.update(row.variant.id!, { costPrice: next, costUnknown: false, updatedAt: Date.now() })}
                    onClick={() => setDetailProductId(row.productId)}
                  />
                ))}
              </div>
            </div>
          ))}
          {skuRowCount === 0 && deadStockList.length === 0 && (
            <p className="py-10 text-center text-sm [color:var(--cl-ink-2)]">No products match. Tap + above to add one.</p>
          )}

          {/* Dead Stock drawer -- only rendered while isolating, collapsed
              by default so the segregated items stay out of the way until
              deliberately reviewed. */}
          {isolateDeadStock && deadStockList.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-amber-200">
              <button
                onClick={() => setDeadStockDrawerOpen((v) => !v)}
                className="flex w-full items-center justify-between bg-amber-50 px-3 py-2.5 text-left"
              >
                <span className="text-sm font-semibold text-amber-800">Dead Stock ({deadStockList.length})</span>
                <ChevronRightIcon className={`h-4 w-4 text-amber-500 transition-transform ${deadStockDrawerOpen ? 'rotate-90' : ''}`} />
              </button>
              {deadStockDrawerOpen && (
                <div className="flex flex-col gap-4 p-2">
                  {deadStockSkuGroups.map(([category, rows]) => (
                    <div key={category}>
                      <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide [color:var(--cl-ink-3)]">
                        {category} ({rows.length})
                      </div>
                      <div className="flex flex-col gap-2">
                        {rows.map((row) => (
                          <CatalogEntryCard
                            key={`${row.productId}-${row.variant.id}`}
                            title={skuRowLabel(row.productName, row.variant.label)}
                            cost={row.variant.costPrice}
                            sell={row.variant.sellPrice}
                            currency={row.variant.currency}
                            unit={guessUnit(`${row.productName} ${row.variant.label}`, category)}
                            qty={row.variant.stockMyShop + row.variant.stockVishalShop}
                            rate={rate}
                            highlightSell
                            onEditCost={(next) => db.variants.update(row.variant.id!, { costPrice: next, costUnknown: false, updatedAt: Date.now() })}
                            onClick={() => setDetailProductId(row.productId)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sort by */}
      <BottomSheet open={sortSheetOpen} onClose={() => setSortSheetOpen(false)} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold [color:var(--cl-ink-2)]">Sort by</h2>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value)
                setSortSheetOpen(false)
              }}
              className="flex items-center justify-between rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
            >
              {opt.label}
              {sortBy === opt.value && <span>✓</span>}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Filter by */}
      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="px-1 text-sm font-semibold [color:var(--cl-ink-2)]">Filter by</h2>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Category</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategoryFilter('All')} className={shopifyChipClass(categoryFilter === 'All')}>All</button>
              {allCategories.map((c) => (
                <button key={c} onClick={() => setCategoryFilter(c)} className={shopifyChipClass(categoryFilter === c)}>{c}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Source location</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'storeFloor', 'warehouse'] as SourceLocationFilter[]).map((v) => (
                <button key={v} onClick={() => setSourceLocationFilter(v)} className={shopifyChipClass(sourceLocationFilter === v)}>
                  {v === 'all' ? 'All' : v === 'storeFloor' ? 'Store floor' : 'Sourced warehouse'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Price baseline</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'missingSP', 'missingCP'] as PriceBaselineFilter[]).map((v) => (
                <button key={v} onClick={() => setPriceBaselineFilter(v)} className={shopifyChipClass(priceBaselineFilter === v)}>
                  {v === 'all' ? 'All' : v === 'missingSP' ? 'Missing sell price' : 'Missing cost price'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {CHIPS.map((chip) => (
                <button key={chip.key} onClick={() => setActiveChip(chip.key)} className={shopifyChipClass(activeChip === chip.key)}>
                  {chip.label}
                  {chip.count > 0 ? ` (${chip.count})` : ''}
                </button>
              ))}
              <button
                onClick={() => setIsolateDeadStock((v) => !v)}
                className={shopifyChipClass(isolateDeadStock)}
                title="Segregate variants with zero sales in the last 60 days into a separate drawer"
              >
                Isolate Dead Stock
              </button>
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-3">
            <button
              onClick={() => {
                setCategoryFilter('All')
                setSourceLocationFilter('all')
                setPriceBaselineFilter('all')
                setActiveChip('all')
                setIsolateDeadStock(false)
              }}
              className="text-sm font-medium [color:var(--cl-ink-2)]"
            >
              Clear all
            </button>
            <button onClick={() => setFilterSheetOpen(false)} className="rounded-lg [background:var(--cl-ink)] px-4 py-2 text-sm font-semibold text-white">
              Done
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* More options (⋮) */}
      <BottomSheet open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold [color:var(--cl-ink-2)]">More options</h2>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setTransferSheetOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
          >
            <BoxesIcon className="h-5 w-5 [color:var(--cl-ink-2)]" />
            Warehouse Book (Vishal)
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setWarehouseLogOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
          >
            <BoxesIcon className="h-5 w-5 [color:var(--cl-ink-2)]" />
            Warehouse Log Ledger
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setFillCostsOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
          >
            <SettingsIcon className="h-5 w-5 [color:var(--cl-ink-2)]" />
            Fill Missing Costs
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              openUnitsEditor(categoryFilter !== 'All' ? categoryFilter : allCategories[0])
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
          >
            <SettingsIcon className="h-5 w-5 [color:var(--cl-ink-2)]" />
            Units per category
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              cleanUpCatalog()
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium [color:var(--cl-ink)] hover:[background:var(--cl-line-2)]"
          >
            <EditIcon className="h-5 w-5 [color:var(--cl-ink-2)]" />
            Clean up variant names &amp; categories
          </button>
        </div>
      </BottomSheet>

      {warehouseLogOpen && <WarehouseLogLedger onClose={() => setWarehouseLogOpen(false)} />}
      {fillCostsOpen && <FillMissingCostsView onClose={() => setFillCostsOpen(false)} />}

      {/* Warehouse Book (Vishal) — internal stock transfer, relocated off the main feed */}
      <BottomSheet open={transferSheetOpen} onClose={() => setTransferSheetOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold">Warehouse Book (Vishal)</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Move stock between your shop and Vishal's shop — this replaces the physical transfer log.
          </p>
          <Pill
            options={[
              { label: 'Transfer OUT (to Vishal)', value: 'out' },
              { label: 'Transfer IN (from Vishal)', value: 'in' },
            ]}
            value={transferDirection}
            onChange={setTransferDirection}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Product">
              <select
                className={inputClass}
                value={transferProductId}
                onChange={(e) => {
                  setTransferProductId(e.target.value ? Number(e.target.value) : '')
                  setTransferVariantId('')
                }}
              >
                <option value="">Select product</option>
                {(products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Variant">
              <select
                className={inputClass}
                value={transferVariantId}
                disabled={!transferProductId}
                onChange={(e) => setTransferVariantId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Select variant</option>
                {transferVariantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({transferDirection === 'out' ? v.stockMyShop : v.stockVishalShop} available)
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={transferQty}
                onFocus={selectOnFocus}
                onChange={(e) => setTransferQty(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                className={inputClass}
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </Field>
          </div>
          {transferError && (
            <div className="rounded-lg bg-[var(--status-critical)]/10 px-3 py-2 text-sm text-[var(--status-critical)]">
              {transferError}
            </div>
          )}
          <Button onClick={submitTransfer} className="self-start">Record transfer</Button>

          {recentTransfers && recentTransfers.length > 0 && (
            <div className="mt-2 border-t border-[var(--gridline)] pt-3">
              <h3 className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Recent transfers</h3>
              <ul className="flex flex-col gap-2">
                {recentTransfers.map((t) => {
                  const variant = (allVariants ?? []).find((v) => v.id === t.variantId)
                  const product = (products ?? []).find((p) => p.id === t.productId)
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">
                        {product?.name ?? 'Unknown item'}
                        {variant && variant.label !== 'Standard' ? ` — ${variant.label}` : ''}
                      </span>
                      <span className="tabular text-[var(--text-secondary)]">
                        {t.direction === 'out' ? '→ Vishal' : '← Vishal'} · {t.qty} · {t.date}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Move selected items to a parent product -- either an existing
          family (Mattress, Generators, Zincs, …) or a brand-new one. */}
      <BottomSheet open={groupSheetOpen} onClose={() => setGroupSheetOpen(false)} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold">Move {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} to…</h2>
          <p className="text-xs [color:var(--cl-ink-2)]">
            Each selected item becomes its own variant under the product you pick — nothing is deleted, just reorganized.
          </p>

          <div className="flex gap-2">
            <button onClick={() => setGroupTarget(typeof groupTarget === 'number' ? groupTarget : -1)} className={shopifyChipClass(typeof groupTarget === 'number') + ' flex-1'}>
              Existing product
            </button>
            <button onClick={() => setGroupTarget('new')} className={shopifyChipClass(groupTarget === 'new') + ' flex-1'}>
              New product
            </button>
          </div>

          {groupTarget === 'new' ? (
            <input
              autoFocus
              className={shopifyInputClass}
              placeholder="New product name, e.g. Mattress"
              value={groupNewName}
              onChange={(e) => setGroupNewName(e.target.value)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                className={shopifyInputClass}
                placeholder="Search products, e.g. Mattress, Generators, Zinc"
                value={groupTargetQuery}
                onChange={(e) => setGroupTargetQuery(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border [border-color:var(--cl-line)]">
                {(products ?? [])
                  .filter((p) => !selectedIds.has(p.id!) && p.name.toLowerCase().includes(groupTargetQuery.toLowerCase()))
                  .slice(0, 20)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setGroupTarget(p.id!)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                        groupTarget === p.id ? '[background:var(--cl-line-2)] font-medium' : ''
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <button
            onClick={mergeSelectedIntoGroup}
            disabled={groupTarget === 'new' ? !groupNewName.trim() : typeof groupTarget !== 'number' || groupTarget < 0}
            className="mt-1 w-full rounded-lg [background:var(--cl-ink)] py-2.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            Move items
          </button>
        </div>
      </BottomSheet>

      {detailProductId === 'new' && (
        <AddProductFastEntryModal
          onClose={() => setDetailProductId(null)}
          onCreated={async (productId) => {
            setDetailProductId(null)
            const product = await db.products.get(productId)
            if (product) setQuery(product.name)
          }}
        />
      )}
      {typeof detailProductId === 'number' && (
        <ProductDetailView productId={detailProductId} onClose={() => setDetailProductId(null)} />
      )}

      <Modal open={unitsModalOpen} onClose={() => setUnitsModalOpen(false)} title="Units per category">
        <div className="flex flex-col gap-3">
          <Field label="Category">
            <select
              className={inputClass}
              value={unitsCategoryName}
              onChange={(e) => {
                const name = e.target.value
                const existing = (categories ?? []).find((c) => c.name === name)
                setUnitsCategoryName(name)
                setUnitsDraft(existing?.allowedUnits ?? [])
              }}
            >
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-[var(--text-muted)]">
            Pick which units show up when recording a sale for this category. Leave none selected to allow all units.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {UNIT_TYPES.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => toggleDraftUnit(u)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  unitsDraft.includes(u)
                    ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                    : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUnitsModalOpen(false)}>Cancel</Button>
            <Button onClick={saveUnitsEditor}>Save</Button>
          </div>
        </div>
      </Modal>
    </ShopifyShell>
  )
}
