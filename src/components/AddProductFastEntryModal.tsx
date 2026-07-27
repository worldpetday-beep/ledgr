import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product } from '../db'
import { shopifyInputClass } from './ShopifyShell'
import { selectOnFocus } from '../lib/format'

// Finds an existing, non-archived product whose name overlaps with the
// typed description (either containing it or contained by it) -- same
// loose substring rule RecordSaleSheet's findMasterProductMatch uses, so
// typing "6ft Zinc Sheet" surfaces the existing "Zinc" product/master the
// same way a checkout line would.
function findRelatedProduct(typed: string, products: Product[]): Product | null {
  const clean = typed.trim().toLowerCase()
  if (clean.length < 3) return null
  for (const p of products) {
    if (p.archived) continue
    const name = p.name.toLowerCase()
    if (name === clean) continue
    if (clean.includes(name) || name.includes(clean)) return p
  }
  return null
}

// Compact replacement for the old full-screen "New product" page: a
// centered modal with just the three fields a fast walk-in entry actually
// needs (description, cost, stock qty), Enter chained straight through all
// three into a final confirm step, plus an inline fuzzy-match suggestion
// that offers to fold the new item into an existing product/master instead
// of always spinning up a brand-new standalone one.
export function AddProductFastEntryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (productId: number) => void
}) {
  const [stage, setStage] = useState<'entry' | 'confirm'>('entry')
  const [description, setDescription] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [stockQty, setStockQty] = useState('')
  const [parentProduct, setParentProduct] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)

  const descRef = useRef<HTMLInputElement>(null)
  const costRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    descRef.current?.focus()
  }, [])

  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const variantCounts = useLiveQuery(async () => {
    const counts = new Map<number, number>()
    for (const v of await db.variants.toArray()) {
      counts.set(v.productId, (counts.get(v.productId) ?? 0) + 1)
    }
    return counts
  }, []) ?? new Map<number, number>()

  const suggestion = useMemo(() => {
    if (parentProduct) return null
    return findRelatedProduct(description, products)
  }, [description, products, parentProduct])

  const suggestionIsMaster = suggestion ? (variantCounts.get(suggestion.id!) ?? 0) > 1 : false

  function onDescriptionEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    costRef.current?.focus()
  }

  function onCostEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    stockRef.current?.focus()
  }

  function onStockEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!description.trim()) {
      descRef.current?.focus()
      return
    }
    setStage('confirm')
  }

  async function confirmSave() {
    if (!description.trim() || saving) return
    setSaving(true)
    const now = Date.now()
    const name = description.trim()
    const cost = Number(costPrice) || 0
    const qty = Number(stockQty) || 0

    try {
      const productId = await db.transaction('rw', db.products, db.variants, async () => {
        if (parentProduct) {
          const siblings = await db.variants.where('productId').equals(parentProduct.id!).toArray()
          // Folding into a still-loose (single-variant) product turns it
          // into a proper master -- if that lone sibling is still sitting
          // on the generic "Standard" label, rename it to the parent's own
          // name first so it doesn't read as a mystery row next to the new
          // one (same convention used when Group…/Link to Master merges).
          if (siblings.length === 1 && siblings[0].label === 'Standard') {
            await db.variants.update(siblings[0].id!, { label: parentProduct.name, updatedAt: now })
          }
          await db.variants.add({
            productId: parentProduct.id!,
            label: name,
            optionValues: [],
            costPrice: cost,
            costUnknown: false,
            sellPrice: 0,
            currency: 'USD',
            stockMyShop: qty,
            stockVishalShop: 0,
            lowStockThreshold: 3,
            order: siblings.length,
            isNew: true,
            newSince: now,
            createdAt: now,
            updatedAt: now,
          })
          return parentProduct.id!
        }

        const newProductId = (await db.products.add({
          name,
          category: 'General',
          description: '',
          images: [],
          options: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        })) as number
        await db.variants.add({
          productId: newProductId,
          label: 'Standard',
          optionValues: [],
          costPrice: cost,
          costUnknown: false,
          sellPrice: 0,
          currency: 'USD',
          stockMyShop: qty,
          stockVishalShop: 0,
          lowStockThreshold: 3,
          order: 0,
          isNew: true,
          newSince: now,
          createdAt: now,
          updatedAt: now,
        })
        return newProductId
      })
      onCreated(productId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pb-6 pt-[8vh]">
      <div className="flex aspect-[3/4] w-full max-w-[340px] flex-col overflow-hidden rounded-2xl bg-white text-black shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <h1 className="text-sm font-semibold">{stage === 'entry' ? 'Quick Add Item' : 'Confirm This Inventory Entry'}</h1>
          <button onClick={onClose} aria-label="Close" className="text-sm font-medium text-gray-400">
            Cancel
          </button>
        </div>

        {stage === 'entry' ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Item Description</label>
              <input
                ref={descRef}
                className={shopifyInputClass}
                placeholder="e.g. Star Special Double Mattress"
                value={description}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setParentProduct(null)
                }}
                onKeyDown={onDescriptionEnter}
              />
              {suggestion && (
                <button
                  type="button"
                  onClick={() => setParentProduct(suggestion)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                >
                  {suggestionIsMaster ? `Add under "${suggestion.name}"?` : `Combine under "${suggestion.name}" folder?`}
                </button>
              )}
              {parentProduct && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  Linking under "{parentProduct.name}"
                  <button type="button" onClick={() => setParentProduct(null)} aria-label="Remove link" className="text-emerald-600">
                    ×
                  </button>
                </span>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Cost Price</label>
              <input
                ref={costRef}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                className={shopifyInputClass}
                value={costPrice}
                onFocus={selectOnFocus}
                onChange={(e) => setCostPrice(e.target.value)}
                onKeyDown={onCostEnter}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Inventory Stock Qty</label>
              <input
                ref={stockRef}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="0"
                className={shopifyInputClass}
                value={stockQty}
                onFocus={selectOnFocus}
                onChange={(e) => setStockQty(e.target.value)}
                onKeyDown={onStockEnter}
              />
            </div>

            <button
              type="button"
              disabled={!description.trim()}
              onClick={() => setStage('confirm')}
              className="mt-auto w-full rounded-lg bg-black py-2.5 text-sm font-semibold text-white disabled:opacity-30"
            >
              Continue
            </button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Item</span>
                <span className="min-w-0 truncate text-right font-semibold">{description.trim()}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Cost Price</span>
                <span className="tabular font-semibold">{Number(costPrice) || 0}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Stock Qty</span>
                <span className="tabular font-semibold">{Number(stockQty) || 0}</span>
              </div>
              {parentProduct && (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Grouped under</span>
                  <span className="min-w-0 truncate text-right font-semibold">{parentProduct.name}</span>
                </div>
              )}
            </div>

            <div className="mt-auto flex gap-2">
              <button
                type="button"
                onClick={() => setStage('entry')}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-700"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={confirmSave}
                className="flex-1 rounded-lg bg-black py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
