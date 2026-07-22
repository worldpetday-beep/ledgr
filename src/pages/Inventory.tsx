import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES, UNIT_TYPES, type Currency, type Product, type Variant, type TransferDirection } from '../db'
import { Button, Modal, Field, inputClass, Switch, Pill, BottomSheet } from '../components/ui'
import { PlusIcon, SearchIcon, TrashIcon, SettingsIcon, MoreVerticalIcon, SortIcon, FilterIcon, BoxesIcon, ChartIcon } from '../components/icons'
import { ItemThumb } from '../components/ItemThumb'
import {
  ShopifyShell,
  ShopifyHeaderIconButton,
  shopifyInputClass,
  shopifyChipClass,
  shopifyIconButtonClass,
} from '../components/ShopifyShell'
import { isLowStock, selectOnFocus } from '../lib/format'
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

interface VariantRow {
  key: string
  id?: number
  label: string
  sku: string
  costPrice: number
  costUnknown: boolean
  sellPrice: number
  currency: Currency
  stockMyShop: number
  stockVishalShop: number
  lowStockThreshold: number
}

function blankVariantRow(order: number): VariantRow {
  return {
    key: `new-${Date.now()}-${order}-${Math.random().toString(36).slice(2)}`,
    label: order === 0 ? 'Standard' : '',
    sku: '',
    costPrice: 0,
    costUnknown: true,
    sellPrice: 0,
    currency: 'USD',
    stockMyShop: 0,
    stockVishalShop: 0,
    lowStockThreshold: 3,
  }
}

const emptyProductForm = {
  name: '',
  category: DEFAULT_CATEGORIES[0],
  image: undefined as Blob | undefined,
  archived: false,
}

type Chip = 'all' | 'lowStock' | 'missingCost' | 'sourcedVishal' | 'archived'
type SortBy = 'name' | 'stockAsc' | 'stockDesc' | 'dateAdded'
type SourceLocationFilter = 'all' | 'storeFloor' | 'warehouse'
type PriceBaselineFilter = 'all' | 'missingSP' | 'missingCP'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Product name (A-Z)' },
  { value: 'stockAsc', label: 'Inventory (lowest first)' },
  { value: 'stockDesc', label: 'Inventory (highest first)' },
  { value: 'dateAdded', label: 'Date added (newest first)' },
]

