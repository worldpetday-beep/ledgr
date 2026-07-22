import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Currency } from '../db'
import { Card, StatTile, Badge } from '../components/ui'
import { AlertIcon } from '../components/icons'
import { money, startOfDay, endOfDay, isLowStock } from '../lib/format'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { format, subDays } from 'date-fns'

export default function Dashboard() {
  const [currency, setCurrency] = useState<Currency>('USD')
  const todayStart = startOfDay(Date.now())
  const todayEnd = endOfDay(Date.now())

  const todaySales = useLiveQuery(
    () => db.sales.where('timestamp').between(todayStart, todayEnd).toArray(),
    [todayStart, todayEnd],
  )

  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])

  const lowStockVariants = useMemo(() => {
    const productMap = new Map((products ?? []).map((p) => [p.id, p]))
    return (variants ?? [])
      .filter((v) => isLowStock(v.stockMyShop, v.lowStockThreshold))
      .map((v) => ({ ...v, productName: productMap.get(v.productId)?.name ?? 'Unknown item' }))
  }, [variants, products])

  const totalsByCurrency = useMemo(() => {
    const totals: Record<Currency, { sales: number; profit: number; count: number }> = {
      USD: { sales: 0, profit: 0, count: 0 },
      LRD: { sales: 0, profit: 0, count: 0 },
    }
    for (const s of todaySales ?? []) {
      totals[s.currency].sales += s.soldFor
      totals[s.currency].profit += profitOf(s)
      totals[s.currency].count += 1
    }
    return totals
  }, [todaySales])

  const trend = useLiveQuery(async () => {
    const from = startOfDay(subDays(Date.now(), 13).getTime())
    const rows = await db.sales.where('timestamp').aboveOrEqual(from).toArray()
    const byDay = new Map<string, number>()
    for (let i = 13; i >= 0; i--) {
      const key = format(subDays(Date.now(), i), 'MMM d')
      byDay.set(key, 0)
    }
    for (const s of rows) {
      if (s.currency !== currency) continue
      const key = format(s.timestamp, 'MMM d')
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + s.soldFor)
    }
    return Array.from(byDay.entries()).map(([date, total]) => ({ date, total }))
  }, [currency])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">Today, {format(Date.now(), 'EEEE MMM d')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Sales today (USD)" value={money(totalsByCurrency.USD.sales, 'USD')} sub={`${totalsByCurrency.USD.count} sales`} />
        <StatTile label="Profit today (USD)" value={money(totalsByCurrency.USD.profit, 'USD')} accent="var(--status-good)" />
        <StatTile label="Sales today (LRD)" value={money(totalsByCurrency.LRD.sales, 'LRD')} sub={`${totalsByCurrency.LRD.count} sales`} />
        <StatTile label="Profit today (LRD)" value={money(totalsByCurrency.LRD.profit, 'LRD')} accent="var(--status-good)" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sales trend — last 14 days</h2>
            <div className="flex gap-1 rounded-lg bg-[var(--page-plane)] p-0.5">
              {(['USD', 'LRD'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    currency === c ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--gridline)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--baseline)' }}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [money(Number(v), currency), 'Sales']}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Low stock alerts</h2>
            {lowStockVariants.length > 0 && <Badge tone="critical">{lowStockVariants.length}</Badge>}
          </div>
          {lowStockVariants.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing low on stock right now.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lowStockVariants.slice(0, 6).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 truncate">
                    <AlertIcon className="h-3.5 w-3.5 shrink-0 text-[var(--status-critical)]" />
                    <span className="truncate">
                      {v.productName}
                      {v.label && v.label !== 'Standard' ? ` — ${v.label}` : ''}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[var(--status-critical)]">{v.stockMyShop} left</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/inventory" className="mt-3 inline-block text-xs font-medium text-[var(--series-1)]">
            View inventory →
          </Link>
        </Card>
      </div>
    </div>
  )
}
