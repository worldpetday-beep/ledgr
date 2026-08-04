import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../db'
import { PDHeader, PDSaveButton, pdInputClass } from './productDetailShared'
import { selectOnFocus } from '../lib/format'

// Fast, price-only pass over every variant -- Enter advances straight to
// the next row's price field, matching Fill Missing Costs' rapid-entry
// feel, since this page exists purely so a price sweep never has to open
// each variant's full editor one at a time.
export function ProductPriceEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const variants = useLiveQuery(() => db.variants.where('productId').equals(productId).sortBy('order'), [productId])
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const loadedRef = useRef(false)
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!variants || loadedRef.current) return
    const initial: Record<number, string> = {}
    for (const v of variants) initial[v.id!] = v.sellPrice > 0 ? String(v.sellPrice) : ''
    setPrices(initial)
    loadedRef.current = true
  }, [variants])

  async function save() {
    if (!variants || saving) return
    setSaving(true)
    await db.transaction('rw', db.variants, async () => {
      for (const v of variants) {
        const next = Number(prices[v.id!]) || 0
        if (next !== v.sellPrice) await db.variants.update(v.id!, { sellPrice: next, updatedAt: Date.now() })
      }
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <PDHeader title="Pricing" onBack={onClose} right={<PDSaveButton onClick={save} saving={saving} />} />
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {(variants ?? []).map((v: Variant, index) => (
          <div key={v.id} className="flex items-center gap-3 border-b border-gray-50 py-3">
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-black">{v.label}</div>
            <input
              ref={(el) => {
                inputRefs.current[v.id!] = el
              }}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              autoFocus={index === 0}
              className={pdInputClass + ' w-28 text-right'}
              value={prices[v.id!] ?? ''}
              onFocus={selectOnFocus}
              onChange={(e) => setPrices((p) => ({ ...p, [v.id!]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const next = (variants ?? [])[index + 1]
                if (next) inputRefs.current[next.id!]?.focus()
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
