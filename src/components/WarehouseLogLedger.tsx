import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type StockTransfer, type Variant } from '../db'
import { money } from '../lib/format'
import { ChevronLeftIcon } from './icons'
import { format, startOfWeek, startOfMonth } from 'date-fns'

type GroupBy = 'day' | 'week' | 'month'

function groupKeyFor(dateStr: string, groupBy: GroupBy): { key: string; label: string } {
  const d = new Date(`${dateStr}T12:00:00`)
  if (groupBy === 'day') return { key: dateStr, label: format(d, 'EEEE, MMM d yyyy') }
  if (groupBy === 'week') {
    const weekStart = startOfWeek(d, { weekStartsOn: 1 })
    return { key: format(weekStart, 'yyyy-ww'), label: `Week of ${format(weekStart, 'MMM d, yyyy')}` }
  }
  const monthStart = startOfMonth(d)
  return { key: format(monthStart, 'yyyy-MM'), label: format(monthStart, 'MMMM yyyy') }
}

// Standalone historical log of real stock movement (db.stockTransfers --
// each row tied to an actual variant/productId, unlike the purely
// informational db.warehouseLedger free-text journal), grouped by day,
// week, or month with a running total of incoming cost price per group.
export function WarehouseLogLedger({ onClose }: { onClose: () => void }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('day')
  const transfers = useLiveQuery(() => db.stockTransfers.orderBy('createdAt').reverse().toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])

  const variantById = useMemo(() => new Map((variants ?? []).map((v) => [v.id!, v])), [variants])
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id!, p])), [products])

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; entries: StockTransfer[]; incomingCost: number }>()
    for (const t of transfers ?? []) {
      const { key, label } = groupKeyFor(t.date, groupBy)
      const g = map.get(key) ?? { label, entries: [], incomingCost: 0 }
      g.entries.push(t)
      if (t.direction === 'in') {
        const v: Variant | undefined = variantById.get(t.variantId)
        if (v) g.incomingCost += v.costPrice * t.qty
      }
      map.set(key, g)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [transfers, groupBy, variantById])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
        <button onClick={onClose} aria-label="Back" className="text-black">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="flex-1 truncate text-base font-semibold">Warehouse Log Ledger</h1>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-gray-100 bg-gray-50 p-2">
        {(['day', 'week', 'month'] as GroupBy[]).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${
              groupBy === g ? 'bg-black text-white' : 'bg-white text-gray-600'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">No warehouse transfers logged yet.</p>
        )}
        <div className="flex flex-col gap-4">
          {groups.map(([key, g]) => (
            <div key={key} className="rounded-xl border border-gray-100">
              <div className="flex items-center justify-between bg-gray-50 px-3 py-2.5">
                <span className="text-sm font-bold text-black">{g.label}</span>
                <span className="tabular text-xs font-semibold text-gray-600">
                  Incoming cost: {money(g.incomingCost, 'USD')}
                </span>
              </div>
              <div className="flex flex-col">
                {g.entries.map((t) => {
                  const v = variantById.get(t.variantId)
                  const p = productById.get(t.productId)
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 border-t border-gray-50 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {p?.name ?? 'Unknown item'}
                        {v && v.label !== 'Standard' ? ` — ${v.label}` : ''}
                      </span>
                      <span className={`tabular shrink-0 text-xs font-semibold ${t.direction === 'in' ? 'text-green-700' : 'text-amber-700'}`}>
                        {t.direction === 'in' ? '← In' : '→ Out'} · {t.qty}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
