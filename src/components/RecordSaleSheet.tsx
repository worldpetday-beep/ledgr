import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  reserveNextCustomerNumber,
  peekNextCustomerNumber,
  NEXT_CUSTOMER_NUMBER_KEY,
  UNIT_TYPES,
  type Currency,
  type Product,
  type Variant,
} from '../db'
import { BottomSheet, Button, Field, inputClass, Badge, Pill, Switch } from './ui'
import { ItemThumb } from './ItemThumb'
import { SearchIcon } from './icons'
import { money, selectOnFocus } from '../lib/format'

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

  const [query, setQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  const [unitType, setUnitType] = useState('Piece')
  const [customUnit, setCustomUnit] = useState('')
  const [soldFor, setSoldFor] = useState<number>(0)
  const [currency, setCurrency] = useState<Currency>('USD')
  const [manualVariant, setManualVariant] = useState('')
  const [manualCost, setManualCost] = useState<number>(0)
  const [costUnknown, setCostUnknown] = useState(true)
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qtyRef = useRef<HTMLInputElement>(null)
  const customUnitRef = useRef<HTMLInputElement>(null)
  const itemInputRef = useRef<HTMLInputElement>(null)
  const manualVariantRef = useRef<HTMLInputElement>(null)
  const manualCostRef = useRef<HTMLInputElement>(null)
  const soldForRef = useRef<HTMLInputElement>(null)
  const unitChipRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const variantChipRefs = useRef<Record<number, HTMLButtonElement | null>>({})

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
      map.set(productId, list.reduce((sum, v) => sum + v.stockMyShop, 0))
    }
    return map
  }, [variantsByProduct])

  const filteredProducts = useMemo(() => {
    if (!query.trim()) return (products ?? []).slice(0, 8)
    const q = query.toLowerCase()
    return (products ?? []).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [products, query])

  const variantsForSelected = selectedProduct ? variantsByProduct.get(selectedProduct.id!) ?? [] : []
  const selectedVariant = variantsForSelected.find((v) => v.id === selectedVariantId) ?? null

  const categoryAllowedUnits = useMemo(() => {
    const categoryName = selectedProduct?.category ?? 'General'
    const cat = (categories ?? []).find((c) => c.name === categoryName)
    return cat?.allowedUnits && cat.allowedUnits.length > 0 ? cat.allowedUnits : null
  }, [categories, selectedProduct])

  const availableUnits = useMemo(() => {
    if (!categoryAllowedUnits) return UNIT_TYPES
    const withOther = categoryAllowedUnits.includes('Other') ? categoryAllowedUnits : [...categoryAllowedUnits, 'Other']
    return withOther
  }, [categoryAllowedUnits])

  useEffect(() => {
    if (!availableUnits.includes(unitType)) setUnitType(availableUnits[0])
  }, [availableUnits, unitType])

  // Reset the whole sheet each time it's opened fresh.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedProduct(null)
      setSelectedVariantId(null)
      setQty(1)
      setUnitType('Piece')
      setCustomUnit('')
      setSoldFor(0)
      setManualVariant('')
      setManualCost(0)
      setCostUnknown(true)
      setTbs(false)
      setMoreOpen(false)
      setSaveError(null)
      setSaving(false)
      setTimeout(() => {
        qtyRef.current?.focus()
        qtyRef.current?.select()
      }, 50)
    }
  }, [open])

  function pickProduct(product: Product) {
    setSelectedProduct(product)
    setQuery(product.name)
    const variants = variantsByProduct.get(product.id!) ?? []
    if (variants.length >= 1) {
      const first = variants[0]
      setSelectedVariantId(first.id!)
      setCurrency(first.currency)
      setSoldFor(first.sellPrice * qty)
    } else {
      setSelectedVariantId(null)
    }
    setTimeout(() => {
      if (variants.length > 1) {
        variantChipRefs.current[variants[0].id!]?.focus()
      } else {
        soldForRef.current?.focus()
      }
    }, 0)
  }

  function pickVariant(variant: Variant) {
    setSelectedVariantId(variant.id!)
    setCurrency(variant.currency)
    setSoldFor(variant.sellPrice * qty)
    soldForRef.current?.focus()
  }

  function changeQty(next: number) {
    setQty(next)
    if (selectedVariant) setSoldFor(selectedVariant.sellPrice * next)
  }

  function chooseUnit(u: string) {
    setUnitType(u)
    if (u === 'Other') {
      setTimeout(() => customUnitRef.current?.focus(), 0)
    } else {
      setTimeout(() => itemInputRef.current?.focus(), 0)
    }
  }

  function onEnterAdvance(next: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        next()
      }
    }
  }

  function afterItemAdvance() {
    if (selectedProduct && variantsForSelected.length > 1) {
      const first = variantsForSelected[0]
      variantChipRefs.current[first.id!]?.focus()
    } else if (!selectedProduct) {
      manualVariantRef.current?.focus()
    } else {
      soldForRef.current?.focus()
    }
  }

  // Live preview only — informational, driven by React state so it updates
  // as you type. The actual save in submit() re-reads the DOM directly, so
  // this preview lagging by a keystroke (if ever) has no effect on what
  // gets recorded.
  const previewCostTotal = selectedVariant ? selectedVariant.costPrice * qty : costUnknown ? 0 : manualCost
  const previewProfit = soldFor - previewCostTotal

  async function submit() {
    setSaveError(null)

    // Read the live DOM values rather than trusting the closed-over React
    // state: if "Record sale" is tapped in the same instant as the last
    // keystroke, the click can fire before that keystroke's state update
    // has committed, which would otherwise silently save a stale (often
    // zero) value. Reading straight from the inputs makes this immune to
    // that race regardless of how fast the user types and taps.
    const qty = qtyRef.current ? Number(qtyRef.current.value) || 0 : 0
    const soldFor = soldForRef.current ? Number(soldForRef.current.value) || 0 : 0
    const manualName = itemInputRef.current?.value ?? ''
    const manualVariant = manualVariantRef.current?.value ?? ''
    const manualCost = manualCostRef.current ? Number(manualCostRef.current.value) || 0 : 0
    const costTotal = selectedVariant ? selectedVariant.costPrice * qty : costUnknown ? 0 : manualCost

    const name = selectedProduct ? selectedProduct.name : manualName.trim()
    if (!name) {
      setSaveError('Enter an item name, or pick one from the product search.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setSaveError('Quantity must be at least 1.')
      return
    }
    if (!Number.isFinite(soldFor) || soldFor < 0) {
      setSaveError("Sold for can't be negative.")
      return
    }

    setSaving(true)
    try {
      await db.transaction('rw', db.sales, db.products, db.variants, db.settings, async () => {
        const customerNumber = sameAsLast && lastSale ? lastSale.customerNumber : await reserveNextCustomerNumber()

        let productId = selectedProduct?.id
        let variantId = selectedVariant?.id
        let productCategory = selectedProduct?.category
        let variantLabel: string | undefined = selectedVariant?.label

        if (!selectedProduct) {
          const existingProduct = await db.products.where('name').equalsIgnoreCase(name).first()
          const now = Date.now()
          if (existingProduct) {
            productId = existingProduct.id
            productCategory = existingProduct.category
            const existingVariants = (await db.variants.where('productId').equals(existingProduct.id!).toArray()).sort(
              (a, b) => a.order - b.order,
            )
            const label = manualVariant.trim() || (existingVariants.length === 0 ? 'Standard' : '')
            const matching = label ? existingVariants.find((v) => v.label.toLowerCase() === label.toLowerCase()) : undefined
            if (matching) {
              variantId = matching.id
              variantLabel = matching.label
            } else if (existingVariants.length === 1 && !manualVariant.trim()) {
              variantId = existingVariants[0].id
              variantLabel = existingVariants[0].label
            } else {
              const newLabel = manualVariant.trim() || 'Standard'
              variantId = await db.variants.add({
                productId: existingProduct.id!,
                label: newLabel,
                costPrice: costUnknown ? 0 : manualCost,
                costUnknown,
                sellPrice: qty > 0 ? soldFor / qty : soldFor,
                currency,
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
            productId = (await db.products.add({ name, category: 'General', createdAt: now, updatedAt: now })) as number
            productCategory = 'General'
            variantLabel = manualVariant.trim() || 'Standard'
            variantId = await db.variants.add({
              productId,
              label: variantLabel,
              costPrice: costUnknown ? 0 : manualCost,
              costUnknown,
              sellPrice: qty > 0 ? soldFor / qty : soldFor,
              currency,
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
          qty,
          unitType: unitType === 'Other' ? customUnit.trim() || undefined : unitType,
          soldFor,
          costAtSale: costTotal,
          currency,
          timestamp: Date.now(),
          customerNumber,
          tbs,
          pickedUp: !tbs,
        })

        if (!tbs && variantId) {
          const fresh = await db.variants.get(variantId)
          if (fresh) {
            await db.variants.update(variantId, {
              stockMyShop: Math.max(0, fresh.stockMyShop - qty),
              updatedAt: Date.now(),
            })
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
    onSaved(`Recorded ${qty} × ${name} — ${money(soldFor, currency)}`)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Pill
          options={[{ label: 'USD', value: 'USD' }, { label: 'LRD', value: 'LRD' }]}
          value={currency}
          onChange={(v) => !selectedVariant && setCurrency(v)}
          className={selectedVariant ? 'opacity-50' : ''}
        />
        <div className="flex items-center gap-2">
          {lastSale && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={sameAsLast} onChange={(e) => setSameAsLast(e.target.checked)} />
              Same as #{lastSale.customerNumber}
            </label>
          )}
          <Badge tone="good">#{previewNumber}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Field label="Quantity">
          <input
            ref={qtyRef}
            type="number"
            inputMode="numeric"
            min={1}
            className={inputClass}
            value={qty}
            onFocus={selectOnFocus}
            onChange={(e) => changeQty(Number(e.target.value) || 1)}
            onKeyDown={onEnterAdvance(() => unitChipRefs.current[unitType]?.focus())}
            enterKeyHint="next"
          />
        </Field>

        <Field label="Unit">
          <div className="grid grid-cols-3 gap-1.5">
            {availableUnits.map((u) => (
              <button
                key={u}
                type="button"
                ref={(el) => { unitChipRefs.current[u] = el }}
                onClick={() => chooseUnit(u)}
                onKeyDown={onEnterAdvance(() => chooseUnit(u))}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  unitType === u
                    ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                    : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          {unitType === 'Other' && (
            <input
              ref={customUnitRef}
              className={inputClass + ' mt-1.5'}
              placeholder="Custom unit"
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value)}
              onKeyDown={onEnterAdvance(() => itemInputRef.current?.focus())}
              enterKeyHint="next"
            />
          )}
        </Field>

        <Field label="Item">
          <div className="relative flex items-center gap-2">
            {selectedProduct && <ItemThumb image={selectedProduct.image} size={36} />}
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={itemInputRef}
                className={inputClass + ' pl-9'}
                placeholder="Search products or type a new item name"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedProduct(null)
                  setSelectedVariantId(null)
                }}
                onKeyDown={onEnterAdvance(afterItemAdvance)}
                enterKeyHint="next"
              />
              {query && !selectedProduct && filteredProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pickProduct(p)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--page-plane)]"
                    >
                      <ItemThumb image={p.image} size={28} />
                      <span className="flex-1">{p.name}</span>
                      <span className="tabular text-xs text-[var(--text-muted)]">{productStock.get(p.id!) ?? 0} in stock</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {!selectedProduct && query && (
            <span className="text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
          )}
        </Field>

        {selectedProduct && variantsForSelected.length > 1 && (
          <Field label="Variant">
            <div className="flex flex-wrap gap-1.5">
              {variantsForSelected.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  ref={(el) => { variantChipRefs.current[v.id!] = el }}
                  onClick={() => pickVariant(v)}
                  onKeyDown={onEnterAdvance(() => pickVariant(v))}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedVariantId === v.id
                      ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                      : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
                  }`}
                >
                  {v.label} · {money(v.sellPrice, v.currency)}
                </button>
              ))}
            </div>
          </Field>
        )}

        {!selectedProduct && (
          <Field label="Variant / size (optional)">
            <input
              ref={manualVariantRef}
              className={inputClass}
              placeholder={'e.g. Blue, 4" or 3"'}
              value={manualVariant}
              onChange={(e) => setManualVariant(e.target.value)}
              onKeyDown={onEnterAdvance(() => soldForRef.current?.focus())}
              enterKeyHint="next"
            />
          </Field>
        )}

        <Field label="Sold for (total)">
          <input
            ref={soldForRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={inputClass}
            value={soldFor}
            onFocus={selectOnFocus}
            onChange={(e) => setSoldFor(Number(e.target.value) || 0)}
            onKeyDown={onEnterAdvance(() => submit())}
            enterKeyHint="done"
          />
        </Field>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="self-start text-xs font-medium text-[var(--series-1)]"
        >
          {moreOpen ? '▾ Hide options' : '▸ More options (cost, TBS)'}
        </button>

        {moreOpen && (
          <div className="flex flex-col gap-3 rounded-lg bg-[var(--page-plane)] p-2.5">
            {!selectedVariant && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Switch checked={costUnknown} onChange={setCostUnknown} label="I don't know the cost yet" />
                {!costUnknown && (
                  <input
                    ref={manualCostRef}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Cost (total)"
                    className={inputClass + ' w-36'}
                    value={manualCost}
                    onFocus={selectOnFocus}
                    onChange={(e) => setManualCost(Number(e.target.value) || 0)}
                  />
                )}
              </div>
            )}
            <Switch checked={tbs} onChange={setTbs} label="TBS — customer paid, will pick up goods later" />
          </div>
        )}
      </div>

      {saveError && (
        <div className="mt-3 rounded-lg bg-[var(--status-critical)]/10 px-3 py-2 text-sm text-[var(--status-critical)]">
          {saveError}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-[var(--gridline)] pt-3">
        <div className="text-sm text-[var(--text-secondary)]">
          Profit preview: <span className="tabular font-semibold text-[var(--status-good)]">{money(previewProfit, currency)}</span>
        </div>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Record sale'}
        </Button>
      </div>
    </BottomSheet>
  )
}
