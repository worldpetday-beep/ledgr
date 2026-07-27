import { useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../db'
import { selectOnFocus } from '../lib/format'
import { ChevronLeftIcon } from './icons'

function hasMissingCost(v: Variant): boolean {
  return v.costUnknown || !v.costPrice
}

// A dedicated batch-entry grid for every variant still missing a real cost
// price: each row's input auto-focuses in turn, and pressing Enter commits
// that row and instantly jumps focus to the next missing cell -- built for
// rapid, keyboard-only bulk entry rather than tapping in and out of each
// row individually.
export function FillMissingCostsView({ onClose }: { onClose: () => void }) {
  const variants = useLiveQuery(() => db.variants.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id!, p])), [products])

  const missing = useMemo(() => {
    return (variants ?? [])
      .filter(hasMissingCost)
      .map((v) => ({ variant: v, productName: productById.get(v.productId)?.name ?? 'Unknown item' }))
      .sort((a, b) => a.productName.localeCompare(b.productName))
  }, [variants, productById])

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  async function commit(variantId: number, raw: string, index: number) {
    const value = Number(raw) || 0
    await db.variants.update(variantId, { costPrice: value, costUnknown: false, updatedAt: Date.now() })
    const next = missing[index + 1]
    if (next) {
      setTimeout(() => inputRefs.current[next.variant.id!]?.focus(), 0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button onClick={onClose} aria-label="Back" className="text-black">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="flex-1 truncate text-base font-semibold">Fill Missing Costs</h1>
        <span className="shrink-0 text-xs text-gray-500">{missing.length} left</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {missing.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">Every variant already has a cost price. Nothing to fill.</p>
        ) : (
          <div className="flex flex-col">
            {missing.map(({ variant, productName }, index) => (
              <div key={variant.id} className="flex items-center gap-3 border-b border-gray-50 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-black">{productName}</div>
                  {variant.label !== 'Standard' && <div className="truncate text-xs text-gray-500">{variant.label}</div>}
                </div>
                <input
                  ref={(el) => {
                    inputRefs.current[variant.id!] = el
                  }}
                  autoFocus={index === 0}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="0.00"
                  className="tabular w-24 shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-right text-sm font-semibold text-black outline-none focus:border-black"
                  onFocus={selectOnFocus}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commit(variant.id!, (e.target as HTMLInputElement).value, index)
                    }
                  }}
                  onBlur={(e) => commit(variant.id!, e.target.value, index)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
