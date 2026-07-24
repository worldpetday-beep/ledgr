import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES, UNIT_TYPES, type Product, type Variant, type TransferDirection } from '../db'
import { Button, Modal, Field, inputClass, Pill, BottomSheet } from '../components/ui'
import { PlusIcon, SearchIcon, SettingsIcon, MoreVerticalIcon, SortIcon, FilterIcon, BoxesIcon, ChartIcon, CheckSquareIcon } from '../components/icons'
import { ItemThumb } from '../components/ItemThumb'
import { ProductDetailView } from '../components/ProductDetailView'
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

  const [detailProductId, setDetailProductId] = useState<number | 'new' | null>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  const [groupTarget, setGroupTarget] = useState<'new' | number>('new')
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

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  // Merges the selected quick-sale/raw-text products into one master
  // product: each source product's variant(s) are reparented (their IDs are
  // kept, so past Sale rows referencing them stay intact) and, if a variant
  // still has the generic "Standard" label, renamed to the exact string the
  // source product was originally typed as -- then the now-empty source
  // product shell is deleted.
  async function mergeSelectedIntoGroup() {
    const sourceIds = Array.from(selectedIds)
    if (sourceIds.length === 0) return
    const now = Date.now()

    await db.transaction('rw', db.products, db.variants, async () => {
      let targetId: number
      if (groupTarget === 'new') {
        const name = groupNewName.trim()
        if (!name) return
        targetId = (await db.products.add({
          name,
          category: 'General',
          description: '',
          images: [],
          options: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        })) as number
      } else {
        targetId = groupTarget
      }

      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue
        const source = await db.products.get(sourceId)
        if (!source) continue
        const vs = await db.variants.where('productId').equals(sourceId).toArray()
        for (const v of vs) {
          const label = v.label === 'Standard' ? source.name : `${source.name} — ${v.label}`
          await db.variants.update(v.id!, { productId: targetId, label, updatedAt: now })
        }
        await db.products.delete(sourceId)
      }
    })

    setGroupSheetOpen(false)
    setGroupNewName('')
    setGroupTarget('new')
    exitSelectMode()
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
          <ShopifyHeaderIconButton onClick={() => setDetailProductId('new')} label="Add product">
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

        {selectMode && (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
            <div className="flex items-center gap-3">
              <button onClick={exitSelectMode} className="text-sm font-medium text-gray-500">Cancel</button>
              <button
                onClick={() => setGroupSheetOpen(true)}
                disabled={selectedIds.size === 0}
                className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-30"
              >
                Group…
              </button>
            </div>
          </div>
        )}

        {view === 'list' ? (
          <div className="flex flex-col">
            {filtered.map((product, idx) => {
              const variants = variantsByProduct.get(product.id!) ?? []
              const available = availableOf(variants)
              const selected = selectedIds.has(product.id!)
              return (
                <button
                  key={product.id}
                  onClick={() => (selectMode ? toggleSelected(product.id!) : setDetailProductId(product.id!))}
                  className={`flex w-full items-center gap-3 py-3 text-left ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  {selectMode && (
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                        selected ? 'border-black bg-black text-white' : 'border-gray-300'
                      }`}
                    >
                      {selected && <CheckSquareIcon className="h-3.5 w-3.5" />}
                    </span>
                  )}
                  <ItemThumb image={product.images[0]} size={48} className="!rounded-lg !bg-gray-100 !text-gray-400" />
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
                          onClick={() => setDetailProductId(product.id!)}
                          style={{ borderColor: toneColor, transform: `scale(${scale})`, transformOrigin: 'center' }}
                          className="flex min-w-[110px] flex-col items-center gap-1.5 rounded-xl border-2 bg-gray-50 px-3 py-2.5 text-center transition-transform"
                        >
                          <ItemThumb image={product.images[0]} size={36} className="!bg-gray-200 !text-gray-400" />
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
              setSelectMode(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <CheckSquareIcon className="h-5 w-5 text-gray-500" />
            Select items to group
          </button>
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

      {/* Group selected raw-text items into one master product */}
      <BottomSheet open={groupSheetOpen} onClose={() => setGroupSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold">Group {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}</h2>
          <p className="text-xs text-gray-500">
            Each selected item becomes its own variant under one master product — nothing is deleted, just reorganized.
          </p>

          <div className="flex gap-2">
            <button onClick={() => setGroupTarget('new')} className={shopifyChipClass(groupTarget === 'new') + ' flex-1'}>
              New group
            </button>
            <button onClick={() => setGroupTarget(typeof groupTarget === 'number' ? groupTarget : -1)} className={shopifyChipClass(typeof groupTarget === 'number') + ' flex-1'}>
              Existing product
            </button>
          </div>

          {groupTarget === 'new' ? (
            <input
              autoFocus
              className={shopifyInputClass}
              placeholder="Master group name, e.g. Mattress Group"
              value={groupNewName}
              onChange={(e) => setGroupNewName(e.target.value)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <input
                className={shopifyInputClass}
                placeholder="Search products"
                value={groupTargetQuery}
                onChange={(e) => setGroupTargetQuery(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                {(products ?? [])
                  .filter((p) => !selectedIds.has(p.id!) && p.name.toLowerCase().includes(groupTargetQuery.toLowerCase()))
                  .slice(0, 20)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setGroupTarget(p.id!)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                        groupTarget === p.id ? 'bg-gray-100 font-medium' : ''
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
            className="mt-1 w-full rounded-lg bg-black py-2.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            Group items
          </button>
        </div>
      </BottomSheet>

      {detailProductId != null && (
        <ProductDetailView
          productId={detailProductId === 'new' ? undefined : detailProductId}
          onClose={() => setDetailProductId(null)}
        />
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
