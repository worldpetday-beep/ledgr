import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Currency } from '../db'
import { Card, Badge, BottomSheet, Field, Button, inputClass } from '../components/ui'
import { AlertIcon } from '../components/icons'
import { money, dateKeyMonrovia, isLowStock } from '../lib/format'
import { lrdAmountOf, usdAmountOf, withoutVoided } from '../lib/salesLedger'
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
import { format, subDays, startOfWeek, startOfMonth } from 'date-fns'

type DateFilter = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'custom'

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
]

const DAY_MS = 24 * 60 * 60 * 1000

// Liberia is UTC+0 year-round, so a Monrovia calendar day's midnight is
// exactly UTC midnight for that date string -- this stays correct
// regardless of which timezone the device itself is set to.
function monroviaDayStart(ts: number): number {
  return new Date(`${dateKeyMonrovia(ts)}T00:00:00Z`).getTime()
}

function rangeFor(filter: DateFilter, customStart: string, customEnd: string): { start: number; end: number; label: string } {
  const now = Date.now()
  const todayStart = monroviaDayStart(now)
  const todayEnd = todayStart + DAY_MS - 1

  if (filter === 'today') return { start: todayStart, end: todayEnd, label: format(todayStart, 'EEEE, MMM d') }
  if (filter === 'yesterday') {
    const y = todayStart - DAY_MS
    return { start: y, end: y + DAY_MS - 1, label: format(y, 'EEEE, MMM d') }
  }
  if (filter === 'thisWeek') {
    const weekStart = startOfWeek(new Date(todayStart), { weekStartsOn: 1 }).getTime()
    return { start: weekStart, end: todayEnd, label: `${format(weekStart, 'MMM d')} – ${format(todayStart, 'MMM d')}` }
  }
  if (filter === 'thisMonth') {
    const monthStart = startOfMonth(new Date(todayStart)).getTime()
    return { start: monthStart, end: todayEnd, label: format(monthStart, 'MMMM yyyy') }
  }
  // custom
  const start = customStart ? monroviaDayStart(new Date(`${customStart}T12:00:00Z`).getTime()) : todayStart
  const end = customEnd ? monroviaDayStart(new Date(`${customEnd}T12:00:00Z`).getTime()) + DAY_MS - 1 : todayEnd
  return {
    start,
    end,
    label: customStart && customEnd ? `${format(start, 'MMM d')} – ${format(end, 'MMM d')}` : 'Pick a custom range',
  }
}

