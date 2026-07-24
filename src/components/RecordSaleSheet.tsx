import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  reserveNextCustomerNumber,
  peekNextCustomerNumber,
  NEXT_CUSTOMER_NUMBER_KEY,
  reserveNextOrderNumber,
  UNIT_TYPES,
  type Currency,
  type Category,
  type Product,
  type Variant,
  type FulfillmentLocation,
} from '../db'
import { BottomSheet, Button, Field, inputClass, Badge, Pill, Switch } from './ui'
import { ItemThumb } from './ItemThumb'
import { SearchIcon, PlusIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from './icons'
import { money, selectOnFocus } from '../lib/format'

type Step = 'qty' | 'unit' | 'item' | 'price'
const STEP_ORDER: Step[] = ['qty', 'unit', 'item', 'price']

interface CommittedLine {
  key: string
  name: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  qty: number
  unitType: string
  customUnit: string
  location: FulfillmentLocation
  usdAmount: number
  lrdAmount: number
}

interface DraftLine {
  qty: number
  unitType: string
  customUnit: string
  query: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  location: FulfillmentLocation
}

function blankDraft(location: FulfillmentLocation = 'myShop'): DraftLine {
  return {
    qty: 1,
    unitType: 'Piece',
    customUnit: '',
    query: '',
    selectedProduct: null,
    selectedVariantId: null,
    location,
  }
}

interface ItemSuggestion {
  key: string
  product: Product
  variant: Variant | null
  label: string
}

function unitLabel(line: { unitType: string; customUnit: string }): string {
  return line.unitType === 'Other' ? line.customUnit.trim() || 'unit' : line.unitType
}

function formatLineAmounts(l: CommittedLine): string {
  const parts: string[] = []
  if (l.usdAmount > 0) parts.push(money(l.usdAmount, 'USD'))
  if (l.lrdAmount > 0) parts.push(money(l.lrdAmount, 'LRD'))
  return parts.length > 0 ? parts.join(' + ') : '—'
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

  const [lines, setLines] = useState<CommittedLine[]>([])
  const [step, setStep] = useState<Step>('qty')
  const [draft, setDraft] = useState<DraftLine>(blankDraft())
  const [generation, setGeneration] = useState(0) // bumped each time we start a fresh line, forces qty input remount+refocus
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const qtyRef = useRef<HTMLInputElement>(null)
  const customUnitRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLInputElement>(null)
  const usdRef = useRef<HTMLInputElement>(null)
  const lrdRef = useRef<HTMLInputElement>(null)

  const nextCounterRow = useLiveQuery(() => (open ? db.settings.get(NEXT_CUSTOMER_NUMBER_KEY) : undefined), [open])
  const nextNumber = peekNextCustomerNumber(nextCounterRow)
  const lastSale = useLiveQuery(() => (open ? db.sales.orderBy('timestamp').last() : undefined), [open])
  const previewNumber = sameAsLast && lastSale ? lastSale.customerNumber : nextNumber

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

  const categoryAllowedUnits = useMemo(() => {
    const categoryName = draft.selectedProduct?.category ?? 'General'
    const cat = (categories ?? []).find((c: Category) => c.name === categoryName)
    return cat?.allowedUnits && cat.allowedUnits.length > 0 ? cat.allowedUnits : null
  }, [categories, draft.selectedProduct])

  const availableUnits = useMemo(() => {
    if (!categoryAllowedUnits) return UNIT_TYPES
    return categoryAllowedUnits.includes('Other') ? categoryAllowedUnits : [...categoryAllowedUnits, 'Other']
  }, [categoryAllowedUnits])

  // A single, continuous free-text suggestion list: every variant of every
  // product renders as one full descriptor ("Mattress — 4\" Star Special
  // Double") so picking a match resolves the exact product+variant in one
  // tap, without a separate variant-chip step. Matches on the combined text
  // (and product name alone) so "historical" phrasing surfaces naturally.
  const itemSuggestions = useMemo<ItemSuggestion[]>(() => {
    const q = draft.query.trim().toLowerCase()
    const results: ItemSuggestion[] = []
    for (const p of products ?? []) {
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.length <= 1) {
        const v = variants[0] ?? null
        const label = v && v.label !== 'Standard' ? `${p.name} — ${v.label}` : p.name
        if (!q || label.toLowerCase().includes(q)) results.push({ key: `${p.id}-${v?.id ?? 'none'}`, product: p, variant: v, label })
      } else {
        for (const v of variants) {
          const label = `${p.name} — ${v.label}`
          if (!q || label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) {
            results.push({ key: `${p.id}-${v.id}`, product: p, variant: v, label })
          }
        }
      }
    }
    return results.slice(0, 8)
  }, [products, variantsByProduct, draft.query])

  // Reset the whole sheet each time it's opened fresh.
  useEffect(() => {
    if (open) {
      setLines([])
      setStep('qty')
      setDraft(blankDraft())
      setGeneration((g) => g + 1)
      setSameAsLast(false)
      setTbs(false)
      setSaveError(null)
      setSaving(false)
      setConfirmOpen(false)
    }
  }, [open])

  function startNewLine(location: FulfillmentLocation) {
    setDraft(blankDraft(location))
    setStep('qty')
    setGeneration((g) => g + 1)
  }

  function goBackStep() {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1])
    else onClose()
  }

  function goNextStep() {
    if (step === 'qty') advanceFromQty()
    else if (step === 'unit') chooseUnit(draft.unitType)
    else if (step === 'item') confirmItem()
    else commitLine()
  }

  // Make the phone's/browser's back button (hardware key or on-screen
  // gesture) step backward through the wizard exactly like the on-screen
  // Back arrow, instead of leaving the app. We reserve exactly one history
  // entry for the whole sheet lifetime: a "back" mid-wizard re-pushes it and
  // moves one step back; a "back" from the very first step lets the real
  // navigation happen, which closes the sheet.
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  }, [step])
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    window.history.pushState({ ledgrRecordSale: true }, '')
    let pushed = true

    function onPopState() {
      const idx = STEP_ORDER.indexOf(stepRef.current)
      if (idx > 0) {
        window.history.pushState({ ledgrRecordSale: true }, '')
        setStep(STEP_ORDER[idx - 1])
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

  function advanceFromQty() {
    const val = Number(qtyRef.current?.value) || 0
    if (val <= 0) {
      setSaveError('Quantity must be at least 1.')
      return
    }
    setSaveError(null)
    setDraft((d) => ({ ...d, qty: val }))
    setStep('unit')
  }

  function chooseUnit(u: string) {
    setDraft((d) => ({ ...d, unitType: u }))
    if (u === 'Other') {
      setTimeout(() => customUnitRef.current?.focus(), 0)
      return
    }
    setStep('item')
    setTimeout(() => itemRef.current?.focus(), 0)
  }

  // Selecting a suggestion ONLY resolves which product/variant + fills the
  // text field — it must never touch price or currency, so a re-sold item
  // never carries over a stale historical price (counter bargaining means
  // the price is different every time).
  function pickSuggestion(s: ItemSuggestion) {
    setDraft((d) => ({ ...d, selectedProduct: s.product, selectedVariantId: s.variant?.id ?? null, query: s.label }))
    setStep('price')
  }

  function confirmItem() {
    const name = draft.selectedProduct ? draft.selectedProduct.name : draft.query.trim()
    if (!name) {
      setSaveError('Enter an item name or pick one from the list.')
      return
    }
    setSaveError(null)
    setStep('price')
  }

  function commitLine() {
    const usdAmount = Number(usdRef.current?.value) || 0
    const lrdAmount = Number(lrdRef.current?.value) || 0
    if (usdAmount <= 0 && lrdAmount <= 0) {
      setSaveError('Enter a price in USD, LRD, or both.')
      return
    }
    const name = draft.selectedProduct ? draft.selectedProduct.name : draft.query.trim()
    setLines((prev) => [
      ...prev,
      {
        key: `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        selectedProduct: draft.selectedProduct,
        selectedVariantId: draft.selectedVariantId,
        qty: draft.qty,
        unitType: draft.unitType,
        customUnit: draft.customUnit,
        location: draft.location,
        usdAmount,
        lrdAmount,
      },
    ])
    setSaveError(null)
    startNewLine(draft.location)
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  function onEnterAdvance(next: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        next()
      }
    }
  }

  const grandTotalUsd = lines.reduce((s, l) => s + l.usdAmount, 0)
  const grandTotalLrd = lines.reduce((s, l) => s + l.lrdAmount, 0)
  const grandTotalParts: string[] = []
  if (grandTotalUsd > 0) grandTotalParts.push(money(grandTotalUsd, 'USD'))
  if (grandTotalLrd > 0) grandTotalParts.push(money(grandTotalLrd, 'LRD'))
  const grandTotal = grandTotalParts.length > 0 ? grandTotalParts.join(' + ') : money(0, 'USD')

  async function submit() {
    setSaveError(null)
    if (lines.length === 0) {
      setSaveError('Add at least one item before recording the sale.')
      return
    }

    setSaving(true)
    try {
      await db.transaction('rw', db.sales, db.products, db.variants, db.settings, async () => {
        const customerNumber = sameAsLast && lastSale ? lastSale.customerNumber : await reserveNextCustomerNumber()
        const orderNumber = await reserveNextOrderNumber()
        const timestamp = Date.now()

        for (const line of lines) {
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

          const primaryCurrency: Currency = line.usdAmount > 0 ? 'USD' : 'LRD'
          const primaryAmount = primaryCurrency === 'USD' ? line.usdAmount : line.lrdAmount
          const hasSecondary = line.usdAmount > 0 && line.lrdAmount > 0
          const secondaryCurrency: Currency | undefined = hasSecondary ? 'LRD' : undefined
          const secondaryAmount = hasSecondary ? line.lrdAmount : undefined

          if (!line.selectedProduct) {
            const existingProduct = await db.products.where('name').equalsIgnoreCase(line.name).first()
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
                name: line.name,
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
            itemName: line.name,
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
            location: line.location,
            tbs,
            pickedUp: !tbs,
          })

          if (!tbs && variantId) {
            const fresh = await db.variants.get(variantId)
            if (fresh) {
              const updated =
                line.location === 'vishalShop'
                  ? { stockVishalShop: Math.max(0, fresh.stockVishalShop - line.qty) }
                  : { stockMyShop: Math.max(0, fresh.stockMyShop - line.qty) }
              await db.variants.update(variantId, { ...updated, updatedAt: Date.now() })
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to record sale', err)
      setSaving(false)
      onError(err instanceof Error ? `Could not save this sale: ${err.message}` : 'Could not save this sale. Please try again.')
      return
    }

    setSaving(false)
    onSaved(`Recorded ${lines.length} item${lines.length === 1 ? '' : 's'} — ${grandTotal}`)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {lastSale && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={sameAsLast} onChange={(e) => setSameAsLast(e.target.checked)} />
              Same as #{lastSale.customerNumber}
            </label>
          )}
        </div>
        <Badge tone="good">#{previewNumber}</Badge>
      </div>

      {lines.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {l.qty} {unitLabel(l)} · {l.name}
                </div>
                <div className="tabular text-xs text-[var(--text-muted)]">{formatLineAmounts(l)}</div>
              </div>
              <button onClick={() => removeLine(l.key)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Remove item">
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={goBackStep} aria-label="Back" title="Back" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--page-plane)]">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {step === 'qty' && 'Quantity'}
            {step === 'unit' && `Unit — ${draft.qty} of…`}
            {step === 'item' && `Item — ${draft.qty} ${unitLabel(draft)}`}
            {step === 'price' && `Price — ${draft.qty} ${unitLabel(draft)} · ${draft.selectedProduct ? draft.selectedProduct.name : draft.query}`}
          </span>
          <button onClick={goNextStep} aria-label="Next" title="Next" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--series-1)] hover:bg-[var(--page-plane)]">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        {step === 'qty' && (
          <div key={`qty-${generation}`} className="flex flex-col items-center gap-3 py-2">
            <input
              ref={qtyRef}
              type="number"
              inputMode="numeric"
              min={1}
              autoFocus
              className="tabular w-32 rounded-xl border border-[var(--border)] bg-[var(--page-plane)] px-3 py-3 text-center text-3xl font-bold outline-none focus:border-[var(--series-1)]"
              defaultValue={draft.qty}
              onFocus={selectOnFocus}
              onKeyDown={onEnterAdvance(advanceFromQty)}
              enterKeyHint="next"
            />
            <Button onClick={advanceFromQty} className="w-full justify-center">Next</Button>
          </div>
        )}

        {step === 'unit' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {availableUnits.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => chooseUnit(u)}
                  className={`rounded-xl border px-2 py-3 text-sm font-semibold transition-colors ${
                    draft.unitType === u
                      ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                      : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            {draft.unitType === 'Other' && (
              <div className="flex items-center gap-2">
                <input
                  ref={customUnitRef}
                  className={inputClass}
                  placeholder="Custom unit"
                  value={draft.customUnit}
                  onChange={(e) => setDraft((d) => ({ ...d, customUnit: e.target.value }))}
                  onKeyDown={onEnterAdvance(() => {
                    setStep('item')
                    setTimeout(() => itemRef.current?.focus(), 0)
                  })}
                  enterKeyHint="next"
                />
                <Button
                  onClick={() => {
                    setStep('item')
                    setTimeout(() => itemRef.current?.focus(), 0)
                  }}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 'item' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {draft.selectedProduct && <ItemThumb image={draft.selectedProduct.images[0]} size={36} />}
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  ref={itemRef}
                  className={inputClass + ' pl-9'}
                  placeholder="Search or type a new item name"
                  value={draft.query}
                  onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value, selectedProduct: null, selectedVariantId: null }))}
                  onKeyDown={onEnterAdvance(confirmItem)}
                  enterKeyHint="done"
                />
                {draft.query && !draft.selectedProduct && itemSuggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
                    {itemSuggestions.map((s) => (
                      <button
                        key={s.key}
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
              <button
                onClick={confirmItem}
                aria-label="Confirm item"
                title="Confirm item"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--series-1)] text-white"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>

            {!draft.selectedProduct && draft.query && (
              <span className="text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
            )}

            <Field label="Fulfill from">
              <Pill
                options={[
                  { label: 'My Store Floor', value: 'myShop' },
                  { label: 'Warehouse (Vishal)', value: 'vishalShop' },
                ]}
                value={draft.location}
                onChange={(v) => setDraft((d) => ({ ...d, location: v }))}
              />
            </Field>
          </div>
        )}

        {step === 'price' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="USD">
                <input
                  ref={usdRef}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  autoFocus
                  className={inputClass + ' text-lg font-semibold'}
                  placeholder="0.00"
                  defaultValue=""
                  onFocus={selectOnFocus}
                  onKeyDown={onEnterAdvance(commitLine)}
                  enterKeyHint="done"
                />
              </Field>
              <Field label="LRD">
                <input
                  ref={lrdRef}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className={inputClass + ' text-lg font-semibold'}
                  placeholder="0.00"
                  defaultValue=""
                  onFocus={selectOnFocus}
                  onKeyDown={onEnterAdvance(commitLine)}
                  enterKeyHint="done"
                />
              </Field>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Fill in either currency, or both for a split payment.</p>
            <Button onClick={commitLine} className="w-full justify-center">
              <PlusIcon className="h-4 w-4" />
              Add Item
            </Button>
          </div>
        )}
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
        <Button onClick={() => setConfirmOpen(true)} disabled={saving || lines.length === 0} className="w-full justify-center">
          {saving ? 'Saving…' : 'Record Sale'}
        </Button>
      </div>

      <BottomSheet open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)}>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Confirm this sale?</h2>
          <div className="flex flex-col gap-1.5">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {l.qty} {unitLabel(l)} · {l.name}
                </span>
                <span className="tabular shrink-0 text-[var(--text-muted)]">{formatLineAmounts(l)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--gridline)] pt-3">
            <span className="text-sm font-semibold">Grand Total</span>
            <span className="tabular text-base font-bold">{grandTotal}</span>
          </div>
          <div className="mt-1 flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={saving} className="flex-1 justify-center">
              Back
            </Button>
            <Button onClick={submit} disabled={saving} className="flex-1 justify-center">
              {saving ? 'Saving…' : 'Confirm & Record'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </BottomSheet>
  )
}
