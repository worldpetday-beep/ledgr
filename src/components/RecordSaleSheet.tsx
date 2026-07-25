import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  reserveNextCustomerNumber,
  reserveNextOrderNumber,
  saveCustomUnit,
  UNIT_TYPES,
  type Currency,
  type Category,
  type Product,
  type Variant,
  type FulfillmentLocation,
} from '../db'
import { BottomSheet, Button, Field, inputClass, Badge, Pill, Switch } from './ui'
import { LedgerPushReviewPanel, type TicketLineSummary } from './LedgerPushReviewPanel'
import { ItemThumb } from './ItemThumb'
import { SearchIcon, PlusIcon, TrashIcon } from './icons'
import { money, selectOnFocus, dateKeyMonrovia } from '../lib/format'
import { itemSearchMatches } from '../lib/itemMatch'

interface ItemBlock {
  key: string
  qty: number
  unitType: string
  customUnit: string
  query: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  usdAmount: string
  lrdAmount: string
}

function blankItem(): ItemBlock {
  return {
    key: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    qty: 1,
    unitType: 'Piece',
    customUnit: '',
    query: '',
    selectedProduct: null,
    selectedVariantId: null,
    usdAmount: '',
    lrdAmount: '',
  }
}

interface ItemSuggestion {
  key: string
  product: Product
  variant: Variant | null
  label: string
}

function unitLabel(item: { unitType: string; customUnit: string }): string {
  return item.unitType === 'Other' ? item.customUnit.trim() || 'unit' : item.unitType
}

// Bulk Book View: one independent customer session stacked in the same
// modal. Rows reuse the ItemBlock shape (qty + free-text description via
// `query`) -- bulk rows never carry their own price, only the ticket-level
// total, so `usdAmount`/`lrdAmount` stay unused placeholders here.
interface BulkTicket {
  key: string
  rows: ItemBlock[]
  totalLrd: string
  totalUsd: string
  lastAddedRowKey: string | null
}

function blankBulkTicket(): BulkTicket {
  const row = blankItem()
  return { key: `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}`, rows: [row], totalLrd: '', totalUsd: '', lastAddedRowKey: row.key }
}