export default function Dashboard() {
  const [filter, setFilter] = useState<DateFilter>('today')
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [trendCurrency, setTrendCurrency] = useState<Currency>('USD')

  const { start, end, label } = useMemo(() => rangeFor(filter, customStart, customEnd), [filter, customStart, customEnd])

  function selectFilter(value: DateFilter) {
    setFilter(value)
    if (value === 'custom') setCustomRangeOpen(true)
  }

  // Reactive query models -- every widget below recomputes the instant the
  // date filter (or the underlying data) changes.
  const salesInRangeRaw = useLiveQuery(() => db.sales.where('timestamp').between(start, end, true, true).toArray(), [start, end])
  const salesInRange = useMemo(() => withoutVoided(salesInRangeRaw ?? []), [salesInRangeRaw])
  const drawerCountsInRange = useLiveQuery(
    () => db.drawerCounts.where('timestamp').between(start, end, true, true).toArray(),
    [start, end],
  )
  // "Physical Drawer Balance" is a running, physically-counted total, not
  // something that sums across days -- so it's the most recent EOD close
  // at or before the end of the selected period, not an additive sum.
  const latestDrawerCount = useLiveQuery(() => db.drawerCounts.where('timestamp').belowOrEqual(end).last(), [end])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])

  const lowStockVariants = useMemo(() => {
    const productMap = new Map((products ?? []).map((p) => [p.id, p]))
    return (variants ?? [])
      .filter((v) => isLowStock(v.stockMyShop, v.lowStockThreshold))
      .map((v) => ({ ...v, productName: productMap.get(v.productId)?.name ?? 'Unknown item' }))
  }, [variants, products])

  // Card 1 — Total Revenue, dual currency.
  const revenue = useMemo(() => {
    let lrd = 0
    let usd = 0
    for (const s of salesInRange ?? []) {
      lrd += lrdAmountOf(s)
      usd += usdAmountOf(s)
    }
    return { lrd, usd }
  }, [salesInRange])

  // Net Profit — revenue minus each line's frozen cost-at-sale (the variant
  // Cost Price at the moment it was sold), feeding the top-right indicator.
  const netProfit = useMemo(() => {
    let lrd = 0
    let usd = 0
    for (const s of salesInRange ?? []) {
      const p = profitOf(s)
      if (s.currency === 'LRD') lrd += p
      else usd += p
    }
    return { lrd, usd }
  }, [salesInRange])

  // Card 2 — Hand Cash Log: the subset of revenue explicitly counted as
  // physical cash-in-hand (the EOD drawer-count entries logged for this
  // period), as opposed to revenue still sitting as an uncollected TBS balance.
  const handCash = useMemo(() => {
    let lrd = 0
    let usd = 0
    for (const d of drawerCountsInRange ?? []) {
      lrd += d.lrdActual
      usd += d.usdActual
    }
    return { lrd, usd }
  }, [drawerCountsInRange])

  // Card 3 — Physical Drawer Balance: latest counted balance carried forward.
  const drawerBalance = { lrd: latestDrawerCount?.lrdActual ?? 0, usd: latestDrawerCount?.usdActual ?? 0 }

  // Card 4 — Customer Traffic Counter: distinct customer tickets in range.
  const customerCount = useMemo(() => new Set((salesInRange ?? []).map((s) => s.customerNumber)).size, [salesInRange])

  const trend = useLiveQuery(async () => {
    const from = monroviaDayStart(subDays(Date.now(), 13).getTime())
    const rows = withoutVoided(await db.sales.where('timestamp').aboveOrEqual(from).toArray())
    const byDay = new Map<string, number>()
    for (let i = 13; i >= 0; i--) {
      const key = format(subDays(Date.now(), i), 'MMM d')
      byDay.set(key, 0)
    }
    for (const s of rows) {
      if (s.currency !== trendCurrency) continue
      const key = format(s.timestamp, 'MMM d')
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + s.soldFor)
    }
    return Array.from(byDay.entries()).map(([date, total]) => ({ date, total }))
  }, [trendCurrency])

  return (
    <div className="flex flex-col gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* Sticky Shopify-style global date filter */}
      <div className="sticky top-0 z-10 -mx-4 bg-[var(--page-plane)] px-4 pb-3 pt-1 md:-mx-8 md:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Financial Dashboard</h1>
            <p className="truncate text-sm text-[var(--text-secondary)]">{label}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Net Profit</div>
            <div className="tabular text-sm font-bold" style={{ color: '#1a7f37' }}>
              {money(netProfit.usd, 'USD')} + {money(netProfit.lrd, 'LRD')}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {DATE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => selectFilter(f.value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f.value
                  ? 'border-[var(--series-1)] bg-[var(--series-1)] text-white'
                  : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Core metric summary cards -- dual currency, responsive, never overflowing off-screen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Total Revenue</div>
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">LRD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(revenue.lrd, 'LRD')}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">USD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(revenue.usd, 'USD')}</span>
            </div>
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Hand Cash Log</div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Revenue explicitly counted as physical cash</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">LRD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(handCash.lrd, 'LRD')}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">USD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(handCash.usd, 'USD')}</span>
            </div>
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Physical Drawer Balance</div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Most recent counted balance as of this period</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">LRD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(drawerBalance.lrd, 'LRD')}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">USD</span>
              <span className="tabular truncate text-lg font-bold text-[var(--text-primary)]">{money(drawerBalance.usd, 'USD')}</span>
            </div>
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Customer Traffic</div>
          <div className="tabular mt-2 text-3xl font-bold text-[var(--text-primary)]">{customerCount}</div>
          <p className="text-xs text-[var(--text-secondary)]">{customerCount === 1 ? 'unique customer ticket' : 'unique customer tickets'} this period</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sales trend — last 14 days</h2>
            <div className="flex gap-1 rounded-lg bg-[var(--page-plane)] p-0.5">
              {(['USD', 'LRD'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setTrendCurrency(c)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    trendCurrency === c ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)]'
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
                  formatter={(v) => [money(Number(v), trendCurrency), 'Sales']}
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
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Low stock alerts</h2>
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

      <BottomSheet open={customRangeOpen} onClose={() => setCustomRangeOpen(false)}>
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Custom Date Range</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input type="date" className={inputClass} value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="date" className={inputClass} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => setCustomRangeOpen(false)} disabled={!customStart || !customEnd}>
            Apply range
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
