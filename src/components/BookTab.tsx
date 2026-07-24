import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../db'
import { ChevronLeftIcon } from './icons'
import { DaybookRow } from './DaybookRow'
import { dateKeyMonrovia, formatDateMonrovia, formatTimeMonrovia, money } from '../lib/format'
import { lrdAmountOf, usdAmountOf, customerLabelOf } from '../lib/salesLedger'

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
      <button onClick={onBack} aria-label="Back" className="text-black">
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
    </div>
  )
}

function currencyPairText(usd: number, lrd: number): string {
  const parts: string[] = []
  if (usd > 0) parts.push(money(usd, 'USD'))
  if (lrd > 0) parts.push(money(lrd, 'LRD'))
  return parts.length > 0 ? parts.join(' + ') : money(0, 'USD')
}

interface ArchivedOrder {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
}

// A daily archive: past (non-today) dates indexed with their day-end grand
// total, and a static read-only ledger view of any given closed day.
export function BookTabView({ onClose }: { onClose: () => void }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const allSales = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const todayKey = dateKeyMonrovia(Date.now())

  const byDate = useMemo(() => {
    const map = new Map<string, Sale[]>()
    for (const s of allSales ?? []) {
      const key = dateKeyMonrovia(s.timestamp)
      if (key === todayKey) continue // today is still live, not archived yet
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    const days = Array.from(map.entries()).map(([key, lines]) => ({
      key,
      label: formatDateMonrovia(lines[0].timestamp),
      lines,
      usd: lines.reduce((s, l) => s + usdAmountOf(l), 0),
      lrd: lines.reduce((s, l) => s + lrdAmountOf(l), 0),
    }))
    days.sort((a, b) => (a.key < b.key ? 1 : -1))
    return days
  }, [allSales, todayKey])

  const selectedDay = byDate.find((d) => d.key === selectedDate)

  if (selectedDay) {
    const orderMap = new Map<number, Sale[]>()
    for (const s of selectedDay.lines) {
      const list = orderMap.get(s.orderNumber) ?? []
      list.push(s)
      orderMap.set(s.orderNumber, list)
    }
    const orders: ArchivedOrder[] = Array.from(orderMap.entries())
      .map(([orderNumber, lines]) => ({
        orderNumber,
        lines,
        timestamp: lines[0].timestamp,
        customerNumber: lines[0].customerNumber,
        customerName: lines.find((l) => l.customerName)?.customerName,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
        <Header title={selectedDay.label} onBack={() => setSelectedDate(null)} />
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 rounded-xl border border-gray-100 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Day-end total</div>
            <div className="tabular mt-1 text-lg font-bold">{currencyPairText(selectedDay.usd, selectedDay.lrd)}</div>
          </div>
          {orders.map((order) => (
            <div key={order.orderNumber} className="border-t border-gray-100 py-2 first:border-t-0">
              <div className="px-0.5 text-xs text-gray-400">
                #{order.orderNumber} · {customerLabelOf(order)} · {formatTimeMonrovia(order.timestamp)}
              </div>
              {order.lines.map((line) => (
                <DaybookRow key={line.id} sale={line} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-black">
      <Header title="Book Tab" onBack={onClose} />
      <div className="flex-1 overflow-y-auto">
        {byDate.map((d) => (
          <button
            key={d.key}
            onClick={() => setSelectedDate(d.key)}
            className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left"
          >
            <span className="font-medium">{d.label}</span>
            <span className="tabular text-sm text-gray-600">{currencyPairText(d.usd, d.lrd)}</span>
          </button>
        ))}
        {byDate.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            No closed days yet — today's sales will archive here once tomorrow starts.
          </p>
        )}
      </div>
    </div>
  )
}