// One item's Quantity -> Item Name -> (optional per-item price) block.
// Pressing Enter anywhere in here never loops back to a fresh item and
// never auto-accepts a fuzzy suggestion -- it submits the whole ticket
// straight to the Ledger Push Review Panel with exactly the text on
// screen. The only way to add another item is the explicit "Add Item"
// button in the parent.
function ItemEntryBlock({
  item,
  index,
  canRemove,
  autoFocus,
  products,
  variantsByProduct,
  productStock,
  categories,
  savedQualifiers,
  onUpdate,
  onRemove,
  onSubmitTicket,
}: {
  item: ItemBlock
  index: number
  canRemove: boolean
  autoFocus: boolean
  products: Product[]
  variantsByProduct: Map<number, Variant[]>
  productStock: Map<number, number>
  categories: Category[]
  savedQualifiers: string[]
  onUpdate: (patch: Partial<ItemBlock>) => void
  onRemove: () => void
  onSubmitTicket: () => void
}) {
  const qtyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) qtyRef.current?.focus()
  }, [autoFocus])

  const categoryAllowedUnits = useMemo(() => {
    const categoryName = item.selectedProduct?.category ?? 'General'
    const cat = categories.find((c) => c.name === categoryName)
    return cat?.allowedUnits && cat.allowedUnits.length > 0 ? cat.allowedUnits : null
  }, [categories, item.selectedProduct])
  // A previously-typed custom qualifier ("bag", "roll", ...) renders as a
  // permanent pill right alongside the built-in unit types from now on —
  // only when the category hasn't already restricted the choices.
  const availableUnits = categoryAllowedUnits
    ? categoryAllowedUnits.includes('Other')
      ? categoryAllowedUnits
      : [...categoryAllowedUnits, 'Other']
    : [...UNIT_TYPES.filter((u) => u !== 'Other'), ...savedQualifiers, 'Other']

  // Vocabulary the "Other" custom-unit field type-aheads against: built-in
  // units plus every qualifier saved from a previous sale.
  const qualifierVocabulary = useMemo(
    () => [...UNIT_TYPES.filter((u) => u !== 'Other'), ...savedQualifiers],
    [savedQualifiers],
  )
  const customUnitMatch = useMemo(() => {
    const q = item.customUnit.trim().toLowerCase()
    if (!q) return null
    return qualifierVocabulary.find((u) => u.toLowerCase().startsWith(q) && u.toLowerCase() !== q) ?? null
  }, [item.customUnit, qualifierVocabulary])

  function commitCustomUnit() {
    const clean = item.customUnit.trim()
    if (clean) saveCustomUnit(clean).catch(() => {})
  }

  function applyQualifierMatch(match: string) {
    onUpdate({ unitType: match, customUnit: '' })
  }

  const itemSuggestions = useMemo<ItemSuggestion[]>(() => {
    const q = item.query.trim()
    if (!q) return []
    const results: ItemSuggestion[] = []
    for (const p of products) {
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.length <= 1) {
        const v = variants[0] ?? null
        const label = v && v.label !== 'Standard' ? `${p.name} — ${v.label}` : p.name
        if (itemSearchMatches(label, q)) results.push({ key: `${p.id}-${v?.id ?? 'none'}`, product: p, variant: v, label })
      } else {
        for (const v of variants) {
          const label = `${p.name} — ${v.label}`
          if (itemSearchMatches(label, q) || itemSearchMatches(p.name, q)) {
            results.push({ key: `${p.id}-${v.id}`, product: p, variant: v, label })
          }
        }
      }
    }
    return results.slice(0, 8)
  }, [products, variantsByProduct, item.query])

  function pickSuggestion(s: ItemSuggestion) {
    onUpdate({ selectedProduct: s.product, selectedVariantId: s.variant?.id ?? null, query: s.label })
  }

  function onEnterSubmit(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmitTicket()
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Item {index + 1}</span>
        {canRemove && (
          <button onClick={onRemove} aria-label="Remove item" className="text-[var(--text-muted)] hover:text-[var(--status-critical)]">
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={qtyRef}
          type="number"
          inputMode="numeric"
          min={1}
          className="tabular w-16 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-2 py-2 text-center text-base font-semibold outline-none focus:border-[var(--series-1)]"
          value={item.qty}
          onFocus={selectOnFocus}
          onChange={(e) => onUpdate({ qty: Number(e.target.value) || 1 })}
          onKeyDown={onEnterSubmit}
        />
        {item.selectedProduct && <ItemThumb image={item.selectedProduct.images[0]} size={32} />}
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className={inputClass + ' pl-9'}
            placeholder="Item name"
            value={item.query}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => onUpdate({ query: e.target.value, selectedProduct: null, selectedVariantId: null })}
            onKeyDown={onEnterSubmit}
          />
          {/* Suggestions are only ever applied by an explicit tap/click below
              -- Enter always keeps the raw typed text, never a close match. */}
          {item.query && !item.selectedProduct && itemSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
              {itemSuggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--page-plane)]"
                >
                  <ItemThumb image={s.product.images[0]} size={28} />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="tabular text-xs text-[var(--text-muted)]">
                    {(s.variant ? s.variant.stockMyShop + s.variant.stockVishalShop : productStock.get(s.product.id!)) ?? 0} in stock
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!item.selectedProduct && item.query && (
        <span className="mt-1 block text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {availableUnits.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => onUpdate({ unitType: u })}
            className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              item.unitType === u
                ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
            }`}
          >
            {u}
          </button>
        ))}
      </div>
      {item.unitType === 'Other' && (
        <div className="mt-1.5">
          <input
            className={inputClass}
            placeholder="Custom unit"
            value={item.customUnit}
            onChange={(e) => onUpdate({ customUnit: e.target.value })}
            onBlur={commitCustomUnit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustomUnit()
              onEnterSubmit(e)
            }}
          />
          {/* Closest vocabulary match as you type -- tapping it applies the
              match without ever blurring/refocusing the text field mid-type,
              so the on-screen keyboard never collapses while evaluating. */}
          {customUnitMatch && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyQualifierMatch(customUnitMatch)}
              className="mt-1 rounded-md bg-[var(--page-plane)] px-2 py-1 text-xs font-medium text-[var(--series-1)]"
            >
              Use "{customUnitMatch}"?
            </button>
          )}
        </div>
      )}

      {/* Per-item price is strictly optional -- the normal flow is to leave
          this blank for every item and enter one ticket total below. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="LRD (optional)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            placeholder="0.00"
            value={item.lrdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => onUpdate({ lrdAmount: e.target.value })}
            onKeyDown={onEnterSubmit}
          />
        </Field>
        <Field label="USD (optional)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            placeholder="0.00"
            value={item.usdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => onUpdate({ usdAmount: e.target.value })}
            onKeyDown={onEnterSubmit}
          />
        </Field>
      </div>
    </div>
  )
}

// One customer's inline "Bulk Book View" ticket: a stack of Quantity +
// Item Description rows (no per-row price), a '+' to append another row
// below, and the ticket's own LRD/USD total sitting flush beneath the
// lowest row. Enter always drives focus forward -- qty -> description ->
// (next row's qty, or the totals once the last row is reached) -- and never
// creates a row itself; only the '+' button does that.
function BulkTicketCard({
  ticket,
  ticketIndex,
  canRemove,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onUpdateTotals,
  onRemoveTicket,
  onSubmitTicket,
}: {
  ticket: BulkTicket
  ticketIndex: number
  canRemove: boolean
  onUpdateRow: (rowKey: string, patch: Partial<ItemBlock>) => void
  onAddRow: () => void
  onRemoveRow: (rowKey: string) => void
  onUpdateTotals: (patch: Partial<Pick<BulkTicket, 'totalLrd' | 'totalUsd'>>) => void
  onRemoveTicket: () => void
  onSubmitTicket: () => void
}) {
  const qtyRefs = useRef(new Map<string, HTMLInputElement>())
  const totalLrdRef = useRef<HTMLInputElement>(null)
  const totalUsdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ticket.lastAddedRowKey) qtyRefs.current.get(ticket.lastAddedRowKey)?.focus()
  }, [ticket.lastAddedRowKey])

  const descRefs = useRef(new Map<string, HTMLInputElement>())

  function onQtyEnter(e: KeyboardEvent, rowKey: string) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    descRefs.current.get(rowKey)?.focus()
  }

  function onDescriptionEnter(e: KeyboardEvent, rowIndex: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (rowIndex === ticket.rows.length - 1) {
      totalLrdRef.current?.focus()
    } else {
      qtyRefs.current.get(ticket.rows[rowIndex + 1].key)?.focus()
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Customer Ticket {ticketIndex + 1}</span>
        {canRemove && (
          <button onClick={onRemoveTicket} aria-label="Remove ticket" className="text-[var(--text-muted)] hover:text-[var(--status-critical)]">
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {ticket.rows.map((row, i) => (
          <div key={row.key} className="flex items-center gap-2">
            <input
              ref={(el) => {
                if (el) qtyRefs.current.set(row.key, el)
                else qtyRefs.current.delete(row.key)
              }}
              type="number"
              inputMode="numeric"
              min={1}
              className="tabular w-14 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-2 py-2 text-center text-sm font-semibold outline-none focus:border-[var(--series-1)]"
              value={row.qty}
              onFocus={selectOnFocus}
              onChange={(e) => onUpdateRow(row.key, { qty: Number(e.target.value) || 1 })}
              onKeyDown={(e) => onQtyEnter(e, row.key)}
            />
            <input
              ref={(el) => {
                if (el) descRefs.current.set(row.key, el)
                else descRefs.current.delete(row.key)
              }}
              className={inputClass + ' flex-1'}
              placeholder="Item description"
              value={row.query}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => onUpdateRow(row.key, { query: e.target.value })}
              onKeyDown={(e) => onDescriptionEnter(e, i)}
            />
            {i === ticket.rows.length - 1 ? (
              <button
                type="button"
                onClick={onAddRow}
                aria-label="Add row"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--series-1)] text-white"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            ) : (
              ticket.rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveRow(row.key)}
                  aria-label="Remove row"
                  className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--text-muted)] hover:text-[var(--status-critical)]"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {/* Sits flush beneath the lowest row and shifts down with it
          naturally as rows are appended -- LRD first, per the shop's own
          ledger convention. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Total LRD">
          <input
            ref={totalLrdRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            placeholder="0.00"
            value={ticket.totalLrd}
            onFocus={selectOnFocus}
            onChange={(e) => onUpdateTotals({ totalLrd: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                totalUsdRef.current?.focus()
              }
            }}
          />
        </Field>
        <Field label="Total USD">
          <input
            ref={totalUsdRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            placeholder="0.00"
            value={ticket.totalUsd}
            onFocus={selectOnFocus}
            onChange={(e) => onUpdateTotals({ totalUsd: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmitTicket()
              }
            }}
          />
        </Field>
      </div>
    </div>
  )
}

export function RecordSaleSheet({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean
  onClose: () => void
  onSaved: (summary: string) => void
  onError: (message: string) => void
}) {
  // Gated on `open` so this globally-mounted sheet doesn't keep subscribing
  // to these tables (and re-running on every write) while it's hidden.
  const products = useLiveQuery(() => (open ? db.products.orderBy('name').toArray() : []), [open])
  const allVariants = useLiveQuery(() => (open ? db.variants.toArray() : []), [open])
  const categories = useLiveQuery(() => (open ? db.categories.toArray() : []), [open])
  const savedQualifierRows = useLiveQuery(() => (open ? db.customUnits.orderBy('label').toArray() : []), [open])
  const savedQualifiers = useMemo(() => (savedQualifierRows ?? []).map((r) => r.label), [savedQualifierRows])

  const [viewMode, setViewMode] = useState<'single' | 'bulk'>('single')
  const [items, setItems] = useState<ItemBlock[]>([blankItem()])
  const [location, setLocation] = useState<FulfillmentLocation>('myShop')
  const [totalLrd, setTotalLrd] = useState('')
  const [totalUsd, setTotalUsd] = useState('')
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null)
  const [bulkTickets, setBulkTickets] = useState<BulkTicket[]>([blankBulkTicket()])
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  // Reset the whole sheet each time it's opened fresh.
  useEffect(() => {
    if (open) {
      const first = blankItem()
      setViewMode('single')
      setItems([first])
      setLocation('myShop')
      setTotalLrd('')
      setTotalUsd('')
      setLastAddedKey(first.key)
      setSameAsLast(false)
      setTbs(false)
      setSaveError(null)
      setSaving(false)
      setReviewOpen(false)
      setBulkTickets([blankBulkTicket()])
    }
  }, [open])

  // One history entry for the sheet's lifetime: a hardware/gesture "back"
  // closes the Ledger Push Review Panel if it's open, otherwise closes the
  // whole sheet, instead of leaving the app.
  const reviewOpenRef = useRef(reviewOpen)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    window.history.pushState({ ledgrRecordSale: true }, '')
    let pushed = true

    function onPopState() {
      if (reviewOpenRef.current) {
        window.history.pushState({ ledgrRecordSale: true }, '')
        setReviewOpen(false)
      } else {
        pushed = false
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (pushed) window.history.back()
    }
  }, [open])

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

  const productStock = useMemo(() => {
    const map = new Map<number, number>()
    for (const [productId, list] of variantsByProduct.entries()) {
      map.set(productId, list.reduce((sum, v) => sum + v.stockMyShop + v.stockVishalShop, 0))
    }
    return map
  }, [variantsByProduct])

  function updateItem(key: string, patch: Partial<ItemBlock>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  function addItem() {
    const fresh = blankItem()
    setItems((prev) => [...prev, fresh])
    setLastAddedKey(fresh.key)
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev))
  }

  function updateBulkRow(ticketKey: string, rowKey: string, patch: Partial<ItemBlock>) {
    setBulkTickets((prev) =>
      prev.map((t) => (t.key === ticketKey ? { ...t, rows: t.rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) } : t)),
    )
  }

  function addBulkRow(ticketKey: string) {
    setBulkTickets((prev) =>
      prev.map((t) => {
        if (t.key !== ticketKey) return t
        const fresh = blankItem()
        return { ...t, rows: [...t.rows, fresh], lastAddedRowKey: fresh.key }
      }),
    )
  }

  function removeBulkRow(ticketKey: string, rowKey: string) {
    setBulkTickets((prev) =>
      prev.map((t) => (t.key === ticketKey ? { ...t, rows: t.rows.length > 1 ? t.rows.filter((r) => r.key !== rowKey) : t.rows } : t)),
    )
  }

  function updateBulkTotals(ticketKey: string, patch: Partial<Pick<BulkTicket, 'totalLrd' | 'totalUsd'>>) {
    setBulkTickets((prev) => prev.map((t) => (t.key === ticketKey ? { ...t, ...patch } : t)))
  }

  function addBulkTicket() {
    setBulkTickets((prev) => [...prev, blankBulkTicket()])
  }

  function removeBulkTicket(ticketKey: string) {
    setBulkTickets((prev) => (prev.length > 1 ? prev.filter((t) => t.key !== ticketKey) : prev))
  }

  const anyPerItemAmount = items.some((it) => (Number(it.lrdAmount) || 0) > 0 || (Number(it.usdAmount) || 0) > 0)
  const itemsGrandLrd = items.reduce((s, it) => s + (Number(it.lrdAmount) || 0), 0)
  const itemsGrandUsd = items.reduce((s, it) => s + (Number(it.usdAmount) || 0), 0)
  const totalLrdNum = Number(totalLrd) || 0
  const totalUsdNum = Number(totalUsd) || 0
  const singleGrandLrd = anyPerItemAmount ? itemsGrandLrd : totalLrdNum
  const singleGrandUsd = anyPerItemAmount ? itemsGrandUsd : totalUsdNum

  const bulkGrandLrd = bulkTickets.reduce((s, t) => s + (Number(t.totalLrd) || 0), 0)
  const bulkGrandUsd = bulkTickets.reduce((s, t) => s + (Number(t.totalUsd) || 0), 0)

  const grandLrd = viewMode === 'bulk' ? bulkGrandLrd : singleGrandLrd
  const grandUsd = viewMode === 'bulk' ? bulkGrandUsd : singleGrandUsd
  const grandTotalParts: string[] = []
  if (grandLrd > 0) grandTotalParts.push(money(grandLrd, 'LRD'))
  if (grandUsd > 0) grandTotalParts.push(money(grandUsd, 'USD'))
  const grandTotal = grandTotalParts.length > 0 ? grandTotalParts.join(' + ') : money(0, 'USD')

  // --- Daily-reset display counter (Topic 6.0) ---
  // The permanent, never-reused Sale.customerNumber sequence underneath is
  // untouched -- "Same as #N" reuse, archived-day grouping, and invoice
  // ticket numbers all still key off that real identity. What resets to 1
  // each morning is purely this on-screen counter, derived from how many
  // distinct customers have already been rung up today (Monrovia calendar
  // day), matching how a fresh page of the physical ledger book starts over.
  const todayKey = dateKeyMonrovia(Date.now())
  const todayStartTs = useMemo(() => new Date(`${todayKey}T00:00:00Z`).getTime(), [todayKey])
  const todaySales = useLiveQuery(() => (open ? db.sales.where('timestamp').aboveOrEqual(todayStartTs).toArray() : []), [open, todayStartTs])
  const dailyIndexByCustomerNumber = useMemo(() => {
    const chronological = [...(todaySales ?? [])].sort((a, b) => a.timestamp - b.timestamp)
    const map = new Map<number, number>()
    let idx = 0
    for (const s of chronological) {
      if (!map.has(s.customerNumber)) map.set(s.customerNumber, ++idx)
    }
    return map
  }, [todaySales])
  const lastSale = useLiveQuery(() => (open ? db.sales.orderBy('timestamp').last() : undefined), [open])
  const lastSaleIsToday = !!lastSale && dateKeyMonrovia(lastSale.timestamp) === todayKey
  const lastSaleDisplayNumber = lastSale ? (lastSaleIsToday ? dailyIndexByCustomerNumber.get(lastSale.customerNumber) ?? 1 : lastSale.customerNumber) : null
  const previewDailyNumber =
    sameAsLast && lastSaleIsToday && lastSale ? dailyIndexByCustomerNumber.get(lastSale.customerNumber) ?? 1 : dailyIndexByCustomerNumber.size + 1

  function namedItems(): ItemBlock[] {
    return items.filter((it) => (it.selectedProduct ? it.selectedProduct.name : it.query.trim()))
  }

  function namedBulkTickets(): { ticket: BulkTicket; rows: ItemBlock[] }[] {
    return bulkTickets
      .map((t) => ({ ticket: t, rows: t.rows.filter((r) => (r.selectedProduct ? r.selectedProduct.name : r.query.trim())) }))
      .filter((t) => t.rows.length > 0)
  }

  // Pressing Enter (in any item's/row's fields) submits the whole ticket
  // straight to the Ledger Push Review Panel -- it never loops back to a
  // new item, and Bulk Book View validates every queued customer ticket at
  // once before opening the same review step.
  function openReview() {
    if (viewMode === 'bulk') {
      const validTickets = namedBulkTickets()
      if (validTickets.length === 0) {
        setSaveError('Add at least one item before recording the sale.')
        return
      }
      const missingTotal = validTickets.find((t) => (Number(t.ticket.totalLrd) || 0) <= 0 && (Number(t.ticket.totalUsd) || 0) <= 0)
      if (missingTotal) {
        setSaveError('Enter a total amount (LRD, USD, or both) for every customer ticket.')
        return
      }
      setSaveError(null)
      setReviewOpen(true)
      return
    }

    const valid = namedItems()
    if (valid.length === 0) {
      setSaveError('Add at least one item before recording the sale.')
      return
    }
    if (!anyPerItemAmount && totalLrdNum <= 0 && totalUsdNum <= 0) {
      setSaveError('Enter a total amount (LRD, USD, or both), or a price per item.')
      return
    }
    setSaveError(null)
    setReviewOpen(true)
  }

  const singleLineSummaries = useMemo<TicketLineSummary[]>(() => {
    return namedItems().map((it) => {
      const name = it.selectedProduct ? it.selectedProduct.name : it.query.trim()
      const lrd = anyPerItemAmount ? Number(it.lrdAmount) || 0 : 0
      const usd = anyPerItemAmount ? Number(it.usdAmount) || 0 : 0
      const parts: string[] = []
      if (lrd > 0) parts.push(money(lrd, 'LRD'))
      if (usd > 0) parts.push(money(usd, 'USD'))
      return {
        key: it.key,
        label: `${it.qty} ${unitLabel(it)} · ${name}`,
        amounts: parts.length > 0 ? parts.join(' + ') : '—',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, anyPerItemAmount])

  const bulkLineSummaries = useMemo<TicketLineSummary[]>(() => {
    const list: TicketLineSummary[] = []
    namedBulkTickets().forEach(({ rows }, ti) => {
      rows.forEach((r) => {
        const name = r.selectedProduct ? r.selectedProduct.name : r.query.trim()
        list.push({ key: r.key, label: `Ticket ${ti + 1} · ${r.qty} ${unitLabel(r)} · ${name}`, amounts: '—' })
      })
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkTickets])

  const lineSummaries = viewMode === 'bulk' ? bulkLineSummaries : singleLineSummaries

  // Writes one customer ticket's line items to the ledger: resolves/creates
  // each product+variant exactly like a manual free-text sale, distributes
  // a single ticket total across lines (qty-weighted) when no line carries
  // its own price, and deducts stock. Shared by Single Entry (one ticket)
  // and every stacked ticket in Bulk Book View, so both modes write through
  // the exact same path a normal sale always has.
  async function writeTicketLines(
    valid: ItemBlock[],
    useDistribution: boolean,
    ticketTotalLrd: number,
    ticketTotalUsd: number,
    customerNumber: number,
    orderNumber: number,
    ticketLocation: FulfillmentLocation,
    timestamp: number,
  ) {
    const distributedLrd = new Map<string, number>()
    const distributedUsd = new Map<string, number>()
    if (useDistribution) {
      const totalQty = valid.reduce((s, it) => s + it.qty, 0) || valid.length
      let remainingLrd = ticketTotalLrd
      let remainingUsd = ticketTotalUsd
      valid.forEach((it, i) => {
        const isLast = i === valid.length - 1
        const share = it.qty / totalQty
        const lrdShare = isLast ? remainingLrd : Math.round(ticketTotalLrd * share * 100) / 100
        const usdShare = isLast ? remainingUsd : Math.round(ticketTotalUsd * share * 100) / 100
        distributedLrd.set(it.key, lrdShare)
        distributedUsd.set(it.key, usdShare)
        remainingLrd -= lrdShare
        remainingUsd -= usdShare
      })
    }

    for (const line of valid) {
      const lrdAmount = useDistribution ? distributedLrd.get(line.key) ?? 0 : Number(line.lrdAmount) || 0
      const usdAmount = useDistribution ? distributedUsd.get(line.key) ?? 0 : Number(line.usdAmount) || 0
      const name = line.selectedProduct ? line.selectedProduct.name : line.query.trim()

      const selectedVariant = line.selectedProduct
        ? (variantsByProduct.get(line.selectedProduct.id!) ?? []).find((v) => v.id === line.selectedVariantId) ?? null
        : null
      // Cost stays isolated to the inventory catalog — a brand-new free-text
      // item simply has no known cost yet (costUnknown stays true on its variant).
      const costTotal = selectedVariant ? selectedVariant.costPrice * line.qty : 0

      let productId = line.selectedProduct?.id
      let variantId = selectedVariant?.id
      let productCategory = line.selectedProduct?.category
      let variantLabel: string | undefined = selectedVariant?.label

      const primaryCurrency: Currency = usdAmount > 0 ? 'USD' : 'LRD'
      const primaryAmount = primaryCurrency === 'USD' ? usdAmount : lrdAmount
      const hasSecondary = usdAmount > 0 && lrdAmount > 0
      const secondaryCurrency: Currency | undefined = hasSecondary ? 'LRD' : undefined
      const secondaryAmount = hasSecondary ? lrdAmount : undefined

      if (!line.selectedProduct) {
        const existingProduct = await db.products.where('name').equalsIgnoreCase(name).first()
        const now = Date.now()
        if (existingProduct) {
          productId = existingProduct.id
          productCategory = existingProduct.category
          const existingVariants = (await db.variants.where('productId').equals(existingProduct.id!).toArray()).sort(
            (a, b) => a.order - b.order,
          )
          const label = existingVariants.length === 0 ? 'Standard' : ''
          const matching = label ? existingVariants.find((v) => v.label.toLowerCase() === label.toLowerCase()) : undefined
          if (matching) {
            variantId = matching.id
            variantLabel = matching.label
          } else if (existingVariants.length === 1) {
            variantId = existingVariants[0].id
            variantLabel = existingVariants[0].label
          } else {
            const newLabel = 'Standard'
            variantId = await db.variants.add({
              productId: existingProduct.id!,
              label: newLabel,
              optionValues: [],
              costPrice: 0,
              costUnknown: true,
              sellPrice: line.qty > 0 ? primaryAmount / line.qty : primaryAmount,
              currency: primaryCurrency,
              stockMyShop: 0,
              stockVishalShop: 0,
              lowStockThreshold: 3,
              order: existingVariants.length,
              createdAt: now,
              updatedAt: now,
            })
            variantLabel = newLabel
          }
        } else {
          productId = (await db.products.add({
            name,
            category: 'General',
            description: '',
            images: [],
            options: [],
            archived: false,
            createdAt: now,
            updatedAt: now,
          })) as number
          productCategory = 'General'
          variantLabel = 'Standard'
          variantId = await db.variants.add({
            productId,
            label: variantLabel,
            optionValues: [],
            costPrice: 0,
            costUnknown: true,
            sellPrice: line.qty > 0 ? primaryAmount / line.qty : primaryAmount,
            currency: primaryCurrency,
            stockMyShop: 0,
            stockVishalShop: 0,
            lowStockThreshold: 3,
            order: 0,
            createdAt: now,
            updatedAt: now,
          })
        }
      }

      await db.sales.add({
        productId,
        variantId,
        itemName: name,
        category: productCategory,
        variant: variantLabel,
        qty: line.qty,
        unitType: line.unitType === 'Other' ? line.customUnit.trim() || undefined : line.unitType,
        soldFor: primaryAmount,
        costAtSale: costTotal,
        currency: primaryCurrency,
        secondaryAmount,
        secondaryCurrency,
        timestamp,
        customerNumber,
        orderNumber,
        location: ticketLocation,
        tbs,
        pickedUp: !tbs,
      })

      if (!tbs && variantId) {
        const fresh = await db.variants.get(variantId)
        if (fresh) {
          const updated =
            ticketLocation === 'vishalShop'
              ? { stockVishalShop: Math.max(0, fresh.stockVishalShop - line.qty) }
              : { stockMyShop: Math.max(0, fresh.stockMyShop - line.qty) }
          await db.variants.update(variantId, { ...updated, updatedAt: Date.now() })
        }
      }
    }
  }

  async function submit() {
    setSaveError(null)

    if (viewMode === 'bulk') {
      const validTickets = namedBulkTickets()
      if (validTickets.length === 0) {
        setSaveError('Add at least one item before recording the sale.')
        return
      }

      setSaving(true)
      try {
        await db.transaction('rw', db.sales, db.products, db.variants, db.settings, async () => {
          // Each stacked ticket is its own customer/order (never "same as
          // last" -- Bulk Book View is specifically for several distinct
          // customers in one sitting), with distinct timestamps so daily
          // ordering/indexing stays correct.
          for (let i = 0; i < validTickets.length; i++) {
            const { ticket, rows } = validTickets[i]
            const customerNumber = await reserveNextCustomerNumber()
            const orderNumber = await reserveNextOrderNumber()
            const timestamp = Date.now() + i
            await writeTicketLines(rows, true, Number(ticket.totalLrd) || 0, Number(ticket.totalUsd) || 0, customerNumber, orderNumber, location, timestamp)
          }
        })
      } catch (err) {
        console.error('Failed to record sale', err)
        setSaving(false)
        onError(err instanceof Error ? `Could not save this sale: ${err.message}` : 'Could not save this sale. Please try again.')
        return
      }

      const totalRows = validTickets.reduce((s, t) => s + t.rows.length, 0)
      setSaving(false)
      setReviewOpen(false)
      onSaved(`Recorded ${validTickets.length} customer ticket${validTickets.length === 1 ? '' : 's'} — ${totalRows} item${totalRows === 1 ? '' : 's'} — ${grandTotal}`)
      onClose()
      return
    }

    const valid = namedItems()
    if (valid.length === 0) {
      setSaveError('Add at least one item before recording the sale.')
      return
    }

    setSaving(true)
    try {
      await db.transaction('rw', db.sales, db.products, db.variants, db.settings, async () => {
        const customerNumber = sameAsLast && lastSale ? lastSale.customerNumber : await reserveNextCustomerNumber()
        const orderNumber = await reserveNextOrderNumber()
        const timestamp = Date.now()
        await writeTicketLines(valid, !anyPerItemAmount, totalLrdNum, totalUsdNum, customerNumber, orderNumber, location, timestamp)
      })
    } catch (err) {
      console.error('Failed to record sale', err)
      setSaving(false)
      onError(err instanceof Error ? `Could not save this sale: ${err.message}` : 'Could not save this sale. Please try again.')
      return
    }

    setSaving(false)
    setReviewOpen(false)
    onSaved(`Recorded ${valid.length} item${valid.length === 1 ? '' : 's'} — ${grandTotal}`)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} centered>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setViewMode('single')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            viewMode === 'single' ? 'bg-[var(--series-1)] text-white' : 'bg-[var(--page-plane)] text-[var(--text-secondary)]'
          }`}
        >
          Single Entry
        </button>
        <button
          type="button"
          onClick={() => setViewMode('bulk')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            viewMode === 'bulk' ? 'bg-[var(--series-1)] text-white' : 'bg-[var(--page-plane)] text-[var(--text-secondary)]'
          }`}
        >
          Bulk Book View
        </button>
      </div>

      {viewMode === 'single' ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {lastSale && (
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={sameAsLast} onChange={(e) => setSameAsLast(e.target.checked)} />
                Same as #{lastSaleDisplayNumber}
              </label>
            )}
          </div>
          <Badge tone="good">#{previewDailyNumber}</Badge>
        </div>
      ) : (
        <div className="mb-3 text-xs font-semibold text-[var(--text-muted)]">
          {bulkTickets.length} customer ticket{bulkTickets.length === 1 ? '' : 's'} queued
        </div>
      )}

      {viewMode === 'single' ? (
        <>
          <div className="flex flex-col gap-3">
            {items.map((it, i) => (
              <ItemEntryBlock
                key={it.key}
                item={it}
                index={i}
                canRemove={items.length > 1}
                autoFocus={it.key === lastAddedKey}
                products={products ?? []}
                variantsByProduct={variantsByProduct}
                productStock={productStock}
                categories={categories ?? []}
                savedQualifiers={savedQualifiers}
                onUpdate={(patch) => updateItem(it.key, patch)}
                onRemove={() => removeItem(it.key)}
                onSubmitTicket={openReview}
              />
            ))}
          </div>

          <Button onClick={addItem} variant="secondary" className="mt-3 w-full justify-center">
            <PlusIcon className="h-4 w-4" />
            Add Item
          </Button>

          {/* Single Total Capture (Topic 6): once any item carries its own
              price, the whole-ticket total is calculated automatically instead
              -- the two modes don't mix, to avoid double counting. */}
          {!anyPerItemAmount ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Total LRD">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className={inputClass + ' text-lg font-semibold'}
                  placeholder="0.00"
                  value={totalLrd}
                  onFocus={selectOnFocus}
                  onChange={(e) => setTotalLrd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      openReview()
                    }
                  }}
                />
              </Field>
              <Field label="Total USD">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className={inputClass + ' text-lg font-semibold'}
                  placeholder="0.00"
                  value={totalUsd}
                  onFocus={selectOnFocus}
                  onChange={(e) => setTotalUsd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      openReview()
                    }
                  }}
                />
              </Field>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-muted)]">Per-item pricing given — ticket total calculated automatically.</p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {bulkTickets.map((t, ti) => (
            <BulkTicketCard
              key={t.key}
              ticket={t}
              ticketIndex={ti}
              canRemove={bulkTickets.length > 1}
              onUpdateRow={(rowKey, patch) => updateBulkRow(t.key, rowKey, patch)}
              onAddRow={() => addBulkRow(t.key)}
              onRemoveRow={(rowKey) => removeBulkRow(t.key, rowKey)}
              onUpdateTotals={(patch) => updateBulkTotals(t.key, patch)}
              onRemoveTicket={() => removeBulkTicket(t.key)}
              onSubmitTicket={openReview}
            />
          ))}
          <Button onClick={addBulkTicket} variant="secondary" className="w-full justify-center">
            <PlusIcon className="h-4 w-4" />
            Add Next Customer Ticket Below
          </Button>
        </div>
      )}

      <div className="mt-3">
        <Field label="Fulfill from">
          <Pill
            options={[
              { label: 'My Store Floor', value: 'myShop' },
              { label: 'Warehouse (Vishal)', value: 'vishalShop' },
            ]}
            value={location}
            onChange={setLocation}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Switch checked={tbs} onChange={setTbs} label="TBS — customer paid, will pick up goods later" />
      </div>

      {saveError && (
        <div className="mt-3 rounded-lg bg-[var(--status-critical)]/10 px-3 py-2 text-sm text-[var(--status-critical)]">
          {saveError}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-[var(--gridline)] pt-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold">Grand Total</span>
          <span className="tabular text-lg font-bold">{grandTotal}</span>
        </div>
        <Button onClick={openReview} className="w-full justify-center">
          Push to Ledger
        </Button>
      </div>

      <LedgerPushReviewPanel
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onConfirm={submit}
        saving={saving}
        lineSummaries={lineSummaries}
        grandTotal={grandTotal}
      />
    </BottomSheet>
  )
}
