import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Product, type Sale, type Variant } from '../db'
import { BottomSheet } from './ui'
import { AlertIcon, TrashIcon, SearchIcon } from './icons'
import { money, formatDateTimeMonrovia, selectOnFocus } from '../lib/format'
import { lrdAmountOf, usdAmountOf, deleteSaleLine, editSaleLine, relinkSaleLine, saleValueUsd } from '../lib/salesLedger'

export interface InvoiceOrder {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
}

function RedWarning({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
      <AlertIcon className="h-3 w-3" />
      {text}
    </span>
  )
}

function InvoiceLineEditor({ sale, stock }: { sale: Sale; stock: number | null }) {
  const [itemName, setItemName] = useState(sale.itemName)
  const [qty, setQty] = useState(String(sale.qty))
  const [usdAmount, setUsdAmount] = useState(usdAmountOf(sale) > 0 ? String(usdAmountOf(sale)) : '')
  const [lrdAmount, setLrdAmount] = useState(lrdAmountOf(sale) > 0 ? String(lrdAmountOf(sale)) : '')
  const [costAtSale, setCostAtSale] = useState(String(sale.costAtSale || ''))
  const [busy, setBusy] = useState(false)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const [relinkQuery, setRelinkQuery] = useState('')

  const qtyNum = Number(qty) || 0
  const unitPriceMissing = sale.soldFor <= 0
  const unitPrice = qtyNum > 0 ? sale.soldFor / qtyNum : 0

  // Only loaded once the relink search is actually opened -- every other
  // order/line editor stays cheap.
  const allProducts = useLiveQuery(() => (relinkOpen ? db.products.toArray() : []), [relinkOpen])
  const allVariants = useLiveQuery(() => (relinkOpen ? db.variants.toArray() : []), [relinkOpen])
  const variantsByProduct = useMemo(() => {
    const map = new Map<number, Variant[]>()
    for (const v of allVariants ?? []) map.set(v.productId, [...(map.get(v.productId) ?? []), v])
    return map
  }, [allVariants])

  const relinkResults = useMemo(() => {
    const q = relinkQuery.trim().toLowerCase()
    if (!q) return []
    const results: { product: Product; variant: Variant | null; label: string }[] = []
    for (const p of allProducts ?? []) {
      if (p.archived) continue
      const variants = variantsByProduct.get(p.id!) ?? []
      if (variants.length <= 1) {
        if (p.name.toLowerCase().includes(q)) results.push({ product: p, variant: variants[0] ?? null, label: p.name })
      } else {
        for (const v of variants) {
          if (v.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) {
            results.push({ product: p, variant: v, label: `${p.name} — ${v.label}` })
          }
        }
      }
    }
    return results.slice(0, 8)
  }, [allProducts, variantsByProduct, relinkQuery])

  async function commit() {
    setBusy(true)
    await editSaleLine(sale, {
      qty: Number(qty) || 1,
      unitType: sale.unitType ?? 'Piece',
      usdAmount: Number(usdAmount) || 0,
      lrdAmount: Number(lrdAmount) || 0,
      location: sale.location,
      itemName: itemName.trim() || sale.itemName,
      costAtSale: Number(costAtSale) || 0,
    })
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    await deleteSaleLine(sale)
    setBusy(false)
  }

  async function relinkTo(product: Product, variant: Variant | null) {
    setBusy(true)
    await relinkSaleLine(sale, product, variant)
    setBusy(false)
    setRelinkOpen(false)
    setRelinkQuery('')
  }

  return (
    <div className="rounded-xl border [border-color:var(--cl-line)] [background:var(--cl-card)] p-3">
      <div className="flex items-start gap-2">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          className="w-14 shrink-0 rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-2 text-center text-sm font-semibold [color:var(--cl-ink)]"
          value={qty}
          onFocus={selectOnFocus}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commit}
        />
        <input
          className="min-w-0 flex-1 rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-2 text-sm font-medium [color:var(--cl-ink)]"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          onBlur={commit}
        />
        <button onClick={remove} disabled={busy} aria-label="Delete line" className="shrink-0 p-1.5 [color:var(--cl-ink-3)] hover:text-red-600">
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setRelinkOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium [color:var(--cl-ink-2)] hover:[color:var(--cl-ink)]"
      >
        <SearchIcon className="h-3 w-3" />
        {relinkOpen ? 'Cancel' : 'Relink to a different product'}
      </button>
      {relinkOpen && (
        <div className="mt-1.5">
          <input
            autoFocus
            className="w-full rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-1.5 text-sm [color:var(--cl-ink)]"
            placeholder="Search products…"
            value={relinkQuery}
            onChange={(e) => setRelinkQuery(e.target.value)}
          />
          {relinkResults.length > 0 && (
            <div className="mt-1 flex flex-col overflow-hidden rounded-lg border [border-color:var(--cl-line)]">
              {relinkResults.map((r) => (
                <button
                  key={`${r.product.id}-${r.variant?.id ?? 'none'}`}
                  type="button"
                  onClick={() => relinkTo(r.product, r.variant)}
                  disabled={busy}
                  className="border-t [border-color:var(--cl-line)] px-2.5 py-2 text-left text-sm [color:var(--cl-ink)] first:border-t-0 hover:[background:var(--cl-line-2)]"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="[color:var(--cl-ink-2)]">Unit price</span>
        {unitPriceMissing ? <RedWarning text="Missing price" /> : <span className="tabular font-medium [color:var(--cl-ink)]">{money(unitPrice, sale.currency)}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="[color:var(--cl-ink-2)]">Stock remaining</span>
        {stock === null ? <RedWarning text="No inventory data" /> : <span className="tabular font-medium [color:var(--cl-ink)]">{stock}</span>}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">LRD</label>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-1.5 text-sm [color:var(--cl-ink)]"
            placeholder="0.00"
            value={lrdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => setLrdAmount(e.target.value)}
            onBlur={commit}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">USD</label>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-1.5 text-sm [color:var(--cl-ink)]"
            placeholder="0.00"
            value={usdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => setUsdAmount(e.target.value)}
            onBlur={commit}
          />
        </div>
      </div>

      <div className="mt-2">
        <label className="mb-1 block text-[10px] font-semibold uppercase [color:var(--cl-ink-3)]">Cost at sale (total, for profit calc)</label>
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          className="w-full rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-2 py-1.5 text-sm [color:var(--cl-ink)]"
          placeholder="0.00"
          value={costAtSale}
          onFocus={selectOnFocus}
          onChange={(e) => setCostAtSale(e.target.value)}
          onBlur={commit}
        />
      </div>
    </div>
  )
}

// A full invoice view for one order: header (timestamp/item count/daily
// index), an editable customer identity field, per-line validation +
// in-place editing, and a profit matrix -- all in one surface so a mistake
// can be fixed without leaving the popup.
export function InvoicePopup({ order, dailyIndex, onClose }: { order: InvoiceOrder | null; dailyIndex: number; onClose: () => void }) {
  const [customerName, setCustomerName] = useState('')
  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE

  useEffect(() => {
    setCustomerName(order?.customerName ?? '')
  }, [order?.orderNumber, order?.customerName])

  const variantIds = (order?.lines ?? []).map((l) => l.variantId).filter((v): v is number => v != null)
  const variants = useLiveQuery(
    () => (variantIds.length ? db.variants.where('id').anyOf(variantIds).toArray() : Promise.resolve<Variant[]>([])),
    [variantIds.join(',')],
  )

  async function saveCustomerName() {
    if (!order) return
    const name = customerName.trim() || undefined
    await db.transaction('rw', db.sales, async () => {
      for (const line of order.lines) {
        await db.sales.update(line.id!, { customerName: name })
      }
    })
  }

  if (!order) {
    return <BottomSheet open={false} onClose={onClose}>{null}</BottomSheet>
  }

  // usdAmountOf/lrdAmountOf already pull the right amount out of a line
  // whichever side (primary or split-paid secondary) it's actually in --
  // summing sale.soldFor directly here would silently drop a line's LRD
  // portion whenever USD was its primary currency (or the reverse). Never
  // merged into one number: the pair is shown as typed, "$60.00 + L$4,000".
  const soldUsd = order.lines.reduce((s, l) => s + usdAmountOf(l), 0)
  const soldLrd = order.lines.reduce((s, l) => s + lrdAmountOf(l), 0)
  // Cost is always USD (see Variant.costPrice) regardless of the sale's own
  // currency -- bucketing it by sale.currency used to silently relabel a
  // real USD cost as an LRD one for every LRD-priced sale.
  const costTotal = order.lines.reduce((s, l) => s + l.costAtSale, 0)
  // Profit is one number, in USD -- both sides of the pair converted at the
  // rate that was actually in effect on each line, never per-currency
  // ("$X + L$0" implied the LRD half of a payment was worthless, which is
  // exactly the bug that made a real +$6.05 sale read as -$15.00). Lines
  // with no cost entered are excluded rather than counted as pure profit.
  const costedLines = order.lines.filter((l) => l.costAtSale > 0)
  const excludedLines = order.lines.length - costedLines.length
  const costedRevenueUsd = costedLines.reduce((s, l) => s + saleValueUsd(l, rate), 0)
  const profitUsdTotal = costedLines.reduce((s, l) => s + (saleValueUsd(l, rate) - l.costAtSale), 0)
  const marginPct = costedRevenueUsd > 0 ? Math.round((profitUsdTotal / costedRevenueUsd) * 100) : 0

  return (
    <BottomSheet open={order != null} onClose={onClose} contentClassName="![background:var(--cl-card)] ![color:var(--cl-ink)]">
      <div className="flex max-w-full flex-col gap-4 overflow-x-hidden" style={{ boxSizing: 'border-box' }}>
        <div className="border-b [border-color:var(--cl-line)] pb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-lg font-bold [color:var(--cl-ink)]">Invoice #{dailyIndex}</span>
            <span className="shrink-0 text-sm [color:var(--cl-ink-2)]">{formatDateTimeMonrovia(order.timestamp)}</span>
          </div>
          <div className="mt-1 text-sm [color:var(--cl-ink-2)]">
            {order.lines.length} item{order.lines.length === 1 ? '' : 's'} · Ticket #{order.orderNumber}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Customer</label>
          <input
            className="w-full max-w-full rounded-lg border [border-color:var(--cl-line)] [background:var(--cl-line-2)] px-3 py-2 text-sm font-medium [color:var(--cl-ink)]"
            style={{ boxSizing: 'border-box' }}
            value={customerName}
            placeholder={`Customer #${dailyIndex}`}
            onChange={(e) => setCustomerName(e.target.value)}
            onBlur={saveCustomerName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          {order.lines.map((line) => {
            const variant = variants?.find((v) => v.id === line.variantId)
            const stock = variant ? variant.stockMyShop + variant.stockVishalShop : null
            return <InvoiceLineEditor key={line.id} sale={line} stock={stock} />
          })}
        </div>

        <div className="rounded-xl border [border-color:var(--cl-line)] [background:var(--cl-line-2)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide [color:var(--cl-ink-3)]">Profit matrix</div>
          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="[color:var(--cl-ink-2)]">Sold total</span>
              <span className="tabular font-medium [color:var(--cl-ink)]">
                {soldUsd > 0 && money(soldUsd, 'USD')}
                {soldUsd > 0 && soldLrd > 0 && ' + '}
                {soldLrd > 0 && money(soldLrd, 'LRD')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="[color:var(--cl-ink-2)]">Cost total</span>
              <span className="tabular font-medium [color:var(--cl-ink)]">
                {costTotal > 0 ? money(costTotal, 'USD') : '—'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t [border-color:var(--cl-line)] pt-1.5">
              <span className="font-semibold [color:var(--cl-ink)]">Net profit</span>
              <span className="tabular font-bold text-green-700">
                {money(profitUsdTotal, 'USD')}{costedRevenueUsd > 0 && ` (${marginPct}%)`}
              </span>
            </div>
            {excludedLines > 0 && (
              <p className="mt-1 text-xs [color:var(--cl-ink-3)]">
                {excludedLines} line{excludedLines === 1 ? '' : 's'} excluded from profit — no cost price set.
              </p>
            )}
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}
