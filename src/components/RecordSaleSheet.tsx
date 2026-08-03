import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  reserveNextCustomerNumber,
  reserveNextOrderNumber,
  saveCustomUnit,
  UNIT_TYPES,
  type Currency,
  type Product,
  type Variant,
  type FulfillmentLocation,
  type AbbreviationRule,
} from '../db'
import { BottomSheet, Button, Field, inputClass, Badge, Pill, Switch } from './ui'
import { LedgerPushReviewPanel, type TicketLineSummary } from './LedgerPushReviewPanel'
import { SearchIcon, PlusIcon, TrashIcon, XIcon } from './icons'
import { money, selectOnFocus, dateKeyMonrovia } from '../lib/format'
import { itemSearchMatches } from '../lib/itemMatch'
import { withoutVoided } from '../lib/salesLedger'
import {
  parseNaturalLanguageLine,
  splitOrderLines,
  fuzzyMatchProducts,
  confidenceOf,
  type MatchConfidence,
  type ProductMatchCandidate,
} from '../lib/naturalLanguageOrder'

interface ItemBlock {
  key: string
  qty: number
  unitType: string
  customUnit: string
  unitAbbrev: string // Single Entry's raw shortcode text ("pcs", "bag", ...); resolved into unitType/customUnit on commit
  query: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  usdAmount: string
  lrdAmount: string
  // Set by the Natural Language Input Auto-Matcher when the description
  // was typed as a compact "[qty][unit] [item] /[tag]" string ending in a
  // recognized source-switch flag (e.g. "/bro").
  sourceTag?: string
  sourceNote?: string
  // Transient, UI-only confidence flag set by the fuzzy product matcher when
  // this row was resolved from typed/pasted text -- never persisted to the
  // Sale row, just drives the "tap to confirm" badge on committed rows.
  matchStatus?: MatchConfidence
}

function blankItem(): ItemBlock {
  return {
    key: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    qty: 1,
    unitType: 'Piece',
    customUnit: '',
    unitAbbrev: '',
    query: '',
    selectedProduct: null,
    selectedVariantId: null,
    usdAmount: '',
    lrdAmount: '',
  }
}

// Shortcode vocabulary for the Single Entry unit box -- kept to the entry
// layer only; resolved to a full descriptive name before anything is
// written to the permanent ledger. "Bag" isn't one of the built-in
// UNIT_TYPES, so it resolves through the same persistent-qualifier
// mechanism as any other shop-specific custom unit.
const UNIT_ABBREVIATIONS: { abbrev: string; full: string }[] = [
  { abbrev: 'pcs', full: 'Piece' },
  { abbrev: 'ctn', full: 'Carton' },
  { abbrev: 'bdl', full: 'Bundle' },
  { abbrev: 'rol', full: 'Roll' },
  { abbrev: 'gal', full: 'Gallon' },
  { abbrev: 'bag', full: 'Bag' },
]

// Resolves whatever's currently in the unit box into the underlying
// unitType/customUnit fields the ledger actually stores: an exact
// abbreviation match maps to its full name, a built-in unit or previously
// saved qualifier matches as-is (case-insensitive), and anything else is
// treated as a brand-new shop-specific qualifier.
function resolveUnitAbbrev(raw: string, savedQualifiers: string[]): { unitType: string; customUnit: string } {
  const text = raw.trim()
  if (!text) return { unitType: 'Piece', customUnit: '' }
  const abbrevMatch = UNIT_ABBREVIATIONS.find((u) => u.abbrev.toLowerCase() === text.toLowerCase())
  const resolved = abbrevMatch ? abbrevMatch.full : text
  const builtIn = UNIT_TYPES.find((u) => u.toLowerCase() === resolved.toLowerCase())
  if (builtIn) return { unitType: builtIn, customUnit: '' }
  const saved = savedQualifiers.find((q) => q.toLowerCase() === resolved.toLowerCase())
  return { unitType: 'Other', customUnit: saved ?? resolved }
}

