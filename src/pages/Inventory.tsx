import { useMemo, useState, type ComponentType } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_CATEGORIES, UNIT_TYPES, type Product, type Variant, type Folder, type TransferDirection } from '../db'
import { Button, Modal, Field, inputClass, Pill, BottomSheet } from '../components/ui'
import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  MoreVerticalIcon,
  SortIcon,
  FilterIcon,
  BoxesIcon,
  ChartIcon,
  CheckSquareIcon,
  FolderIcon,
  GridIcon,
  ListViewIcon,
  RowsIcon,
  ImageStackIcon,
  WarningStackIcon,
  ChevronRightIcon,
  TrashIcon,
  EditIcon,
} from '../components/icons'
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
import { tokenSortKey } from '../lib/itemMatch'
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
type ViewMode = 'grid' | 'list' | 'compact' | 'wall' | 'stockAlert'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Product name (A-Z)' },
  { value: 'stockAsc', label: 'Inventory (lowest first)' },
  { value: 'stockDesc', label: 'Inventory (highest first)' },
  { value: 'dateAdded', label: 'Date added (newest first)' },
]

const VIEW_OPTIONS: { value: ViewMode; label: string; hint: string; Icon: ComponentType<{ className?: string }> }[] = [
  { value: 'grid', label: 'Grid', hint: 'Even square thumbnail cards', Icon: GridIcon },
  { value: 'list', label: 'List', hint: 'One row per item, name + stock', Icon: ListViewIcon },
  { value: 'compact', label: 'Compact Sheet', hint: 'Dense single-line rows, more per screen', Icon: RowsIcon },
  { value: 'wall', label: 'Thumbnail Wall', hint: 'Large photo-forward wall', Icon: ImageStackIcon },
  { value: 'stockAlert', label: 'Stock Alert View', hint: 'Lowest stock first, flagged in red', Icon: WarningStackIcon },
]

interface ProductViewProps {
  products: Product[]
  variantsByProduct: Map<number, Variant[]>
  selectMode: boolean
  selectedIds: Set<number>
  onTap: (id: number) => void
}

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
        selected ? 'border-black bg-black text-white' : 'border-gray-300'
      }`}
    >
      {selected && <CheckSquareIcon className="h-3.5 w-3.5" />}
    </span>
  )
}

// Even square thumbnail cards -- the smartphone-home-screen-style default
// for browsing a folder visually rather than reading a list.
function ProductGridView({ products, variantsByProduct, selectMode, selectedIds, onTap }: ProductViewProps) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {products.map((p) => {
        const available = availableOf(variantsByProduct.get(p.id!) ?? [])
        const selected = selectedIds.has(p.id!)
        return (
          <button
            key={p.id}
            onClick={() => onTap(p.id!)}
            className="relative flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 bg-gray-50 p-2 text-center"
          >
            {selectMode && (
              <span className="absolute left-1.5 top-1.5">
                <SelectMark selected={selected} />
              </span>
            )}
            <ItemThumb image={p.images[0]} size={64} className="!rounded-lg !bg-gray-200 !text-gray-400" />
            <span className="line-clamp-2 text-xs font-medium text-black">{p.name}</span>
            <span className="tabular text-[11px] text-gray-500">{available} avail.</span>
          </button>
        )
      })}
    </div>
  )
}

// One row per item -- the original default, name + stock/variant summary.
function ProductListView({ products, variantsByProduct, selectMode, selectedIds, onTap }: ProductViewProps) {
  return (
    <div className="flex flex-col">
      {products.map((product, idx) => {
        const variants = variantsByProduct.get(product.id!) ?? []
        const available = availableOf(variants)
        const selected = selectedIds.has(product.id!)
        return (
          <button
            key={product.id}
            onClick={() => onTap(product.id!)}
            className={`flex w-full items-center gap-3 py-3 text-left ${idx > 0 ? 'border-t border-gray-100' : ''}`}
          >
            {selectMode && <SelectMark selected={selected} />}
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
    </div>
  )
}

// Dense, no-thumbnail single-line rows -- maximizes how many items are
// visible on screen at once for fast scanning of a large catalog.
function ProductCompactView({ products, variantsByProduct, selectMode, selectedIds, onTap }: ProductViewProps) {
  return (
    <div className="flex flex-col">
      {products.map((product, idx) => {
        const available = availableOf(variantsByProduct.get(product.id!) ?? [])
        const selected = selectedIds.has(product.id!)
        return (
          <button
            key={product.id}
            onClick={() => onTap(product.id!)}
            className={`flex w-full items-center justify-between gap-2 py-1.5 text-left ${idx > 0 ? 'border-t border-gray-50' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {selectMode && <SelectMark selected={selected} />}
              <span className="truncate text-sm text-black">{product.name}</span>
            </span>
            <span className="tabular shrink-0 text-xs text-gray-500">{available}</span>
          </button>
        )
      })}
    </div>
  )
}

