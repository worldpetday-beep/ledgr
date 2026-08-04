import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { PDHeader } from './productDetailShared'
import { selectOnFocus } from '../lib/format'

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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-300 text-sm font-bold text-black"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="tabular w-12 shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-1 py-1.5 text-center text-sm font-semibold text-black outline-none focus:border-black"
        value={text}
        onFocus={selectOnFocus}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Math.max(0, Number(text) || 0))}
      />
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Increase"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-300 text-sm font-bold text-black"
      >
        +
      </button>
    </div>
  )
}

// Every variant's stock in one flat, fast-editing list -- no need to drill
// into each variant's full editor just to bump a count.
export function ProductInventoryEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const variants = useLiveQuery(() => db.variants.where('productId').equals(productId).sortBy('order'), [productId])

  async function commitMyShop(variantId: number, next: number) {
    await db.variants.update(variantId, { stockMyShop: next, updatedAt: Date.now() })
  }
  async function commitVishalShop(variantId: number, next: number) {
    await db.variants.update(variantId, { stockVishalShop: next, updatedAt: Date.now() })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <PDHeader title="Inventory" onBack={onClose} />
      <div className="flex shrink-0 items-center justify-end gap-6 border-b border-gray-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        <span className="w-[92px] text-center">Store floor</span>
        <span className="w-[92px] text-center">Warehouse</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(variants ?? []).map((v) => (
          <div key={v.id} className="flex items-center gap-3 border-b border-gray-50 px-4 py-3">
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-black">{v.label}</div>
            <InlineStepper value={v.stockMyShop} onCommit={(n) => commitMyShop(v.id!, n)} />
            <InlineStepper value={v.stockVishalShop} onCommit={(n) => commitVishalShop(v.id!, n)} />
          </div>
        ))}
      </div>
    </div>
  )
}
