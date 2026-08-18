import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../db'
import { PDHeader, PDSaveButton, pdInputClass } from './productDetailShared'
import { ChevronRightIcon, TrashIcon } from './icons'
import { money, selectOnFocus, variantDisplayLabel } from '../lib/format'

function StockField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border [border-color:var(--cl-line)] px-3 py-2">
      <span className="text-sm [color:var(--cl-ink-2)]">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full border [border-color:var(--cl-line)] text-base font-semibold [color:var(--cl-ink)]"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="tabular w-8 text-center text-sm font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-full border [border-color:var(--cl-line)] text-base font-semibold [color:var(--cl-ink)]"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

function SingleVariantEditor({
  variant,
  productName,
  canDelete,
  onClose,
}: {
  variant: Variant
  productName: string
  canDelete: boolean
  onClose: () => void
}) {
  const [label, setLabel] = useState(variant.label)
  const [sku, setSku] = useState(variant.sku ?? '')
  const [costPrice, setCostPrice] = useState(variant.costPrice)
  const [costUnknown, setCostUnknown] = useState(variant.costUnknown)
  const [sellPrice, setSellPrice] = useState(variant.sellPrice)
  const [stockMyShop, setStockMyShop] = useState(variant.stockMyShop)
  const [stockVishalShop, setStockVishalShop] = useState(variant.stockVishalShop)
  const [lowStockThreshold, setLowStockThreshold] = useState(variant.lowStockThreshold)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await db.variants.update(variant.id!, {
      label: label.trim() || variant.label,
      sku: sku.trim() || undefined,
      costPrice: costUnknown ? 0 : costPrice,
      costUnknown,
      sellPrice,
      stockMyShop,
      stockVishalShop,
      lowStockThreshold,
      updatedAt: Date.now(),
    })
    setSaving(false)
    onClose()
  }

  async function remove() {
    if (!window.confirm(`Remove variant "${variant.label}"? This cannot be undone.`)) return
    setSaving(true)
    await db.variants.delete(variant.id!)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-card)] [color:var(--cl-ink)]">
      <PDHeader title={variantDisplayLabel(productName, variant.label)} onBack={onClose} right={<PDSaveButton onClick={save} saving={saving} />} />
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Variant name</label>
            <input className={pdInputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Selling price</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={pdInputClass}
                value={sellPrice}
                onFocus={selectOnFocus}
                onChange={(e) => setSellPrice(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Cost price</label>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={costUnknown}
                className={pdInputClass + ' disabled:opacity-40'}
                value={costPrice}
                onFocus={selectOnFocus}
                onChange={(e) => setCostPrice(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm [color:var(--cl-ink)]">
            <input type="checkbox" checked={costUnknown} onChange={(e) => setCostUnknown(e.target.checked)} />
            Cost price unknown
          </label>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Inventory</div>
            <div className="flex flex-col gap-2">
              <StockField label="Store floor" value={stockMyShop} onChange={setStockMyShop} />
              <StockField label="Warehouse (Vishal)" value={stockVishalShop} onChange={setStockVishalShop} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Low stock alert below</label>
            <input
              type="number"
              min={0}
              className={pdInputClass}
              value={lowStockThreshold}
              onFocus={selectOnFocus}
              onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">SKU / barcode (optional)</label>
            <input className={pdInputClass} value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>

          {canDelete && (
            <button onClick={remove} disabled={saving} className="flex items-center gap-1.5 self-start text-sm font-medium text-red-600">
              <TrashIcon className="h-4 w-4" />
              Remove this variant
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProductVariantsEditor({ productId, onClose }: { productId: number; onClose: () => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const variants = useLiveQuery(() => db.variants.where('productId').equals(productId).sortBy('order'), [productId])
  const [editingId, setEditingId] = useState<number | null>(null)

  // If the currently-open single-variant editor's row disappears (deleted
  // elsewhere), fall back to the list instead of editing a ghost.
  useEffect(() => {
    if (editingId != null && variants && !variants.some((v) => v.id === editingId)) setEditingId(null)
  }, [editingId, variants])

  const editing = variants?.find((v) => v.id === editingId) ?? null
  if (editing) {
    return (
      <SingleVariantEditor
        variant={editing}
        productName={product?.name ?? ''}
        canDelete={(variants?.length ?? 0) > 1}
        onClose={() => setEditingId(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col [background:var(--cl-card)] [color:var(--cl-ink)]">
      <PDHeader title={`Variants (${variants?.length ?? 0})`} onBack={onClose} />
      <div className="flex-1 overflow-y-auto">
        {(variants ?? []).map((v) => (
          <button
            key={v.id}
            onClick={() => setEditingId(v.id!)}
            className="flex w-full items-center gap-3 border-b [border-color:var(--cl-line-2)] px-4 py-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium [color:var(--cl-ink)]">{variantDisplayLabel(product?.name ?? '', v.label)}</div>
              <div className="tabular truncate text-xs [color:var(--cl-ink-2)]">
                {money(v.sellPrice, v.currency)} · {v.stockMyShop + v.stockVishalShop} in stock
              </div>
            </div>
            <ChevronRightIcon className="h-4 w-4 shrink-0 [color:var(--cl-ink-3)]" />
          </button>
        ))}
      </div>
    </div>
  )
}