interface ItemSuggestion {
  key: string
  product: Product
  variant: Variant | null
  // The variant's own descriptor -- what actually gets typed into the
  // description field when picked. Falls back to the product name for a
  // single-variant "loose" item, which has no separate variant identity.
  variantLabel: string
  // The parent Master Product's name, shown as a muted subtitle -- null
  // for a loose (single-variant) product, since it has no separate parent.
  masterName: string | null
  stock: number
  costPrice: number
  costKnown: boolean
}

// --- Crash-recovery draft persistence ---
// Only the plain, JSON-serializable fields survive a save/reload cycle --
// `selectedProduct`/`selectedVariantId` are dropped (a live catalog match
// is re-resolved by re-typing/re-picking after recovery) since a Product
// carries Blob images that can't round-trip through JSON. The important
// thing recovered is exactly what the user typed: quantities, item text,
// and every price/total field.
const DRAFT_STORAGE_KEY = 'ledgr:recordSaleDraft'

interface PersistedItem {
  key: string
  qty: number
  unitType: string
  customUnit: string
  query: string
  usdAmount: string
  lrdAmount: string
}

interface PersistedDraft {
  items: PersistedItem[]
  location: FulfillmentLocation
  totalLrd: string
  totalUsd: string
  tbs: boolean
}

function toPersistedItem(it: ItemBlock): PersistedItem {
  const { key, qty, unitType, customUnit, query, usdAmount, lrdAmount } = it
  return { key, qty, unitType, customUnit, query, usdAmount, lrdAmount }
}

function fromPersistedItem(p: PersistedItem): ItemBlock {
  return { ...p, unitAbbrev: '', selectedProduct: null, selectedVariantId: null }
}

function saveDraftToStorage(draft: PersistedDraft) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable/full -- crash recovery is a nicety, never a hard requirement.
  }
}

function loadDraftFromStorage(): PersistedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedDraft) : null
  } catch {
    return null
  }
}

function clearDraftFromStorage() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // no-op
  }
}

function draftHasContent(draft: Pick<PersistedDraft, 'items'>): boolean {
  return draft.items.some((it) => it.query.trim())
}

function unitLabel(item: { unitType: string; customUnit: string }): string {
  return item.unitType === 'Other' ? item.customUnit.trim() || 'unit' : item.unitType
}

