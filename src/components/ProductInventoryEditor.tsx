import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { PDHeader } from './productDetailShared'
import { selectOnFocus, variantDisplayLabel } from '../lib/format'

function InlineStepper({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  function step(delta: number) {
    const next = Math.max(0, (Number(text) || 0) + delta)
    setText(String(next))
    onCommit(next)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Decrease"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border [border-color:var(--cl-line)] text-sm font-bold [color:var(--cl-ink)]"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="tabular w-12 shrink-0 rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-1 py-1.5 text-center text-sm font-semibold [color:var(--cl-ink)] outline-none focus:[border-color:var(--cl-amber)]"
        value={text}
        onFocus={selectOnFocus}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Math.max(0, Number(text) || 0))}
      />
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Increase"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border [border-color:var(--cl-line)] text-sm font-bold [color:var(--cl-ink)]"
      >
        +
      </button>
    </div>
  )
}

// Every variant's stock in one flat, fast-editing list -- no need to drill
// into each variant's full editor just to bump a count.
export function ProductInventoryEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const variants = useLiveQuery(() => db.variants.where('productId').equals(productId).sortBy('order'), [productId])

  async function commitMyShop(variantId: number, next: number) {
    await db.variants.update(variantId, { stockMyShop: next, updatedAt: Date.now() })
  }
  async function commitVishalShop(variantId: number, next: number) {
    await db.variants.update(variantId, { stockVishalShop: next, updatedAt: Date.now() })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-card)] [color:var(--cl-ink)]">
      <PDHeader title="Inventory" onBack={onClose} />
      <div className="flex shrink-0 items-center justify-end gap-6 border-b [border-color:var(--cl-line)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">
        <span className="w-[92px] text-center">Store floor</span>
        <span className="w-[92px] text-center">Warehouse</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(variants ?? []).map((v) => (
          <div key={v.id} className="flex items-center gap-3 border-b [border-color:var(--cl-line-2)] px-4 py-3">
            <div className="min-w-0 flex-1 truncate text-sm font-medium [color:var(--cl-ink)]">{variantDisplayLabel(product?.name ?? '', v.label)}</div>
            <InlineStepper value={v.stockMyShop} onCommit={(n) => commitMyShop(v.id!, n)} />
            <InlineStepper value={v.stockVishalShop} onCommit={(n) => commitVishalShop(v.id!, n)} />
          </div>
        ))}
      </div>
    </div>
  )
}
