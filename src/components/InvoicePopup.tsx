import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Sale, type Variant } from '../db'
import { BottomSheet } from './ui'
import { AlertIcon, TrashIcon } from './icons'
import { money, formatDateTimeMonrovia, selectOnFocus } from '../lib/format'
import { lrdAmountOf, usdAmountOf, deleteSaleLine, editSaleLine } from '../lib/salesLedger'

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
  const [busy, setBusy] = useState(false)

  const qtyNum = Number(qty) || 0
  const unitPriceMissing = sale.soldFor <= 0
  const unitPrice = qtyNum > 0 ? sale.soldFor / qtyNum : 0

  async function commit() {
    setBusy(true)
    await editSaleLine(sale, {
      qty: Number(qty) || 1,
      unitType: sale.unitType ?? 'Piece',
      usdAmount: Number(usdAmount) || 0,
      lrdAmount: Number(lrdAmount) || 0,
      location: sale.location,
      itemName: itemName.trim() || sale.itemName,
    })
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    await deleteSaleLine(sale)
    setBusy(false)
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start gap-2">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          className="w-14 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-semibold text-slate-900"
          value={qty}
          onFocus={selectOnFocus}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commit}
        />
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-medium text-slate-900"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          onBlur={commit}
        />
        <button onClick={remove} disabled={busy} aria-label="Delete line" className="shrink-0 p-1.5 text-slate-400 hover:text-red-600">
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-slate-500">Unit price</span>
        {unitPriceMissing ? <RedWarning text="Missing price" /> : <span className="tabular font-medium text-slate-900">{money(unitPrice, sale.currency)}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="text-slate-500">Stock remaining</span>
        {stock === null ? <RedWarning text="No inventory data" /> : <span className="tabular font-medium text-slate-900">{stock}</span>}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">LRD</label>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            placeholder="0.00"
            value={lrdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => setLrdAmount(e.target.value)}
            onBlur={commit}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">USD</label>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            placeholder="0.00"
            value={usdAmount}
            onFocus={selectOnFocus}
            onChange={(e) => setUsdAmount(e.target.value)}
            onBlur={commit}
          />
        </div>
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

  const soldUsd = order.lines.filter((l) => l.currency === 'USD').reduce((s, l) => s + l.soldFor, 0)
  const soldLrd = order.lines.filter((l) => l.currency === 'LRD').reduce((s, l) => s + l.soldFor, 0)
  const costUsd = order.lines.filter((l) => l.currency === 'USD').reduce((s, l) => s + l.costAtSale, 0)
  const costLrd = order.lines.filter((l) => l.currency === 'LRD').reduce((s, l) => s + l.costAtSale, 0)
  const profitUsd = order.lines.filter((l) => l.currency === 'USD').reduce((s, l) => s + profitOf(l), 0)
  const profitLrd = order.lines.filter((l) => l.currency === 'LRD').reduce((s, l) => s + profitOf(l), 0)

  return (
    <BottomSheet open={order != null} onClose={onClose} contentClassName="!bg-white !text-slate-900">
      <div className="flex max-w-full flex-col gap-4 overflow-x-hidden" style={{ boxSizing: 'border-box' }}>
        <div className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-lg font-bold text-slate-900">Invoice #{dailyIndex}</span>
            <span className="shrink-0 text-sm text-slate-500">{formatDateTimeMonrovia(order.timestamp)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {order.lines.length} item{order.lines.length === 1 ? '' : 's'} · Ticket #{order.orderNumber}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</label>
          <input
            className="w-full max-w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900"
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

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Profit matrix</div>
          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Sold total</span>
              <span className="tabular font-medium text-slate-900">
                {soldUsd > 0 && money(soldUsd, 'USD')}
                {soldUsd > 0 && soldLrd > 0 && ' + '}
                {soldLrd > 0 && money(soldLrd, 'LRD')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Cost total</span>
              <span className="tabular font-medium text-slate-900">
                {costUsd > 0 && money(costUsd, 'USD')}
                {costUsd > 0 && costLrd > 0 && ' + '}
                {costLrd > 0 && money(costLrd, 'LRD')}
                {costUsd <= 0 && costLrd <= 0 && '—'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5">
              <span className="font-semibold text-slate-700">Net profit</span>
              <span className="tabular font-bold text-green-700">
                {money(profitUsd, 'USD')} + {money(profitLrd, 'LRD')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}
