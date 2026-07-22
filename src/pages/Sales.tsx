import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Currency, type Sale } from '../db'
import { Card, Button, inputClass, Badge } from '../components/ui'
import { PlusIcon, TrashIcon, EditIcon } from '../components/icons'
import { useAppActions } from '../context/AppActions'
import { money, startOfDay, endOfDay, formatTimeMonrovia } from '../lib/format'
import { format } from 'date-fns'

export default function Sales() {
  const { openRecordSale } = useAppActions()
  const [dateStr, setDateStr] = useState(() => format(Date.now(), 'yyyy-MM-dd'))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  const dayStart = startOfDay(new Date(dateStr).getTime())
  const dayEnd = endOfDay(new Date(dateStr).getTime())

  const sales = useLiveQuery(
    () => db.sales.where('timestamp').between(dayStart, dayEnd, true, true).reverse().sortBy('timestamp'),
    [dayStart, dayEnd],
  )

  const totals = useMemo(() => {
    const t: Record<Currency, { sales: number; profit: number }> = {
      USD: { sales: 0, profit: 0 },
      LRD: { sales: 0, profit: 0 },
    }
    for (const s of sales ?? []) {
      t[s.currency].sales += s.soldFor
      t[s.currency].profit += profitOf(s)
    }
    return t
  }, [sales])

  async function deleteSale(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, async () => {
      await db.sales.delete(sale.id!)
      const stockWasDeducted = !sale.tbs || sale.pickedUp
      if (stockWasDeducted && sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) await db.variants.update(sale.variantId, { stock: variant.stock + sale.qty, updatedAt: Date.now() })
      }
    })
  }

  async function markPickedUp(sale: Sale) {
    await db.transaction('rw', db.sales, db.variants, async () => {
      await db.sales.update(sale.id!, { pickedUp: true })
      if (sale.variantId) {
        const variant = await db.variants.get(sale.variantId)
        if (variant) await db.variants.update(sale.variantId, { stock: Math.max(0, variant.stock - sale.qty), updatedAt: Date.now() })
      }
    })
  }

  function startEdit(sale: Sale) {
    setEditingId(sale.id!)
    setEditValue(sale.customerName ?? '')
  }

  async function saveEdit(sale: Sale) {
    await db.sales.update(sale.id!, { customerName: editValue.trim() || undefined })
    setEditingId(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sales Ledger</h1>
          <p className="text-sm text-[var(--text-secondary)]">Record and review daily sales</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className={inputClass + ' w-auto'}
          />
          <Button onClick={openRecordSale}>
            <PlusIcon className="h-4 w-4" />
            Record sale
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total sales (USD)</div>
          <div className="tabular text-lg font-semibold">{money(totals.USD.sales, 'USD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total profit (USD)</div>
          <div className="tabular text-lg font-semibold text-[var(--status-good)]">{money(totals.USD.profit, 'USD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total sales (LRD)</div>
          <div className="tabular text-lg font-semibold">{money(totals.LRD.sales, 'LRD')}</div>
        </Card>
        <Card>
          <div className="text-xs font-medium text-[var(--text-muted)]">Total profit (LRD)</div>
          <div className="tabular text-lg font-semibold text-[var(--status-good)]">{money(totals.LRD.profit, 'LRD')}</div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">
          {sales?.length ?? 0} sale{sales?.length === 1 ? '' : 's'} on {format(new Date(dateStr), 'MMM d, yyyy')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-[var(--text-muted)]">
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium">Qty</th>
                <th className="pb-2 font-medium">Sold for</th>
                <th className="pb-2 font-medium">Cost</th>
                <th className="pb-2 font-medium">Profit</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(sales ?? []).map((s) => (
                <tr key={s.id} className="border-t border-[var(--gridline)]">
                  <td className="py-2 pr-2">
                    {editingId === s.id ? (
                      <input
                        autoFocus
                        className={inputClass + ' w-28 py-1 text-xs'}
                        value={editValue}
                        placeholder={`Customer #${s.customerNumber}`}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(s)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(s)}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium whitespace-nowrap">
                          {s.customerName || `Customer #${s.customerNumber}`}
                        </span>
                        <button
                          onClick={() => startEdit(s)}
                          className="text-[var(--text-muted)] hover:text-[var(--series-1)]"
                          aria-label="Rename customer"
                        >
                          <EditIcon className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{s.itemName}</div>
                    <div className="flex items-center gap-1.5">
                      {s.variant && <span className="text-xs text-[var(--text-muted)]">{s.variant}</span>}
                      {s.tbs && !s.pickedUp && <Badge tone="warning">TBS — awaiting pickup</Badge>}
                      {s.tbs && s.pickedUp && <Badge tone="good">Picked up</Badge>}
                    </div>
                  </td>
                  <td className="tabular py-2 pr-2">
                    {s.qty}
                    {s.unitType && <span className="text-[var(--text-muted)]"> {s.unitType}</span>}
                  </td>
                  <td className="tabular py-2 pr-2">{money(s.soldFor, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--text-muted)]">{money(s.costAtSale, s.currency)}</td>
                  <td className="tabular py-2 pr-2 text-[var(--status-good)]">{money(profitOf(s), s.currency)}</td>
                  <td className="py-2 pr-2 text-[var(--text-muted)]">{formatTimeMonrovia(s.timestamp)}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.tbs && !s.pickedUp && (
                        <button
                          onClick={() => markPickedUp(s)}
                          className="whitespace-nowrap text-xs font-medium text-[var(--series-1)] hover:underline"
                        >
                          Mark picked up
                        </button>
                      )}
                      <button
                        onClick={() => deleteSale(s)}
                        className="text-[var(--text-muted)] hover:text-[var(--status-critical)]"
                        aria-label="Delete sale"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sales?.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-[var(--text-muted)]">
                    No sales recorded for this day yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