export default function Inventory() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const allVariants = useLiveQuery(() => db.variants.toArray(), [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])

  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState<Chip>('all')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [view, setView] = useState<'list' | 'visual'>('list')

  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [transferSheetOpen, setTransferSheetOpen] = useState(false)

  const [categoryFilter, setCategoryFilter] = useState<string>('All')
  const [sourceLocationFilter, setSourceLocationFilter] = useState<SourceLocationFilter>('all')
  const [priceBaselineFilter, setPriceBaselineFilter] = useState<PriceBaselineFilter>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState(emptyProductForm)
  const [variantRows, setVariantRows] = useState<VariantRow[]>([blankVariantRow(0)])

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

  const allCategories = useMemo(() => {
    const fromProducts = new Set((products ?? []).map((p) => p.category))
    const fromDb = new Set((categories ?? []).map((c) => c.name))
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...fromDb, ...fromProducts])).sort()
  }, [products, categories])

  const chipCounts = useMemo(() => {
    const active = (products ?? []).filter((p) => !p.archived)
    let lowStock = 0
    let missingCost = 0
    let sourcedVishal = 0
    for (const p of active) {
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.some((v) => isLowStock(v.stockMyShop + v.stockVishalShop, v.lowStockThreshold))) lowStock++
      if (variants.some(hasMissingCost)) missingCost++
      if (variants.some((v) => v.stockVishalShop > 0)) sourcedVishal++
    }
    const archived = (products ?? []).filter((p) => p.archived).length
    return { lowStock, missingCost, sourcedVishal, archived }
  }, [products, variantsByProduct])

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
      } else if (activeChip === 'sourcedVishal') {
        list = list.filter((p) => (variantsByProduct.get(p.id!) ?? []).some((v) => v.stockVishalShop > 0))
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
    return sorted
  }, [products, query, activeChip, categoryFilter, sourceLocationFilter, priceBaselineFilter, sortBy, variantsByProduct])

  const byCategory = useMemo(() => {
    const groups = new Map<string, Product[]>()
    for (const p of filtered) {
      const list = groups.get(p.category) ?? []
      list.push(p)
      groups.set(p.category, list)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  function openAdd() {
    setEditingProduct(null)
    setProductForm(emptyProductForm)
    setVariantRows([blankVariantRow(0)])
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setEditingProduct(product)
    setProductForm({ name: product.name, category: product.category, image: product.image, archived: product.archived })
    const variants = variantsByProduct.get(product.id!) ?? []
    setVariantRows(
      variants.length > 0
        ? variants.map((v) => ({
            key: String(v.id),
            id: v.id,
            label: v.label,
            sku: v.sku ?? '',
            costPrice: v.costPrice,
            costUnknown: v.costUnknown,
            sellPrice: v.sellPrice,
            currency: v.currency,
            stockMyShop: v.stockMyShop,
            stockVishalShop: v.stockVishalShop,
            lowStockThreshold: v.lowStockThreshold,
          }))
        : [blankVariantRow(0)],
    )
    setModalOpen(true)
  }

  function updateVariantRow(key: string, patch: Partial<VariantRow>) {
    setVariantRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addVariantRow() {
    setVariantRows((rows) => [...rows, blankVariantRow(rows.length)])
  }

  function removeVariantRow(key: string) {
    setVariantRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows))
  }

  function moveVariantRow(key: string, dir: -1 | 1) {
    setVariantRows((rows) => {
      const idx = rows.findIndex((r) => r.key === key)
      const swapWith = idx + dir
      if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return rows
      const next = [...rows]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return next
    })
  }

  async function saveProduct() {
    if (!productForm.name.trim()) return
    const now = Date.now()
    await db.transaction('rw', db.products, db.variants, async () => {
      let productId: number
      if (editingProduct?.id) {
        productId = editingProduct.id
        await db.products.update(productId, { ...productForm, updatedAt: now })
      } else {
        productId = (await db.products.add({ ...productForm, createdAt: now, updatedAt: now })) as number
      }

      const existingIds = new Set((variantsByProduct.get(productId) ?? []).map((v) => v.id))
      const keptIds = new Set<number>()

      for (const [idx, row] of variantRows.entries()) {
        const payload = {
          productId,
          label: row.label.trim() || 'Standard',
          sku: row.sku.trim() || undefined,
          costPrice: row.costUnknown ? 0 : row.costPrice,
          costUnknown: row.costUnknown,
          sellPrice: row.sellPrice,
          currency: row.currency,
          stockMyShop: row.stockMyShop,
          stockVishalShop: row.stockVishalShop,
          lowStockThreshold: row.lowStockThreshold,
          order: idx,
          updatedAt: now,
        }
        if (row.id) {
          await db.variants.update(row.id, payload)
          keptIds.add(row.id)
        } else {
          await db.variants.add({ ...payload, createdAt: now })
        }
      }

      for (const id of existingIds) {
        if (id && !keptIds.has(id)) await db.variants.delete(id)
      }
    })
    setModalOpen(false)
  }

  async function removeProduct(product: Product) {
    await db.transaction('rw', db.products, db.variants, async () => {
      const vs = variantsByProduct.get(product.id!) ?? []
      await db.variants.bulkDelete(vs.map((v) => v.id!))
      await db.products.delete(product.id!)
    })
    setModalOpen(false)
  }

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
      const fromField = transferDirection === 'out' ? 'stockMyShop' : 'stockVishalShop'
      const toField = transferDirection === 'out' ? 'stockVishalShop' : 'stockMyShop'
      await db.variants.update(variantId, {
        [fromField]: Math.max(0, variant[fromField] - transferQty),
        [toField]: variant[toField] + transferQty,
        updatedAt: Date.now(),
      })
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
    { key: 'sourcedVishal', label: 'Sourced (Vishal)', count: chipCounts.sourcedVishal },
    { key: 'archived', label: 'Archived', count: chipCounts.archived },
  ]

  return (
    <ShopifyShell
      title="Products"
      headerRight={
        <>
          <ShopifyHeaderIconButton onClick={openAdd} label="Add product">
            <PlusIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
          <ShopifyHeaderIconButton onClick={() => setMoreMenuOpen(true)} label="More options">
            <MoreVerticalIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {CHIPS.map((chip) => (
            <button key={chip.key} onClick={() => setActiveChip(chip.key)} className={shopifyChipClass(activeChip === chip.key)}>
              {chip.label}
              {chip.count > 0 ? ` (${chip.count})` : ''}
            </button>
          ))}
        </div>

        {view === 'list' ? (
          <div className="flex flex-col">
            {filtered.map((product, idx) => {
              const variants = variantsByProduct.get(product.id!) ?? []
              const available = availableOf(variants)
              return (
                <button
                  key={product.id}
                  onClick={() => openEdit(product)}
                  className={`flex w-full items-center gap-3 py-3 text-left ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <ItemThumb image={product.image} size={48} className="!rounded-lg !bg-gray-100 !text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-black">{product.name}</div>
                    <div className="truncate text-sm text-gray-500">
                      {available} available • {variants.length} variant{variants.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="py-10 text-center text-sm text-gray-500">No products match. Tap + above to add one.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {byCategory.map(([category, catProducts]) => {
              const stockOf = (p: Product) => (variantsByProduct.get(p.id!) ?? []).reduce((s, v) => s + v.stockMyShop, 0)
              const maxStock = Math.max(1, ...catProducts.map(stockOf))
              return (
                <div key={category}>
                  <h2 className="mb-2 text-sm font-semibold text-black">{category}</h2>
                  <div className="flex flex-wrap gap-2.5">
                    {catProducts.map((product) => {
                      const variants = variantsByProduct.get(product.id!) ?? []
                      const stock = stockOf(product)
                      const ok = variants.length > 0 && variants.every((v) => v.stockMyShop > v.lowStockThreshold * 2)
                      const scale = 0.85 + 0.65 * Math.min(1, stock / maxStock)
                      const toneColor = ok ? '#1a7f37' : '#b45309'
                      return (
                        <button
                          key={product.id}
                          onClick={() => openEdit(product)}
                          style={{ borderColor: toneColor, transform: `scale(${scale})`, transformOrigin: 'center' }}
                          className="flex min-w-[110px] flex-col items-center gap-1.5 rounded-xl border-2 bg-gray-50 px-3 py-2.5 text-center transition-transform"
                        >
                          <ItemThumb image={product.image} size={36} className="!bg-gray-200 !text-gray-400" />
                          <span className="line-clamp-1 text-xs font-medium text-black">{product.name}</span>
                          <span className="tabular text-sm font-semibold" style={{ color: toneColor }}>
                            {stock}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {byCategory.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No products match.</p>}
          </div>
        )}
      </div>

      {/* Sort by */}
      <BottomSheet open={sortSheetOpen} onClose={() => setSortSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold text-gray-500">Sort by</h2>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value)
                setSortSheetOpen(false)
              }}
              className="flex items-center justify-between rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
            >
              {opt.label}
              {sortBy === opt.value && <span>✓</span>}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Filter by */}
      <BottomSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="px-1 text-sm font-semibold text-gray-500">Filter by</h2>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Category</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategoryFilter('All')} className={shopifyChipClass(categoryFilter === 'All')}>All</button>
              {allCategories.map((c) => (
                <button key={c} onClick={() => setCategoryFilter(c)} className={shopifyChipClass(categoryFilter === c)}>{c}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Source location</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'storeFloor', 'warehouse'] as SourceLocationFilter[]).map((v) => (
                <button key={v} onClick={() => setSourceLocationFilter(v)} className={shopifyChipClass(sourceLocationFilter === v)}>
                  {v === 'all' ? 'All' : v === 'storeFloor' ? 'Store floor' : 'Sourced warehouse'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Price baseline</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'missingSP', 'missingCP'] as PriceBaselineFilter[]).map((v) => (
                <button key={v} onClick={() => setPriceBaselineFilter(v)} className={shopifyChipClass(priceBaselineFilter === v)}>
                  {v === 'all' ? 'All' : v === 'missingSP' ? 'Missing sell price' : 'Missing cost price'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-3">
            <button
              onClick={() => {
                setCategoryFilter('All')
                setSourceLocationFilter('all')
                setPriceBaselineFilter('all')
              }}
              className="text-sm font-medium text-gray-500"
            >
              Clear all
            </button>
            <button onClick={() => setFilterSheetOpen(false)} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white">
              Done
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* More options (⋮) */}
      <BottomSheet open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold text-gray-500">More options</h2>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setTransferSheetOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <BoxesIcon className="h-5 w-5 text-gray-500" />
            Warehouse Book (Vishal)
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              openUnitsEditor(categoryFilter !== 'All' ? categoryFilter : allCategories[0])
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <SettingsIcon className="h-5 w-5 text-gray-500" />
            Units per category
          </button>
          <button
            onClick={() => {
              setView((v) => (v === 'list' ? 'visual' : 'list'))
              setMoreMenuOpen(false)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <ChartIcon className="h-5 w-5 text-gray-500" />
            Switch to {view === 'list' ? 'visual' : 'list'} view
          </button>
        </div>
      </BottomSheet>

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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingProduct ? 'Edit product' : 'Add product'}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <ItemThumb image={productForm.image} size={56} />
            <label className="cursor-pointer text-sm font-medium text-[var(--series-1)]">
              {productForm.image ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setProductForm({ ...productForm, image: file })
                }}
              />
            </label>
            {productForm.image && (
              <button onClick={() => setProductForm({ ...productForm, image: undefined })} className="text-sm text-[var(--text-muted)] hover:text-[var(--status-critical)]">
                Remove
              </button>
            )}
          </div>

          <Field label="Product name">
            <input className={inputClass} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
          </Field>

          <Field label="Category">
            <input
              list="category-list"
              className={inputClass}
              value={productForm.category}
              onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
            />
            <datalist id="category-list">
              {allCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>

          <div className="flex items-center gap-2 rounded-lg bg-[var(--page-plane)] px-2.5 py-2">
            <Switch
              checked={productForm.archived}
              onChange={(v) => setProductForm({ ...productForm, archived: v })}
              label="Archived — hidden from the main product feed"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                Variants <span className="text-[var(--text-muted)]">(cheapest first)</span>
              </span>
              <Button variant="secondary" onClick={addVariantRow}>
                <PlusIcon className="h-3.5 w-3.5" />
                Add variant
              </Button>
            </div>

            {variantRows.map((row, idx) => (
              <div key={row.key} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    placeholder='Variant label, e.g. "Double, Foam, Grade A"'
                    value={row.label}
                    onChange={(e) => updateVariantRow(row.key, { label: e.target.value })}
                  />
                  <button
                    disabled={idx === 0}
                    onClick={() => moveVariantRow(row.key, -1)}
                    className="text-[var(--text-muted)] hover:text-[var(--series-1)] disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    disabled={idx === variantRows.length - 1}
                    onClick={() => moveVariantRow(row.key, 1)}
                    className="text-[var(--text-muted)] hover:text-[var(--series-1)] disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                  <button
                    disabled={variantRows.length === 1}
                    onClick={() => removeVariantRow(row.key)}
                    className="text-[var(--text-muted)] hover:text-[var(--status-critical)] disabled:opacity-30"
                    aria-label="Remove variant"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={inputClass}
                    placeholder="SKU / barcode (optional)"
                    value={row.sku}
                    onChange={(e) => updateVariantRow(row.key, { sku: e.target.value })}
                  />
                  <select
                    className={inputClass}
                    value={row.currency}
                    onChange={(e) => updateVariantRow(row.key, { currency: e.target.value as Currency })}
                  >
                    <option value="USD">USD</option>
                    <option value="LRD">LRD</option>
                  </select>
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Sell price"
                  className={inputClass}
                  value={row.sellPrice}
                  onFocus={selectOnFocus}
                  onChange={(e) => updateVariantRow(row.key, { sellPrice: Number(e.target.value) || 0 })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Stock — My Shop"
                    className={inputClass}
                    value={row.stockMyShop}
                    onFocus={selectOnFocus}
                    onChange={(e) => updateVariantRow(row.key, { stockMyShop: Number(e.target.value) || 0 })}
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Stock — Vishal's Shop"
                    className={inputClass}
                    value={row.stockVishalShop}
                    onFocus={selectOnFocus}
                    onChange={(e) => updateVariantRow(row.key, { stockVishalShop: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Low stock alert below"
                    className={inputClass}
                    value={row.lowStockThreshold}
                    onFocus={selectOnFocus}
                    onChange={(e) => updateVariantRow(row.key, { lowStockThreshold: Number(e.target.value) || 0 })}
                  />
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--page-plane)] px-2.5">
                    <Switch
                      checked={row.costUnknown}
                      onChange={(v) => updateVariantRow(row.key, { costUnknown: v, costPrice: v ? 0 : row.costPrice })}
                      label="Crossed cost price unknown"
                    />
                  </div>
                </div>
                {!row.costUnknown && (
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Crossed Cost Price"
                    className={inputClass}
                    value={row.costPrice}
                    onFocus={selectOnFocus}
                    onChange={(e) => updateVariantRow(row.key, { costPrice: Number(e.target.value) || 0 })}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            {editingProduct ? (
              <Button variant="danger" onClick={() => removeProduct(editingProduct)}>
                <TrashIcon className="h-4 w-4" />
                Delete product
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={saveProduct}>{editingProduct ? 'Save changes' : 'Add product'}</Button>
            </div>
          </div>
        </div>
      </Modal>

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