// A committed item renders as a compact one-line summary pinned above the
// active row, purely for visual reference by default -- but a row the fuzzy
// matcher couldn't confidently resolve (typed/pasted via the comma-batch
// path) carries a "tap to confirm" badge, and tapping the row body reopens
// it as the active, editable row (with the normal suggestion dropdown) so
// the match can actually be confirmed or corrected instead of silently
// becoming a brand-new product.
function CommittedItemRow({ item, onReopen, onRemove }: { item: ItemBlock; onReopen: () => void; onRemove: () => void }) {
  const name = item.selectedProduct ? item.selectedProduct.name : item.query.trim()
  const needsConfirm = item.matchStatus === 'suggested' || item.matchStatus === 'new'
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
        needsConfirm ? 'border-amber-300 bg-amber-50' : 'border-[var(--border)] bg-[var(--page-plane)]'
      }`}
    >
      <button type="button" onClick={onReopen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="min-w-0 truncate">
          {item.qty} {unitLabel(item)} · {name}
        </span>
        {needsConfirm && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            {item.matchStatus === 'suggested' ? 'Possible match — tap to confirm' : 'New item — tap to confirm'}
          </span>
        )}
      </button>
      <button onClick={onRemove} aria-label="Remove item" className="shrink-0 text-[var(--text-muted)] hover:text-[var(--status-critical)]">
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

// The single active 3-part row: Quantity -> Unit (shortcode) -> Item
// Description, in that sequential focus order, with a '+' at the row's
// right edge. Enter chains focus forward field-by-field; only reaching the
// end of Description without tapping '+' hands focus off to the ticket
// totals -- '+' is the only thing that ever commits this row and opens a
// fresh one.
function ItemEntryBlock({
  item,
  autoFocus,
  products,
  variantsByProduct,
  productStock,
  savedQualifiers,
  abbreviationRules,
  onUpdate,
  onAddItem,
  onCommitQuickItems,
  onAdvanceToTotals,
}: {
  item: ItemBlock
  autoFocus: boolean
  products: Product[]
  variantsByProduct: Map<number, Variant[]>
  productStock: Map<number, number>
  savedQualifiers: string[]
  abbreviationRules: AbbreviationRule[]
  onUpdate: (patch: Partial<ItemBlock>) => void
  onAddItem: () => void
  onCommitQuickItems: (raw: string) => void
  onAdvanceToTotals: () => void
}) {
  const qtyRef = useRef<HTMLInputElement>(null)
  const unitRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) qtyRef.current?.focus()
  }, [autoFocus])

  const unitSuggestions = useMemo(() => {
    const q = item.unitAbbrev.trim().toLowerCase()
    if (!q) return []
    return UNIT_ABBREVIATIONS.filter((u) => u.abbrev.startsWith(q) && u.abbrev !== q)
  }, [item.unitAbbrev])

  function commitUnitAbbrev() {
    const clean = item.unitAbbrev.trim()
    if (!clean) return
    const { unitType, customUnit } = resolveUnitAbbrev(clean, savedQualifiers)
    if (unitType === 'Other') saveCustomUnit(customUnit).catch(() => {})
  }

  // Matches against the variant's own description AND its Master Product's
  // parent name -- either one containing the typed text is enough, so
  // searching "Zinc" surfaces every variant under a "Zinc Roofing" master
  // even if the variant's own label ("14G") doesn't mention zinc at all.
  const itemSuggestions = useMemo<ItemSuggestion[]>(() => {
    const q = item.query.trim()
    if (!q) return []
    const results: ItemSuggestion[] = []
    for (const p of products) {
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.length <= 1) {
        const v = variants[0] ?? null
        const variantLabel = p.name
        if (itemSearchMatches(variantLabel, q) || (v && itemSearchMatches(v.label, q))) {
          results.push({
            key: `${p.id}-${v?.id ?? 'none'}`,
            product: p,
            variant: v,
            variantLabel,
            masterName: null,
            stock: v ? v.stockMyShop + v.stockVishalShop : productStock.get(p.id!) ?? 0,
            costPrice: v?.costPrice ?? 0,
            costKnown: v ? !v.costUnknown && v.costPrice > 0 : false,
          })
        }
      } else {
        for (const v of variants) {
          if (itemSearchMatches(v.label, q) || itemSearchMatches(p.name, q)) {
            results.push({
              key: `${p.id}-${v.id}`,
              product: p,
              variant: v,
              variantLabel: v.label,
              masterName: p.name,
              stock: v.stockMyShop + v.stockVishalShop,
              costPrice: v.costPrice,
              costKnown: !v.costUnknown && v.costPrice > 0,
            })
          }
        }
      }
    }
    // Substring search alone misses typos ("tir" vs "tire") -- when it
    // comes up thin, fold in the fuzzy/typo-tolerant matcher's top
    // candidates too (deduped against what's already there), so a
    // misspelled description still surfaces the right product to confirm.
    if (results.length < 4) {
      const seen = new Set(results.map((r) => r.key))
      const fuzzy: ProductMatchCandidate[] = fuzzyMatchProducts(q, products, variantsByProduct)
      for (const f of fuzzy) {
        if (f.score < 0.6) continue
        const key = `${f.product.id}-${f.variant?.id ?? 'none'}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          key,
          product: f.product,
          variant: f.variant,
          variantLabel: f.variant ? f.variant.label : f.product.name,
          masterName: f.variant && f.variant.label !== f.product.name ? f.product.name : null,
          stock: f.variant ? f.variant.stockMyShop + f.variant.stockVishalShop : productStock.get(f.product.id!) ?? 0,
          costPrice: f.variant?.costPrice ?? 0,
          costKnown: f.variant ? !f.variant.costUnknown && f.variant.costPrice > 0 : false,
        })
      }
    }
    return results.slice(0, 8)
  }, [products, variantsByProduct, productStock, item.query])

  function pickSuggestion(s: ItemSuggestion) {
    onUpdate({ selectedProduct: s.product, selectedVariantId: s.variant?.id ?? null, query: s.variantLabel, matchStatus: 'linked' })
  }

  // "+ Create New Variant" -- fires a background write to actually
  // initialize the product+variant in the catalog right away (rather than
  // waiting for checkout to do it), then selects it so the ticket proceeds
  // exactly like picking any other existing match.
  async function pickCreateNew() {
    const name = item.query.trim()
    if (!name) return
    const now = Date.now()
    const productId = (await db.products.add({
      name,
      category: 'General',
      description: '',
      images: [],
      options: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    })) as number
    const variantId = (await db.variants.add({
      productId,
      label: 'Standard',
      optionValues: [],
      costPrice: 0,
      costUnknown: true,
      sellPrice: 0,
      currency: 'USD',
      stockMyShop: 0,
      stockVishalShop: 0,
      lowStockThreshold: 3,
      order: 0,
      isNew: true,
      newSince: now,
      createdAt: now,
      updatedAt: now,
    })) as number
    const product: Product = { id: productId, name, category: 'General', description: '', images: [], options: [], archived: false, createdAt: now, updatedAt: now }
    onUpdate({ selectedProduct: product, selectedVariantId: variantId, query: name, matchStatus: 'linked' })
  }

  function onQtyEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    unitRef.current?.focus()
  }

  function onUnitEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    commitUnitAbbrev()
    descRef.current?.focus()
  }

  // Lets the description field double as a compact order-line shorthand --
  // "1pc 8\" st. spec. double mat /bro" -- splitting qty/unit/description
  // out into their own fields, resolving the alias + trailing source flag,
  // and fuzzy-matching the result against the live catalog so a typo like
  // "tir" still confidently auto-links to an existing "...Tire" product
  // instead of always falling through to free text.
  function applyNaturalLanguageParse() {
    const parsed = parseNaturalLanguageLine(item.query, abbreviationRules)
    if (!parsed) return
    const candidates = fuzzyMatchProducts(parsed.description, products, variantsByProduct)
    const status = confidenceOf(candidates)
    const top = candidates[0]
    onUpdate({
      qty: parsed.qty,
      unitAbbrev: parsed.unitAbbrev,
      query: status === 'linked' && top ? top.label : parsed.description,
      selectedProduct: status === 'linked' && top ? top.product : null,
      selectedVariantId: status === 'linked' && top ? top.variant?.id ?? null : null,
      sourceTag: parsed.sourceTag ?? undefined,
      sourceNote: parsed.sourceNote ?? undefined,
      matchStatus: status,
    })
  }

  function onDescriptionEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // A comma means multiple items typed/pasted at once -- hand the whole
    // raw string off to the parent to split, resolve, and commit as
    // separate rows in one go, instead of treating it as one description.
    if (item.query.includes(',')) {
      onCommitQuickItems(item.query)
      return
    }
    applyNaturalLanguageParse()
    onAdvanceToTotals()
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center gap-1.5">
        <input
          ref={qtyRef}
          type="number"
          inputMode="numeric"
          min={1}
          className="tabular w-12 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-1.5 py-2 text-center text-sm font-semibold outline-none focus:border-[var(--series-1)]"
          value={item.qty}
          onFocus={selectOnFocus}
          onChange={(e) => onUpdate({ qty: Number(e.target.value) || 1 })}
          onKeyDown={onQtyEnter}
        />
        <div className="relative w-16 shrink-0">
          <input
            ref={unitRef}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--page-plane)] px-1.5 py-2 text-center text-xs font-medium outline-none focus:border-[var(--series-1)]"
            placeholder="pcs"
            value={item.unitAbbrev}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => onUpdate({ unitAbbrev: e.target.value })}
            onBlur={commitUnitAbbrev}
            onKeyDown={onUnitEnter}
          />
          {unitSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-28 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
              {unitSuggestions.map((s) => (
                <button
                  key={s.abbrev}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onUpdate({ unitAbbrev: s.abbrev })
                    descRef.current?.focus()
                  }}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-[var(--page-plane)]"
                >
                  <span className="font-semibold">{s.abbrev}</span>
                  <span className="text-[var(--text-muted)]">{s.full}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={descRef}
            className={inputClass + ' pl-9'}
            placeholder='e.g. 1pc wheel barrow tire, 2 bags cement'
            value={item.query}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => onUpdate({ query: e.target.value, selectedProduct: null, selectedVariantId: null })}
            onKeyDown={onDescriptionEnter}
            onBlur={applyNaturalLanguageParse}
          />
          {/* Suggestions are only ever applied by an explicit tap/click below
              -- Enter always keeps the raw typed text, never a close match.
              No product image (assets are always null here) -- the
              description gets the space back instead, wrapping across
              lines rather than truncating so long dimension/gauge names
              stay fully readable. */}
          {item.query && !item.selectedProduct && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
              {itemSuggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--page-plane)]"
                >
                  <div className="w-[70%] min-w-0">
                    <div className="whitespace-normal break-words text-sm leading-snug">{s.variantLabel}</div>
                    {s.masterName && <div className="truncate text-xs text-[var(--text-muted)]">{s.masterName}</div>}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-col items-end gap-1 pt-0.5">
                    <span className="tabular whitespace-nowrap rounded-full bg-[var(--page-plane)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                      {s.stock} left
                    </span>
                    {s.costKnown && (
                      <span className="tabular whitespace-nowrap rounded-full bg-[var(--page-plane)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                        {money(s.costPrice, s.variant?.currency ?? 'USD')}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {itemSuggestions.length === 0 && (
                <button
                  type="button"
                  onClick={pickCreateNew}
                  className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]"
                >
                  + Create New Variant: "{item.query.trim()}"
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            commitUnitAbbrev()
            onAddItem()
          }}
          aria-label="Add item"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--series-1)] text-white"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {!item.selectedProduct && item.query && (
        <span className="mt-1 block text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
      )}
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
  const savedQualifierRows = useLiveQuery(() => (open ? db.customUnits.orderBy('label').toArray() : []), [open])
  const savedQualifiers = useMemo(() => (savedQualifierRows ?? []).map((r) => r.label), [savedQualifierRows])
  const abbreviationRules = useLiveQuery(() => (open ? db.abbreviations.toArray() : []), [open]) ?? []

  const [items, setItems] = useState<ItemBlock[]>([blankItem()])
  const [location, setLocation] = useState<FulfillmentLocation>('myShop')
  const [totalLrd, setTotalLrd] = useState('')
  const [totalUsd, setTotalUsd] = useState('')
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null)
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const totalLrdRef = useRef<HTMLInputElement>(null)
  const totalUsdRef = useRef<HTMLInputElement>(null)

  // Reset the whole sheet each time it's opened fresh -- unless a crash-
  // recovery draft with real content is sitting in localStorage (the app was
  // killed/lost power mid-entry), in which case that gets loaded back in
  // instead of starting blank.
  useEffect(() => {
    if (open) {
      const recovered = loadDraftFromStorage()
      if (recovered && draftHasContent(recovered)) {
        const restoredItems = recovered.items.length > 0 ? recovered.items.map(fromPersistedItem) : [blankItem()]
        setItems(restoredItems)
        setLocation(recovered.location)
        setTotalLrd(recovered.totalLrd)
        setTotalUsd(recovered.totalUsd)
        setLastAddedKey(null)
        setTbs(recovered.tbs)
      } else {
        const first = blankItem()
        setItems([first])
        setLocation('myShop')
        setTotalLrd('')
        setTotalUsd('')
        setLastAddedKey(first.key)
        setTbs(false)
      }
      setSameAsLast(false)
      setSaveError(null)
      setSaving(false)
      setReviewOpen(false)
    }
  }, [open])

  // Continuously mirrors the in-progress ticket(s) to localStorage while the
  // sheet is open, so an unexpected app termination (device power loss,
  // PWA killed by the OS) doesn't lose what's been typed -- recovered on
  // the next open via the effect above.
  useEffect(() => {
    if (!open) return
    saveDraftToStorage({
      items: items.map(toPersistedItem),
      location,
      totalLrd,
      totalUsd,
      tbs,
    })
  }, [open, items, location, totalLrd, totalUsd, tbs])

  // The only way to leave this form is the explicit "X" button (the backdrop
  // is locked) -- and even then, an in-progress ticket triggers a
  // confirmation before anything is discarded, so an accidental tap can
  // never silently wipe typed-in data.
  function requestClose() {
    const hasContent = draftHasContent({ items: items.map(toPersistedItem) })
    if (hasContent && !window.confirm('Discard this in-progress sale? Anything typed will be lost.')) return
    clearDraftFromStorage()
    onClose()
  }

  // One history entry for the sheet's lifetime: a hardware/gesture "back"
  // closes the Ledger Push Review Panel if it's open, otherwise requests
  // closing the whole sheet (with the same discard confirmation), instead
  // of leaving the app.
  const reviewOpenRef = useRef(reviewOpen)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  const requestCloseRef = useRef(requestClose)
  useEffect(() => {
    requestCloseRef.current = requestClose
  })

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
        requestCloseRef.current()
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
    setItems((prev) => {
      // Resolve the row being committed's unit shortcode into the real
      // unitType/customUnit before it becomes a read-only summary line.
      const resolved = prev.map((it, i) =>
        i === prev.length - 1 ? { ...it, ...resolveUnitAbbrev(it.unitAbbrev, savedQualifiers) } : it,
      )
      return [...resolved, fresh]
    })
    setLastAddedKey(fresh.key)
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev))
  }

  // Pulls an already-committed row (from the comma-batch quick-entry path,
  // possibly still unconfirmed) back out to be the active, editable row --
  // dropping the current active row first if it was never actually touched,
  // so reopening never leaves a stray empty row buried in the middle of the
  // list.
  function reopenItem(key: string) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.key === key)
      if (idx === -1) return prev
      const target = { ...prev[idx], matchStatus: undefined }
      const others = prev.filter((it, i) => i !== idx && (it.query.trim() || it.selectedProduct))
      return [...others, target]
    })
  }

  // Splits raw quick-entry text on commas, resolves each segment (qty/unit/
  // alias parsing + fuzzy product matching against the live catalog), and
  // appends the results as committed rows -- this is what makes "comma
  // means multiple items" work, whether it's one segment or ten.
  function commitQuickItems(raw: string) {
    const lines = splitOrderLines(raw)
    if (lines.length === 0) return
    const resolved = lines.map((line): ItemBlock => {
      const parsed = parseNaturalLanguageLine(line, abbreviationRules)
      const base = blankItem()
      if (!parsed) return { ...base, query: line }
      const candidates = fuzzyMatchProducts(parsed.description, products ?? [], variantsByProduct)
      const status = confidenceOf(candidates)
      const top = candidates[0]
      return {
        ...base,
        qty: parsed.qty,
        ...resolveUnitAbbrev(parsed.unitAbbrev, savedQualifiers),
        unitAbbrev: parsed.unitAbbrev,
        query: status === 'linked' && top ? top.label : parsed.description,
        selectedProduct: status === 'linked' && top ? top.product : null,
        selectedVariantId: status === 'linked' && top ? top.variant?.id ?? null : null,
        sourceTag: parsed.sourceTag ?? undefined,
        sourceNote: parsed.sourceNote ?? undefined,
        matchStatus: status,
      }
    })
    setItems((prev) => {
      const withoutBlankActive = prev.filter((it) => it.query.trim() || it.selectedProduct)
      return [...withoutBlankActive, ...resolved, blankItem()]
    })
    setLastAddedKey(null)
  }

  const anyPerItemAmount = items.some((it) => (Number(it.lrdAmount) || 0) > 0 || (Number(it.usdAmount) || 0) > 0)
  const itemsGrandLrd = items.reduce((s, it) => s + (Number(it.lrdAmount) || 0), 0)
  const itemsGrandUsd = items.reduce((s, it) => s + (Number(it.usdAmount) || 0), 0)
  const totalLrdNum = Number(totalLrd) || 0
  const totalUsdNum = Number(totalUsd) || 0
  const grandLrd = anyPerItemAmount ? itemsGrandLrd : totalLrdNum
  const grandUsd = anyPerItemAmount ? itemsGrandUsd : totalUsdNum
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
  const todaySalesRaw = useLiveQuery(() => (open ? db.sales.where('timestamp').aboveOrEqual(todayStartTs).toArray() : []), [open, todayStartTs])
  const todaySales = useMemo(() => withoutVoided(todaySalesRaw ?? []), [todaySalesRaw])
  const dailyIndexByCustomerNumber = useMemo(() => {
    const chronological = [...todaySales].sort((a, b) => a.timestamp - b.timestamp)
    const map = new Map<number, number>()
    let idx = 0
    for (const s of chronological) {
      if (!map.has(s.customerNumber)) map.set(s.customerNumber, ++idx)
    }
    return map
  }, [todaySales])
  const lastSale = useLiveQuery(
    () => (open ? db.sales.orderBy('timestamp').reverse().filter((s) => !s.voidedAt).first() : undefined),
    [open],
  )
  const lastSaleIsToday = !!lastSale && dateKeyMonrovia(lastSale.timestamp) === todayKey
  const lastSaleDisplayNumber = lastSale ? (lastSaleIsToday ? dailyIndexByCustomerNumber.get(lastSale.customerNumber) ?? 1 : lastSale.customerNumber) : null
  const previewDailyNumber =
    sameAsLast && lastSaleIsToday && lastSale ? dailyIndexByCustomerNumber.get(lastSale.customerNumber) ?? 1 : dailyIndexByCustomerNumber.size + 1

  function namedItems(): ItemBlock[] {
    // The active (last) row's unit shortcode only gets resolved into a real
    // unitType when '+' commits it -- if the user goes straight to Push to
    // Ledger without ever tapping '+', resolve it here as a safety net.
    return items
      .map((it, i) => (i === items.length - 1 ? { ...it, ...resolveUnitAbbrev(it.unitAbbrev, savedQualifiers) } : it))
      .filter((it) => (it.selectedProduct ? it.selectedProduct.name : it.query.trim()))
  }

  // Pressing Enter (in any item's fields) submits the whole ticket straight
  // to the Ledger Push Review Panel -- it never loops back to a new item.
  // Blocked while any row is still an unconfirmed fuzzy match/new-item
  // suggestion, since those need an explicit tap (reopen the row) before
  // they're safe to write.
  function openReview() {
    const valid = namedItems()
    if (valid.length === 0) {
      setSaveError('Add at least one item before recording the sale.')
      return
    }
    const unconfirmed = valid.find((it) => it.matchStatus === 'suggested' || it.matchStatus === 'new')
    if (unconfirmed) {
      setSaveError(`Confirm "${unconfirmed.query}" before recording -- tap it above to review the match.`)
      return
    }
    if (!anyPerItemAmount && totalLrdNum <= 0 && totalUsdNum <= 0) {
      setSaveError('Enter a total amount (LRD, USD, or both), or a price per item.')
      return
    }
    setSaveError(null)
    setReviewOpen(true)
  }

  const lineSummaries = useMemo<TicketLineSummary[]>(() => {
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

  // A "Master Product" is one that's already been organized (grouped via
  // Group…/Link to Master Product in Inventory) -- i.e. it carries more
  // than one variant. An unverified free-text line with no exact name
  // match gets auto-routed into the first master whose name is a substring
  // of what was typed (or vice versa), so a near-miss like "6ft Zinc Sheet"
  // lands inside the existing "Zinc" master instead of becoming its own
  // disconnected product.
  function findMasterProductMatch(typedName: string): Product | null {
    const typed = typedName.toLowerCase()
    for (const p of products ?? []) {
      if (p.archived) continue
      const variantCount = (variantsByProduct.get(p.id!) ?? []).length
      if (variantCount <= 1) continue
      const candidate = p.name.toLowerCase()
      if (typed.includes(candidate) || candidate.includes(typed)) return p
    }
    return null
  }

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
    const ticketVariantIds = new Set<number>()
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
          // No exact match -- before spinning up a brand-new standalone
          // product, check whether the typed text contains (or is
          // contained by) an already-linked Master Product's name (a
          // product with more than one variant, i.e. one that's already
          // been organized via Group…/Link to Master Product). If so, this
          // unverified line becomes a new variant under that master
          // instead of a duplicate product entry.
          const master = findMasterProductMatch(name)
          if (master) {
            productId = master.id
            productCategory = master.category
            const masterVariants = (await db.variants.where('productId').equals(master.id!).toArray()).sort((a, b) => a.order - b.order)
            variantLabel = name
            variantId = await db.variants.add({
              productId: master.id!,
              label: variantLabel,
              optionValues: [],
              costPrice: 0,
              costUnknown: true,
              sellPrice: line.qty > 0 ? primaryAmount / line.qty : primaryAmount,
              currency: primaryCurrency,
              stockMyShop: 0,
              stockVishalShop: 0,
              lowStockThreshold: 3,
              order: masterVariants.length,
              isNew: true,
              newSince: now,
              createdAt: now,
              updatedAt: now,
            })
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
              isNew: true,
              newSince: now,
              createdAt: now,
              updatedAt: now,
            })
          }
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
        sourceTag: line.sourceTag,
        sourceNote: line.sourceNote,
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

      if (variantId) ticketVariantIds.add(variantId)
    }

    // Background-only "frequently sold with" tracking: every variant
    // checked out together on this one ticket gets every other variant's ID
    // cross-linked into its frequentlySoldWith array, deduped. Never shown
    // in the UI directly -- just accumulated for future statistical use.
    if (ticketVariantIds.size > 1) {
      for (const vid of ticketVariantIds) {
        const others = Array.from(ticketVariantIds).filter((id) => id !== vid)
        const fresh = await db.variants.get(vid)
        if (!fresh) continue
        const merged = Array.from(new Set([...(fresh.frequentlySoldWith ?? []), ...others]))
        await db.variants.update(vid, { frequentlySoldWith: merged })
      }
    }
  }

  async function submit() {
    setSaveError(null)

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
    clearDraftFromStorage()
    onSaved(`Recorded ${valid.length} item${valid.length === 1 ? '' : 's'} — ${grandTotal}`)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={requestClose} centered lockBackdrop>
      {/* The backdrop is locked (an accidental tap outside never closes this
          form) -- this is the one deliberate, explicit way to leave, and it
          always confirms first when there's anything typed to lose. */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Record Sale</h2>
        <button onClick={requestClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--page-plane)]">
          <XIcon className="h-4 w-4" />
        </button>
      </div>

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

      {/* Every item but the active (last) one is committed -- shown as a
          compact one-line summary pinned above. Items typed/pasted through
          the comma-batch path that the fuzzy matcher couldn't confidently
          resolve are flagged amber and tappable to reopen for confirmation
          (see CommittedItemRow). */}
      {items.length > 1 && (
        <div className="mb-3 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {items.slice(0, -1).map((it) => (
            <CommittedItemRow key={it.key} item={it} onReopen={() => reopenItem(it.key)} onRemove={() => removeItem(it.key)} />
          ))}
        </div>
      )}

      <ItemEntryBlock
        key={items[items.length - 1].key}
        item={items[items.length - 1]}
        autoFocus={items[items.length - 1].key === lastAddedKey}
        products={products ?? []}
        variantsByProduct={variantsByProduct}
        productStock={productStock}
        savedQualifiers={savedQualifiers}
        abbreviationRules={abbreviationRules}
        onUpdate={(patch) => updateItem(items[items.length - 1].key, patch)}
        onAddItem={addItem}
        onCommitQuickItems={commitQuickItems}
        onAdvanceToTotals={() => totalLrdRef.current?.focus()}
      />

      {/* Single Total Capture: one whole-ticket total, LRD first then USD
          -- submission blocks only when BOTH are left at zero. */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Total LRD">
          <input
            ref={totalLrdRef}
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
