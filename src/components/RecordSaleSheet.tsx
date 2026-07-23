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
import { SearchIcon, PlusIcon, TrashIcon } from './icons'
import { money, selectOnFocus } from '../lib/format'

type Step = 'qty' | 'unit' | 'item' | 'price'

interface CommittedLine {
  key: string
  name: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  manualVariant: string
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
  manualVariant: string
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
    manualVariant: '',
    location,
  }
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

  const qtyRef = useRef<HTMLInputElement>(null)
  const customUnitRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLInputElement>(null)
  const manualVariantRef = useRef<HTMLInputElement>(null)
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

  const filteredProducts = useMemo(() => {
    if (!draft.query.trim()) return (products ?? []).slice(0, 6)
    const q = draft.query.toLowerCase()
    return (products ?? []).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)
  }, [products, draft.query])

  const variantsForSelected = draft.selectedProduct ? variantsByProduct.get(draft.selectedProduct.id!) ?? [] : []

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
    }
  }, [open])

  function startNewLine(location: FulfillmentLocation) {
    setDraft(blankDraft(location))
    setStep('qty')
    setGeneration((g) => g + 1)
  }

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

  function pickProduct(p: Product) {
    const variants = variantsByProduct.get(p.id!) ?? []
    setDraft((d) => ({ ...d, selectedProduct: p, query: p.name, selectedVariantId: variants[0]?.id ?? null }))
    if (variants.length <= 1) setStep('price')
  }

  function pickVariant(v: Variant) {
    setDraft((d) => ({ ...d, selectedVariantId: v.id! }))
    setStep('price')
  }

  function confirmItem() {
    const name = draft.selectedProduct ? draft.selectedProduct.name : draft.query.trim()
    if (!name) {
      setSaveError('Enter an item name or pick one from the list.')
      return
    }
    if (draft.selectedProduct && variantsForSelected.length > 1 && !draft.selectedVariantId) {
      setSaveError('Pick a variant for this item.')
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
        manualVariant: draft.manualVariant,
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
              const label = line.manualVariant.trim() || (existingVariants.length === 0 ? 'Standard' : '')
              const matching = label ? existingVariants.find((v) => v.label.toLowerCase() === label.toLowerCase()) : undefined
              if (matching) {
                variantId = matching.id
                variantLabel = matching.label
              } else if (existingVariants.length === 1 && !line.manualVariant.trim()) {
                variantId = existingVariants[0].id
                variantLabel = existingVariants[0].label
              } else {
                const newLabel = line.manualVariant.trim() || 'Standard'
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
              variantLabel = line.manualVariant.trim() || 'Standard'
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
        {step === 'qty' && (
          <div key={`qty-${generation}`} className="flex flex-col items-center gap-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Quantity</div>
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
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Unit — {draft.qty} of…
            </div>
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
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Item — {draft.qty} {unitLabel(draft)}
            </div>
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
                {draft.query && !draft.selectedProduct && filteredProducts.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
                    {filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => pickProduct(p)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--page-plane)]"
                      >
                        <ItemThumb image={p.images[0]} size={28} />
                        <span className="flex-1">{p.name}</span>
                        <span className="tabular text-xs text-[var(--text-muted)]">{productStock.get(p.id!) ?? 0} in stock</span>
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

            {draft.selectedProduct && variantsForSelected.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {variantsForSelected.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pickVariant(v)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      draft.selectedVariantId === v.id
                        ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                        : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}

            {!draft.selectedProduct && draft.query && (
              <input
                ref={manualVariantRef}
                className={inputClass}
                placeholder='Variant / size (optional), e.g. Blue, 4"'
                value={draft.manualVariant}
                onChange={(e) => setDraft((d) => ({ ...d, manualVariant: e.target.value }))}
                onKeyDown={onEnterAdvance(confirmItem)}
                enterKeyHint="done"
              />
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
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Price — {draft.qty} {unitLabel(draft)} · {draft.selectedProduct ? draft.selectedProduct.name : draft.query}
            </div>
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
        <Button onClick={submit} disabled={saving || lines.length === 0} className="w-full justify-center">
          {saving ? 'Saving…' : 'Record Sale'}
        </Button>
      </div>
    </BottomSheet>
  )
}
