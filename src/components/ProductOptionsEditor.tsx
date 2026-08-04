import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ProductOption } from '../db'
import { PDHeader, PDSaveButton, pdInputClass } from './productDetailShared'
import { PlusIcon, TrashIcon, XIcon } from './icons'

// Cartesian product of every option's values, e.g. Size:[S,M] x Color:[Red,Blue]
// -> [[S,Red],[S,Blue],[M,Red],[M,Blue]]. Options with no values yet are skipped.
function cartesian(options: ProductOption[]): string[][] {
  const withValues = options.filter((o) => o.values.length > 0)
  if (withValues.length === 0) return []
  return withValues.reduce<string[][]>(
    (acc, opt) => acc.flatMap((combo) => opt.values.map((val) => [...combo, val])),
    [[]],
  )
}

export function ProductOptionsEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const [draft, setDraft] = useState<ProductOption[]>([])
  const [newValueDrafts, setNewValueDrafts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!product || loadedRef.current) return
    setDraft(product.options.length ? product.options.map((o) => ({ ...o, values: [...o.values] })) : [{ name: '', values: [] }])
    loadedRef.current = true
  }, [product])

  // Rewrites the product's options and regenerates its variant set to match
  // -- but a variant is only ever ADDED here, never deleted. A combo that
  // no longer exists after this edit leaves its old variant exactly as it
  // was (still fully priced/stocked/sellable, still in every past Sale
  // record) -- it just stops being reachable through the Options UI, same
  // "never erase real data" rule the rest of the app follows.
  async function save() {
    if (saving) return
    setSaving(true)
    const cleaned = draft
      .map((o) => ({ name: o.name.trim(), values: o.values.map((v) => v.trim()).filter(Boolean) }))
      .filter((o) => o.name && o.values.length > 0)
    const combos = cartesian(cleaned)

    await db.transaction('rw', db.products, db.variants, async () => {
      await db.products.update(productId, { options: cleaned, updatedAt: Date.now() })
      const existing = await db.variants.where('productId').equals(productId).toArray()
      const byCombo = new Map(existing.map((v) => [v.optionValues.join(' '), v]))
      const now = Date.now()
      let order = existing.length
      for (const combo of combos) {
        const key = combo.join(' ')
        const match = byCombo.get(key)
        if (match) {
          const label = combo.join(' / ')
          if (match.label !== label) await db.variants.update(match.id!, { label, updatedAt: now })
        } else {
          await db.variants.add({
            productId,
            label: combo.join(' / '),
            optionValues: combo,
            costPrice: 0,
            costUnknown: true,
            sellPrice: 0,
            currency: 'USD',
            stockMyShop: 0,
            stockVishalShop: 0,
            lowStockThreshold: 3,
            order: order++,
            isNew: true,
            newSince: now,
            createdAt: now,
            updatedAt: now,
          })
        }
      }
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <PDHeader title="Options" onBack={onClose} right={<PDSaveButton onClick={save} saving={saving} />} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {draft.map((opt, oi) => (
            <div key={oi} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <input
                  className={pdInputClass}
                  placeholder="Option name, e.g. Size"
                  value={opt.name}
                  onChange={(e) => setDraft((d) => d.map((o, i) => (i === oi ? { ...o, name: e.target.value } : o)))}
                />
                <button
                  onClick={() => setDraft((d) => d.filter((_, i) => i !== oi))}
                  aria-label="Remove option"
                  className="shrink-0 text-gray-400 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {opt.values.map((val, vi) => (
                  <span key={vi} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm">
                    {val}
                    <button
                      onClick={() =>
                        setDraft((d) => d.map((o, i) => (i === oi ? { ...o, values: o.values.filter((_, j) => j !== vi) } : o)))
                      }
                      aria-label={`Remove ${val}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <input
                  className={pdInputClass}
                  placeholder="Add a value and press Enter"
                  value={newValueDrafts[oi] ?? ''}
                  onChange={(e) => setNewValueDrafts((d) => ({ ...d, [oi]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const val = (newValueDrafts[oi] ?? '').trim()
                      if (!val) return
                      setDraft((d) => d.map((o, i) => (i === oi ? { ...o, values: [...o.values, val] } : o)))
                      setNewValueDrafts((d) => ({ ...d, [oi]: '' }))
                    }
                  }}
                />
              </div>
            </div>
          ))}

          <button
            onClick={() => setDraft((d) => [...d, { name: '', values: [] }])}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-500"
          >
            <PlusIcon className="h-4 w-4" /> Add option
          </button>
        </div>
      </div>
    </div>
  )
}