// Large photo-forward cards -- for catalogs where recognizing an item by
// its photo matters more than reading its name.
function ProductWallView({ products, variantsByProduct, selectMode, selectedIds, onTap }: ProductViewProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {products.map((p) => {
        const available = availableOf(variantsByProduct.get(p.id!) ?? [])
        const selected = selectedIds.has(p.id!)
        return (
          <button key={p.id} onClick={() => onTap(p.id!)} className="relative flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-gray-50 text-left">
            {selectMode && (
              <span className="absolute left-2 top-2 z-10">
                <SelectMark selected={selected} />
              </span>
            )}
            <ItemThumb image={p.images[0]} size={160} className="!h-40 !w-full !rounded-none !bg-gray-200 !text-gray-400" />
            <div className="p-2">
              <div className="line-clamp-1 text-sm font-semibold text-black">{p.name}</div>
              <div className="tabular text-xs text-gray-500">{available} available</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// Reordered lowest-stock-first regardless of the active sort, with low/no
// stock flagged in red -- a dedicated triage view for restocking decisions.
function ProductStockAlertView({ products, variantsByProduct, selectMode, selectedIds, onTap }: ProductViewProps) {
  const sorted = [...products].sort(
    (a, b) => availableOf(variantsByProduct.get(a.id!) ?? []) - availableOf(variantsByProduct.get(b.id!) ?? []),
  )
  return (
    <div className="flex flex-col">
      {sorted.map((product, idx) => {
        const variants = variantsByProduct.get(product.id!) ?? []
        const available = availableOf(variants)
        const low = variants.length === 0 || variants.some((v) => isLowStock(v.stockMyShop + v.stockVishalShop, v.lowStockThreshold))
        const selected = selectedIds.has(product.id!)
        return (
          <button
            key={product.id}
            onClick={() => onTap(product.id!)}
            className={`flex w-full items-center gap-3 py-3 text-left ${idx > 0 ? 'border-t border-gray-100' : ''} ${low ? 'bg-red-50' : ''}`}
          >
            {selectMode && <SelectMark selected={selected} />}
            <ItemThumb image={product.images[0]} size={44} className="!rounded-lg !bg-gray-100 !text-gray-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-black">{product.name}</div>
              <div className="truncate text-xs text-gray-500">{variants.length} variant{variants.length === 1 ? '' : 's'}</div>
            </div>
            <span className={`tabular shrink-0 text-sm font-bold ${low ? 'text-red-600' : 'text-gray-700'}`}>{available}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function Inventory() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const allVariants = useLiveQuery(() => db.variants.toArray(), [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const folders = useLiveQuery(() => db.folders.toArray(), [])

  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState<Chip>('all')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [viewSheetOpen, setViewSheetOpen] = useState(false)

  // Nested, smartphone-home-screen-style folders: which folder we're
  // currently browsing (null = top level of the catalog).
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
  const [newFolderSheetOpen, setNewFolderSheetOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderThumb, setNewFolderThumb] = useState<Blob | undefined>(undefined)
  const [folderEditTarget, setFolderEditTarget] = useState<Folder | null>(null)
  const [folderEditName, setFolderEditName] = useState('')
  const [moveFolderSheetOpen, setMoveFolderSheetOpen] = useState(false)
  const [moveFolderQuery, setMoveFolderQuery] = useState('')

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

  const foldersById = useMemo(() => new Map((folders ?? []).map((f) => [f.id!, f])), [folders])

  // The chain of folders from the top level down to the one we're currently
  // browsing, for the breadcrumb trail.
  const breadcrumb = useMemo(() => {
    const chain: Folder[] = []
    let cur = currentFolderId != null ? foldersById.get(currentFolderId) : undefined
    while (cur) {
      chain.unshift(cur)
      cur = cur.parentId != null ? foldersById.get(cur.parentId) : undefined
    }
    return chain
  }, [currentFolderId, foldersById])

  function folderPath(folder: Folder): string {
    const parts = [folder.name]
    let cur = folder.parentId != null ? foldersById.get(folder.parentId) : undefined
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId != null ? foldersById.get(cur.parentId) : undefined
    }
    return parts.join(' / ')
  }

  // Subfolders of the folder currently being browsed, always alphabetical --
  // hidden while actively searching, since search reaches across the whole
  // catalog rather than staying scoped to one folder (like a phone's
  // spotlight search vs. browsing one home screen at a time).
  const foldersHere = useMemo(() => {
    if (query.trim()) return []
    return (folders ?? []).filter((f) => f.parentId === currentFolderId).sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, currentFolderId, query])

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name) return
    const now = Date.now()
    const siblingCount = (folders ?? []).filter((f) => f.parentId === currentFolderId).length
    await db.folders.add({ name, parentId: currentFolderId, thumbnail: newFolderThumb, order: siblingCount, createdAt: now, updatedAt: now })
    setNewFolderSheetOpen(false)
    setNewFolderName('')
    setNewFolderThumb(undefined)
  }

  function openFolderEdit(folder: Folder) {
    setFolderEditTarget(folder)
    setFolderEditName(folder.name)
  }

  async function saveFolderEdit(thumbnail?: Blob) {
    if (!folderEditTarget) return
    await db.folders.update(folderEditTarget.id!, {
      name: folderEditName.trim() || folderEditTarget.name,
      ...(thumbnail !== undefined ? { thumbnail } : {}),
      updatedAt: Date.now(),
    })
    setFolderEditTarget(null)
  }

  async function deleteFolderTarget() {
    if (!folderEditTarget) return
    const hasChildren = (folders ?? []).some((f) => f.parentId === folderEditTarget.id)
    const hasProducts = (products ?? []).some((p) => p.folderId === folderEditTarget.id)
    if (hasChildren || hasProducts) {
      alert('Move or remove everything inside this folder first.')
      return
    }
    await db.folders.delete(folderEditTarget.id!)
    setFolderEditTarget(null)
  }

  async function moveSelectedToFolder(folderId: number | null) {
    const ids = Array.from(selectedIds)
    await db.transaction('rw', db.products, async () => {
      for (const id of ids) {
        await db.products.update(id, { folderId: folderId ?? undefined, updatedAt: Date.now() })
      }
    })
    setMoveFolderSheetOpen(false)
    exitSelectMode()
  }

  // Duplicate Syntax Inversion Resolver: flags products whose names are the
  // same words in a different order (e.g. "4 inch nail" / "nail 4 inch") so
  // they can be reviewed and merged. Detection is purely a read-only scan of
  // the catalog -- the actual merge reuses mergeSelectedIntoGroup(), which
  // only reparents variants (keeping their IDs, so past Sale rows stay
  // exactly as recorded) and never touches db.sales.
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, Product[]>()
    for (const p of products ?? []) {
      if (p.archived) continue
      const key = tokenSortKey(p.name)
      if (!key) continue
      const list = byKey.get(key) ?? []
      list.push(p)
      byKey.set(key, list)
    }
    return Array.from(byKey.values()).filter((list) => list.length > 1)
  }, [products])
  const [dismissedDuplicateKeys, setDismissedDuplicateKeys] = useState<Set<string>>(new Set())
  const visibleDuplicateGroups = duplicateGroups.filter((g) => !dismissedDuplicateKeys.has(tokenSortKey(g[0].name)))

  function reviewDuplicateGroup(group: Product[]) {
    setSelectedIds(new Set(group.map((p) => p.id!)))
    setGroupTarget(group[0].id!)
    setSelectMode(true)
    setGroupSheetOpen(true)
  }

  function dismissDuplicateGroup(group: Product[]) {
    setDismissedDuplicateKeys((prev) => new Set(prev).add(tokenSortKey(group[0].name)))
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

    // Scoped to the folder being browsed unless there's an active search,
    // which reaches across the whole catalog regardless of folder.
    if (!query.trim()) {
      list = list.filter((p) => (p.folderId ?? null) === currentFolderId)
    }

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
  }, [products, query, activeChip, categoryFilter, sourceLocationFilter, priceBaselineFilter, sortBy, variantsByProduct, currentFolderId])

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
          <button onClick={() => setViewSheetOpen(true)} className={shopifyIconButtonClass} aria-label="View mode" title="View mode">
            <GridIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Folder breadcrumb -- hidden while a search reaches across the
            whole catalog, since that flattens past folder boundaries. */}
        {!query.trim() && (
          <div className="flex items-center gap-1 overflow-x-auto text-sm text-gray-500">
            <button onClick={() => setCurrentFolderId(null)} className={`shrink-0 font-medium ${currentFolderId === null ? 'text-black' : 'hover:text-black'}`}>
              All Products
            </button>
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex shrink-0 items-center gap-1">
                <ChevronRightIcon className="h-3.5 w-3.5 text-gray-300" />
                <button
                  onClick={() => setCurrentFolderId(f.id!)}
                  className={`font-medium ${currentFolderId === f.id ? 'text-black' : 'hover:text-black'}`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {CHIPS.map((chip) => (
            <button key={chip.key} onClick={() => setActiveChip(chip.key)} className={shopifyChipClass(activeChip === chip.key)}>
              {chip.label}
              {chip.count > 0 ? ` (${chip.count})` : ''}
            </button>
          ))}
        </div>

        {!selectMode && visibleDuplicateGroups.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-amber-800">
              {visibleDuplicateGroups.length} possible duplicate item{visibleDuplicateGroups.length === 1 ? '' : 's'} found
            </span>
            {visibleDuplicateGroups.map((group) => (
              <div key={tokenSortKey(group[0].name)} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                <span className="min-w-0 truncate text-xs text-gray-700">{group.map((p) => p.name).join('  ·  ')}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => dismissDuplicateGroup(group)} className="text-xs font-medium text-gray-400">
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

        {selectMode && (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
            <div className="flex items-center gap-3">
              <button onClick={exitSelectMode} className="text-sm font-medium text-gray-500">Cancel</button>
              <button
                onClick={() => setMoveFolderSheetOpen(true)}
                disabled={selectedIds.size === 0}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-30"
              >
                Move…
              </button>
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

        {!query.trim() && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-black">Folders</h2>
              <button onClick={() => setNewFolderSheetOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                <PlusIcon className="h-3.5 w-3.5" />
                New Folder
              </button>
            </div>
            {foldersHere.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {foldersHere.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => setCurrentFolderId(folder.id!)}
                    className="relative flex flex-col items-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-center"
                  >
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        openFolderEdit(folder)
                      }}
                      role="button"
                      aria-label="Edit folder"
                      className="absolute right-1 top-1 rounded-full p-1 text-blue-400 hover:bg-blue-100"
                    >
                      <EditIcon className="h-3 w-3" />
                    </span>
                    {folder.thumbnail ? (
                      <ItemThumb image={folder.thumbnail} size={56} className="!rounded-lg" />
                    ) : (
                      <FolderIcon className="h-10 w-10 text-blue-500" />
                    )}
                    <span className="line-clamp-2 text-xs font-semibold text-blue-900">{folder.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === 'grid' && (
          <ProductGridView
            products={filtered}
            variantsByProduct={variantsByProduct}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onTap={(id) => (selectMode ? toggleSelected(id) : setDetailProductId(id))}
          />
        )}
        {viewMode === 'list' && (
          <ProductListView
            products={filtered}
            variantsByProduct={variantsByProduct}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onTap={(id) => (selectMode ? toggleSelected(id) : setDetailProductId(id))}
          />
        )}
        {viewMode === 'compact' && (
          <ProductCompactView
            products={filtered}
            variantsByProduct={variantsByProduct}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onTap={(id) => (selectMode ? toggleSelected(id) : setDetailProductId(id))}
          />
        )}
        {viewMode === 'wall' && (
          <ProductWallView
            products={filtered}
            variantsByProduct={variantsByProduct}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onTap={(id) => (selectMode ? toggleSelected(id) : setDetailProductId(id))}
          />
        )}
        {viewMode === 'stockAlert' && (
          <ProductStockAlertView
            products={filtered}
            variantsByProduct={variantsByProduct}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onTap={(id) => (selectMode ? toggleSelected(id) : setDetailProductId(id))}
          />
        )}
        {filtered.length === 0 && foldersHere.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">No products match. Tap + above to add one.</p>
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

      {/* View mode -- the 5-way layout switcher */}
      <BottomSheet open={viewSheetOpen} onClose={() => setViewSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold text-gray-500">View</h2>
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setViewMode(opt.value)
                setViewSheetOpen(false)
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-gray-50"
            >
              <opt.Icon className="h-5 w-5 shrink-0 text-gray-500" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-black">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
              {viewMode === opt.value && <span className="text-black">✓</span>}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* New Folder */}
      <BottomSheet open={newFolderSheetOpen} onClose={() => setNewFolderSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold">
            New folder{breadcrumb.length > 0 ? ` in ${breadcrumb[breadcrumb.length - 1].name}` : ''}
          </h2>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              {newFolderThumb ? (
                <ItemThumb image={newFolderThumb} size={56} className="!rounded-lg" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400">
                  <FolderIcon className="h-6 w-6" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setNewFolderThumb(f)
                }}
              />
            </label>
            <input
              autoFocus
              className={shopifyInputClass + ' flex-1'}
              placeholder="Folder name, e.g. Mattresses"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
          </div>
          <button
            onClick={createFolder}
            disabled={!newFolderName.trim()}
            className="mt-1 w-full rounded-lg bg-black py-2.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            Create folder
          </button>
        </div>
      </BottomSheet>

      {/* Edit / rename / delete a folder */}
      <BottomSheet open={folderEditTarget != null} onClose={() => setFolderEditTarget(null)} contentClassName="!bg-white !text-black">
        {folderEditTarget && (
          <div className="flex flex-col gap-3 pt-2">
            <h2 className="text-base font-semibold">Edit folder</h2>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                {folderEditTarget.thumbnail ? (
                  <ItemThumb image={folderEditTarget.thumbnail} size={56} className="!rounded-lg" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400">
                    <FolderIcon className="h-6 w-6" />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) saveFolderEdit(f)
                  }}
                />
              </label>
              <input
                className={shopifyInputClass + ' flex-1'}
                value={folderEditName}
                onChange={(e) => setFolderEditName(e.target.value)}
              />
            </div>
            <div className="mt-1 flex gap-2">
              <button onClick={() => deleteFolderTarget()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600">
                <TrashIcon className="h-4 w-4" />
                Delete
              </button>
              <button onClick={() => saveFolderEdit()} className="flex-1 rounded-lg bg-black py-2.5 text-sm font-semibold text-white">
                Save
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Move selected products into a folder */}
      <BottomSheet open={moveFolderSheetOpen} onClose={() => setMoveFolderSheetOpen(false)} contentClassName="!bg-white !text-black">
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold">Move {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'}</h2>
          <input
            className={shopifyInputClass}
            placeholder="Search folders"
            value={moveFolderQuery}
            onChange={(e) => setMoveFolderQuery(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100">
            <button onClick={() => moveSelectedToFolder(null)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium hover:bg-gray-50">
              <FolderIcon className="h-4 w-4 text-gray-400" />
              All Products (top level)
            </button>
            {(folders ?? [])
              .filter((f) => folderPath(f).toLowerCase().includes(moveFolderQuery.toLowerCase()))
              .sort((a, b) => folderPath(a).localeCompare(folderPath(b)))
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => moveSelectedToFolder(f.id!)}
                  className="flex w-full items-center gap-2.5 border-t border-gray-100 px-3 py-2.5 text-left text-sm hover:bg-gray-50"
                >
                  <FolderIcon className="h-4 w-4 text-blue-400" />
                  {folderPath(f)}
                </button>
              ))}
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
              setMoreMenuOpen(false)
              setViewSheetOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-black hover:bg-gray-50"
          >
            <ChartIcon className="h-5 w-5 text-gray-500" />
            Change view
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
          defaultFolderId={currentFolderId}
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
