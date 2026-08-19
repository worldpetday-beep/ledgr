import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Currency, type SellUnit, type Variant } from '../db'
import { PDHeader, PDSaveButton, pdInputClass } from './productDetailShared'
import { ChevronRightIcon, TrashIcon, PlusIcon } from './icons'
import { money, selectOnFocus, variantDisplayLabel } from '../lib/format'
import { profitOfUnit } from '../lib/sellUnits'
import { priceStatsFor } from '../lib/priceStats'
import { withoutVoided } from '../lib/salesLedger'
import { guessUnit } from '../lib/unitGuess'

// One line of "here's what this unit has actually sold for" beneath a
// price field -- the reference price the shop owner sees next time isn't
// just whatever they last typed, it's this rolling average, unless
// `manual` is on. Lets them see the average and highest/lowest it's swung
// to before deciding whether to trust it or pin their own number.
function PriceStatsLine({
  stats,
  manual,
  onToggleManual,
  onUseAverage,
  currency,
}: {
  stats: { avg: number; min: number; max: number; count: number }
  manual: boolean
  onToggleManual: (v: boolean) => void
  onUseAverage: () => void
  currency: Currency
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] [color:var(--cl-ink-3)]">
      {stats.count > 0 ? (
        <span className="tabular">
          avg {money(stats.avg, currency)} · low {money(stats.min, currency)} · high {money(stats.max, currency)} · {stats.count} sale{stats.count === 1 ? '' : 's'}
        </span>
      ) : (
        <span>no sales yet</span>
      )}
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={manual} onChange={(e) => onToggleManual(e.target.checked)} />
        Pin this price
      </label>
      {manual && stats.count > 0 && (
        <button type="button" onClick={onUseAverage} className="font-semibold text-blue-600">
          Use average
        </button>
      )}
    </div>
  )
}

function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border [border-color:var(--cl-line)]">
      {(['USD', 'LRD'] as Currency[]).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`flex-1 px-2 py-2.5 text-xs font-bold ${value === c ? '[background:var(--cl-ink)] text-white' : '[color:var(--cl-ink-2)]'}`}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

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
  category,
  canDelete,
  onClose,
}: {
  variant: Variant
  productName: string
  category: string
  canDelete: boolean
  onClose: () => void
}) {
  const [label, setLabel] = useState(variant.label)
  const [sku, setSku] = useState(variant.sku ?? '')
  const [costPrice, setCostPrice] = useState(variant.costPrice)
  const [costUnknown, setCostUnknown] = useState(variant.costUnknown)
  const [sellPrice, setSellPrice] = useState(variant.sellPrice)
  const [currency, setCurrency] = useState<Currency>(variant.currency)
  const [sellPriceManual, setSellPriceManual] = useState(variant.sellPriceManual ?? false)
  const [sellUnits, setSellUnits] = useState<SellUnit[]>(variant.sellUnits ?? [])
  const [stockMyShop, setStockMyShop] = useState(variant.stockMyShop)
  const [stockVishalShop, setStockVishalShop] = useState(variant.stockVishalShop)
  const [lowStockThreshold, setLowStockThreshold] = useState(variant.lowStockThreshold)
  const [saving, setSaving] = useState(false)

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

  const salesRaw = useLiveQuery(() => db.sales.where('variantId').equals(variant.id!).toArray(), [variant.id])
  const sales = withoutVoided(salesRaw ?? [])
  const baseUnitName = guessUnit(`${productName} ${variant.label}`, category)
  const baseStats = priceStatsFor(sales, variant.id!, baseUnitName, currency)

  function addSellUnit() {
    setSellUnits((prev) => [...prev, { unit: '', factor: 1, price: 0, currency: 'USD' }])
  }
  function updateSellUnit(i: number, patch: Partial<SellUnit>) {
    setSellUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)))
  }
  function removeSellUnit(i: number) {
    setSellUnits((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    await db.variants.update(variant.id!, {
      label: label.trim() || variant.label,
      sku: sku.trim() || undefined,
      costPrice: costUnknown ? 0 : costPrice,
      costUnknown,
      sellPrice,
      currency,
      sellPriceManual,
      sellUnits: sellUnits.filter((u) => u.unit.trim() && u.factor > 0),
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
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={pdInputClass}
                  value={sellPrice}
                  onFocus={selectOnFocus}
                  onChange={(e) => setSellPrice(Number(e.target.value) || 0)}
                />
                <div className="w-20 shrink-0">
                  <CurrencyToggle value={currency} onChange={setCurrency} />
                </div>
              </div>
              <PriceStatsLine
                stats={baseStats}
                manual={sellPriceManual}
                onToggleManual={setSellPriceManual}
                onUseAverage={() => setSellPrice(Math.round(baseStats.avg * 100) / 100)}
                currency={currency}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Cost price (USD)</label>
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
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Also sold as</span>
              <button type="button" onClick={addSellUnit} className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                <PlusIcon className="h-3.5 w-3.5" /> Add a unit
              </button>
            </div>
            <p className="mb-2 text-xs [color:var(--cl-ink-3)]">
              Other ways to sell this same stock -- e.g. 1 Bundle = 20 Sheet at its own price and currency. Stock above stays counted in the base unit; each of these always deducts factor × qty from it.
            </p>
            {sellUnits.length === 0 && <p className="text-xs italic [color:var(--cl-ink-3)]">No extra units yet -- sold only as above.</p>}
            <div className="flex flex-col gap-2">
              {sellUnits.map((u, i) => {
                const profit = profitOfUnit(u, costUnknown ? 0 : costPrice, rate)
                const unitStats = u.unit.trim() ? priceStatsFor(sales, variant.id!, u.unit, u.currency) : { avg: 0, min: 0, max: 0, count: 0 }
                return (
                  <div key={i} className="rounded-lg border [border-color:var(--cl-line)] p-2.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        className={pdInputClass + ' flex-1'}
                        placeholder="Unit (e.g. Bundle)"
                        value={u.unit}
                        onChange={(e) => updateSellUnit(i, { unit: e.target.value })}
                      />
                      <button type="button" onClick={() => removeSellUnit(i)} aria-label="Remove unit" className="shrink-0 text-red-600">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">= how many base</label>
                        <input
                          type="number" min={0.01} step="0.01" className={pdInputClass} value={u.factor}
                          onFocus={selectOnFocus}
                          onChange={(e) => updateSellUnit(i, { factor: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">Price</label>
                        <input
                          type="number" min={0} step="0.01" className={pdInputClass} value={u.price}
                          onFocus={selectOnFocus}
                          onChange={(e) => updateSellUnit(i, { price: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">Currency</label>
                        <CurrencyToggle value={u.currency} onChange={(c) => updateSellUnit(i, { currency: c })} />
                      </div>
                    </div>
                    {!costUnknown && (
                      <p className="tabular mt-1.5 text-xs [color:var(--cl-ink-3)]">
                        profit {money(profit, u.currency)} per {u.unit || 'unit'}
                      </p>
                    )}
                    <PriceStatsLine
                      stats={unitStats}
                      manual={u.manual ?? false}
                      onToggleManual={(v) => updateSellUnit(i, { manual: v })}
                      onUseAverage={() => updateSellUnit(i, { price: Math.round(unitStats.avg * 100) / 100 })}
                      currency={u.currency}
                    />
                  </div>
                )
              })}
            </div>
          </div>

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
        category={product?.category ?? ''}
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
