import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
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
} from '../db'
import { BottomSheet, Button, Field, inputClass, Badge, Pill, Switch } from './ui'
import { ItemThumb } from './ItemThumb'
import { SearchIcon, PlusIcon, TrashIcon } from './icons'
import { money, selectOnFocus } from '../lib/format'

interface SaleLineState {
  key: string
  query: string
  selectedProduct: Product | null
  selectedVariantId: number | null
  qty: number
  unitType: string
  customUnit: string
  manualVariant: string
  soldFor: number
  currency: Currency
  manualCost: number
}

function blankLine(currency: Currency = 'USD'): SaleLineState {
  return {
    key: `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    query: '',
    selectedProduct: null,
    selectedVariantId: null,
    qty: 1,
    unitType: 'Piece',
    customUnit: '',
    manualVariant: '',
    soldFor: 0,
    currency,
    manualCost: 0,
  }
}

interface LineLiveValues {
  name: string
  qty: number
  soldFor: number
  manualVariant: string
  manualCost: number
}

interface LineHandle {
  getLiveValues(): LineLiveValues
  focusQty(): void
}

function sumByCurrency(lines: { currency: Currency; amount: number }[]): Partial<Record<Currency, number>> {
  const totals: Partial<Record<Currency, number>> = {}
  for (const l of lines) totals[l.currency] = (totals[l.currency] ?? 0) + l.amount
  return totals
}

function formatCurrencyTotals(totals: Partial<Record<Currency, number>>): string {
  const parts = (Object.entries(totals) as [Currency, number][])
    .filter(([, amt]) => amt !== 0)
    .map(([cur, amt]) => money(amt, cur))
  return parts.length > 0 ? parts.join(' + ') : money(0, 'USD')
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

  const [lines, setLines] = useState<SaleLineState[]>([blankLine()])
  const [sameAsLast, setSameAsLast] = useState(false)
  const [tbs, setTbs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const lineHandles = useRef(new Map<string, LineHandle>())

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

  // Reset the whole sheet each time it's opened fresh.
  useEffect(() => {
    if (open) {
      setLines([blankLine()])
      setSameAsLast(false)
      setTbs(false)
      setSaveError(null)
      setSaving(false)
      setTimeout(() => {
        const firstKey = lines[0]?.key
        if (firstKey) lineHandles.current.get(firstKey)?.focusQty()
      }, 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function updateLine(key: string, patch: Partial<SaleLineState>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    const lastCurrency = lines[lines.length - 1]?.currency ?? 'USD'
    const newLine = blankLine(lastCurrency)
    setLines((prev) => [...prev, newLine])
    setTimeout(() => lineHandles.current.get(newLine.key)?.focusQty(), 50)
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
    lineHandles.current.delete(key)
  }

  const grandTotal = useMemo(
    () => formatCurrencyTotals(sumByCurrency(lines.map((l) => ({ currency: l.currency, amount: l.soldFor })))),
    [lines],
  )

  async function submit() {
    setSaveError(null)

    // Read every line's live DOM values rather than trusting closed-over
    // React state: if "Record Sale" is tapped in the same instant as the
    // last keystroke on any line, the click can fire before that
    // keystroke's state update has committed. Reading straight from each
    // line's inputs makes this immune to that race regardless of typing
    // or tapping speed.
    const resolved = lines.map((line) => {
      const live = lineHandles.current.get(line.key)?.getLiveValues() ?? {
        name: '',
        qty: 0,
        soldFor: 0,
        manualVariant: '',
        manualCost: 0,
      }
      const name = line.selectedProduct ? line.selectedProduct.name : live.name.trim()
      return { ...line, ...live, name }
    })

    for (const [i, line] of resolved.entries()) {
      if (!line.name) {
        setSaveError(`Item ${i + 1}: enter an item name, or pick one from the product search.`)
        return
      }
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        setSaveError(`Item ${i + 1}: quantity must be at least 1.`)
        return
      }
      if (!Number.isFinite(line.soldFor) || line.soldFor < 0) {
        setSaveError(`Item ${i + 1}: total can't be negative.`)
        return
      }
    }

    setSaving(true)
    try {
      await db.transaction('rw', db.sales, db.products, db.variants, db.settings, async () => {
        const customerNumber = sameAsLast && lastSale ? lastSale.customerNumber : await reserveNextCustomerNumber()
        const orderNumber = await reserveNextOrderNumber()
        const timestamp = Date.now()

        for (const line of resolved) {
          const selectedVariant = line.selectedProduct
            ? (variantsByProduct.get(line.selectedProduct.id!) ?? []).find((v) => v.id === line.selectedVariantId) ?? null
            : null
          const costUnknown = selectedVariant ? selectedVariant.costUnknown : line.manualCost <= 0
          const costTotal = selectedVariant ? selectedVariant.costPrice * line.qty : costUnknown ? 0 : line.manualCost

          let productId = line.selectedProduct?.id
          let variantId = selectedVariant?.id
          let productCategory = line.selectedProduct?.category
          let variantLabel: string | undefined = selectedVariant?.label

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
                  costPrice: costUnknown ? 0 : line.manualCost,
                  costUnknown,
                  sellPrice: line.qty > 0 ? line.soldFor / line.qty : line.soldFor,
                  currency: line.currency,
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
              productId = (await db.products.add({ name: line.name, category: 'General', archived: false, createdAt: now, updatedAt: now })) as number
              productCategory = 'General'
              variantLabel = line.manualVariant.trim() || 'Standard'
              variantId = await db.variants.add({
                productId,
                label: variantLabel,
                costPrice: costUnknown ? 0 : line.manualCost,
                costUnknown,
                sellPrice: line.qty > 0 ? line.soldFor / line.qty : line.soldFor,
                currency: line.currency,
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
            soldFor: line.soldFor,
            costAtSale: costTotal,
            currency: line.currency,
            timestamp,
            customerNumber,
            orderNumber,
            tbs,
            pickedUp: !tbs,
          })

          if (!tbs && variantId) {
            const fresh = await db.variants.get(variantId)
            if (fresh) {
              await db.variants.update(variantId, {
                stockMyShop: Math.max(0, fresh.stockMyShop - line.qty),
                updatedAt: Date.now(),
              })
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
    onSaved(`Recorded ${resolved.length} item${resolved.length === 1 ? '' : 's'} — ${grandTotal}`)
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

      <div className="flex flex-col gap-4">
        {lines.map((line, idx) => (
          <SaleLineItem
            key={line.key}
            ref={(handle) => {
              if (handle) lineHandles.current.set(line.key, handle)
              else lineHandles.current.delete(line.key)
            }}
            line={line}
            index={idx}
            canRemove={lines.length > 1}
            onChange={(patch) => updateLine(line.key, patch)}
            onRemove={() => removeLine(line.key)}
            onEnterSubmit={submit}
            products={products}
            variantsByProduct={variantsByProduct}
            productStock={productStock}
            categories={categories}
          />
        ))}

        <Button variant="secondary" onClick={addLine} className="self-start">
          <PlusIcon className="h-4 w-4" />
          Add more item
        </Button>

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
        <Button onClick={submit} disabled={saving} className="w-full justify-center">
          {saving ? 'Saving…' : 'Record Sale'}
        </Button>
      </div>
    </BottomSheet>
  )
}

const SaleLineItem = forwardRef<
  LineHandle,
  {
    line: SaleLineState
    index: number
    canRemove: boolean
    onChange: (patch: Partial<SaleLineState>) => void
    onRemove: () => void
    onEnterSubmit: () => void
    products: Product[] | undefined
    variantsByProduct: Map<number, Variant[]>
    productStock: Map<number, number>
    categories: Category[] | undefined
  }
>(function SaleLineItem(
  { line, index, canRemove, onChange, onRemove, onEnterSubmit, products, variantsByProduct, productStock, categories },
  ref,
) {
  const qtyRef = useRef<HTMLInputElement>(null)
  const customUnitRef = useRef<HTMLInputElement>(null)
  const itemInputRef = useRef<HTMLInputElement>(null)
  const manualVariantRef = useRef<HTMLInputElement>(null)
  const manualCostRef = useRef<HTMLInputElement>(null)
  const soldForRef = useRef<HTMLInputElement>(null)
  const unitChipRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const variantChipRefs = useRef<Record<number, HTMLButtonElement | null>>({})

  useImperativeHandle(ref, () => ({
    getLiveValues() {
      return {
        name: itemInputRef.current?.value ?? '',
        qty: qtyRef.current ? Number(qtyRef.current.value) || 0 : 0,
        soldFor: soldForRef.current ? Number(soldForRef.current.value) || 0 : 0,
        manualVariant: manualVariantRef.current?.value ?? '',
        manualCost: manualCostRef.current ? Number(manualCostRef.current.value) || 0 : 0,
      }
    },
    focusQty() {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    },
  }))

  const filteredProducts = useMemo(() => {
    if (!line.query.trim()) return (products ?? []).slice(0, 8)
    const q = line.query.toLowerCase()
    return (products ?? []).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [products, line.query])

  const variantsForSelected = line.selectedProduct ? variantsByProduct.get(line.selectedProduct.id!) ?? [] : []
  const selectedVariant = variantsForSelected.find((v) => v.id === line.selectedVariantId) ?? null

  const categoryAllowedUnits = useMemo(() => {
    const categoryName = line.selectedProduct?.category ?? 'General'
    const cat = (categories ?? []).find((c) => c.name === categoryName)
    return cat?.allowedUnits && cat.allowedUnits.length > 0 ? cat.allowedUnits : null
  }, [categories, line.selectedProduct])

  const availableUnits = useMemo(() => {
    if (!categoryAllowedUnits) return UNIT_TYPES
    const withOther = categoryAllowedUnits.includes('Other') ? categoryAllowedUnits : [...categoryAllowedUnits, 'Other']
    return withOther
  }, [categoryAllowedUnits])

  useEffect(() => {
    if (!availableUnits.includes(line.unitType)) onChange({ unitType: availableUnits[0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableUnits])

  function pickProduct(product: Product) {
    const variants = variantsByProduct.get(product.id!) ?? []
    const patch: Partial<SaleLineState> = { selectedProduct: product, query: product.name }
    if (variants.length >= 1) {
      const first = variants[0]
      patch.selectedVariantId = first.id!
      patch.currency = first.currency
      patch.soldFor = first.sellPrice * line.qty
    } else {
      patch.selectedVariantId = null
    }
    onChange(patch)
    setTimeout(() => {
      if (variants.length > 1) variantChipRefs.current[variants[0].id!]?.focus()
      else soldForRef.current?.focus()
    }, 0)
  }

  function pickVariant(variant: Variant) {
    onChange({ selectedVariantId: variant.id!, currency: variant.currency, soldFor: variant.sellPrice * line.qty })
    soldForRef.current?.focus()
  }

  function changeQty(next: number) {
    onChange({ qty: next, soldFor: selectedVariant ? selectedVariant.sellPrice * next : line.soldFor })
  }

  function chooseUnit(u: string) {
    onChange({ unitType: u })
    if (u === 'Other') setTimeout(() => customUnitRef.current?.focus(), 0)
    else setTimeout(() => itemInputRef.current?.focus(), 0)
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
    if (line.selectedProduct && variantsForSelected.length > 1) {
      variantChipRefs.current[variantsForSelected[0].id!]?.focus()
    } else if (!line.selectedProduct) {
      manualVariantRef.current?.focus()
    } else {
      soldForRef.current?.focus()
    }
  }

  const unitPrice = line.qty > 1 ? line.soldFor / line.qty : null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Item {index + 1}</span>
        {canRemove && (
          <button onClick={onRemove} className="text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Remove item">
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <Pill
        options={[{ label: 'USD', value: 'USD' }, { label: 'LRD', value: 'LRD' }]}
        value={line.currency}
        onChange={(v) => !selectedVariant && onChange({ currency: v })}
        className={selectedVariant ? 'opacity-50' : ''}
      />

      <Field label="Quantity">
        <input
          ref={qtyRef}
          type="number"
          inputMode="numeric"
          min={1}
          className={inputClass}
          value={line.qty}
          onFocus={selectOnFocus}
          onChange={(e) => changeQty(Number(e.target.value) || 1)}
          onKeyDown={onEnterAdvance(() => unitChipRefs.current[line.unitType]?.focus())}
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
                line.unitType === u
                  ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                  : 'border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-secondary)]'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        {line.unitType === 'Other' && (
          <input
            ref={customUnitRef}
            className={inputClass + ' mt-1.5'}
            placeholder="Custom unit"
            value={line.customUnit}
            onChange={(e) => onChange({ customUnit: e.target.value })}
            onKeyDown={onEnterAdvance(() => itemInputRef.current?.focus())}
            enterKeyHint="next"
          />
        )}
      </Field>

      <Field label="Item">
        <div className="relative flex items-center gap-2">
          {line.selectedProduct && <ItemThumb image={line.selectedProduct.image} size={36} />}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={itemInputRef}
              className={inputClass + ' pl-9'}
              placeholder="Search products or type a new item name"
              value={line.query}
              onChange={(e) => onChange({ query: e.target.value, selectedProduct: null, selectedVariantId: null })}
              onKeyDown={onEnterAdvance(afterItemAdvance)}
              enterKeyHint="next"
            />
            {line.query && !line.selectedProduct && filteredProducts.length > 0 && (
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
        {!line.selectedProduct && line.query && (
          <span className="text-xs text-[var(--text-muted)]">Not in inventory — will be added as a new item.</span>
        )}
      </Field>

      {line.selectedProduct && variantsForSelected.length > 1 && (
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
                  line.selectedVariantId === v.id
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

      {!line.selectedProduct && (
        <>
          <Field label="Variant / size (optional)">
            <input
              ref={manualVariantRef}
              className={inputClass}
              placeholder={'e.g. Blue, 4" or 3"'}
              value={line.manualVariant}
              onChange={(e) => onChange({ manualVariant: e.target.value })}
              onKeyDown={onEnterAdvance(() => soldForRef.current?.focus())}
              enterKeyHint="next"
            />
          </Field>
          <Field label="Crossed Cost Price (optional)">
            <input
              ref={manualCostRef}
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={line.manualCost}
              onFocus={selectOnFocus}
              onChange={(e) => onChange({ manualCost: Number(e.target.value) || 0 })}
            />
          </Field>
        </>
      )}

      <Field label="Total">
        <input
          ref={soldForRef}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={inputClass}
          value={line.soldFor}
          onFocus={selectOnFocus}
          onChange={(e) => onChange({ soldFor: Number(e.target.value) || 0 })}
          onKeyDown={onEnterAdvance(onEnterSubmit)}
          enterKeyHint="done"
        />
        {unitPrice != null && (
          <span className="text-xs text-[var(--text-muted)]">Unit Price: {money(unitPrice, line.currency)}</span>
        )}
      </Field>
    </div>
  )
})
