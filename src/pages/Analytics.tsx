import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, EXCHANGE_RATE_KEY, DEFAULT_EXCHANGE_RATE, type Currency } from '../db'
import { Card, Button, inputClass } from '../components/ui'
import { money, startOfDay } from '../lib/format'
import { subDays, format } from 'date-fns'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'

const HOUR_LABELS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const RANGE_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

export default function Analytics() {
  const [rangeDays, setRangeDays] = useState(30)
  const [currency, setCurrency] = useState<Currency>('USD')

  const from = startOfDay(subDays(Date.now(), rangeDays - 1).getTime())

  const sales = useLiveQuery(
    () => db.sales.where('timestamp').aboveOrEqual(from).and((s) => s.currency === currency).toArray(),
    [from, currency],
  )

  // Money overview: ledger revenue for the selected range, the all-time
  // running total (grows automatically as sales are recorded), and a manual
  // drawer cash count for reconciliation.
  const rangeSalesAllCurrencies = useLiveQuery(() => db.sales.where('timestamp').aboveOrEqual(from).toArray(), [from])
  const rangeTotals = useMemo(() => {
    const t: Record<Currency, number> = { USD: 0, LRD: 0 }
    for (const s of rangeSalesAllCurrencies ?? []) t[s.currency] += s.soldFor
    return t
  }, [rangeSalesAllCurrencies])

  const allSales = useLiveQuery(() => db.sales.toArray(), [])
  const allTimeTotals = useMemo(() => {
    const t: Record<Currency, number> = { USD: 0, LRD: 0 }
    for (const s of allSales ?? []) t[s.currency] += s.soldFor
    return t
  }, [allSales])

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const rate = rateRow ? Number(rateRow.value) : DEFAULT_EXCHANGE_RATE
  const blendedUsd = allTimeTotals.USD + allTimeTotals.LRD / rate

  const drawerCounts = useLiveQuery(() => db.drawerCounts.orderBy('timestamp').reverse().toArray(), [])
  const latestCount = drawerCounts?.[0]
  const [usdActual, setUsdActual] = useState('')
  const [lrdActual, setLrdActual] = useState('')
  const [countNote, setCountNote] = useState('')

  async function saveDrawerCount() {
    if (usdActual === '' && lrdActual === '') return
    await db.drawerCounts.add({
      timestamp: Date.now(),
      usdActual: Number(usdActual) || 0,
      lrdActual: Number(lrdActual) || 0,
      note: countNote.trim() || undefined,
    })
    setUsdActual('')
    setLrdActual('')
    setCountNote('')
  }

  const topItems = useMemo(() => {
    const byItem = new Map<string, number>()
    for (const s of sales ?? []) byItem.set(s.itemName, (byItem.get(s.itemName) ?? 0) + s.qty)
    return Array.from(byItem.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)
  }, [sales])

  const topCustomers = useMemo(() => {
    const byCustomer = new Map<number, { paid: number; qty: number }>()
    for (const s of sales ?? []) {
      const entry = byCustomer.get(s.customerNumber) ?? { paid: 0, qty: 0 }
      entry.paid += s.soldFor
      entry.qty += s.qty
      byCustomer.set(s.customerNumber, entry)
    }
    return Array.from(byCustomer.entries())
      .map(([customerNumber, v]) => ({ customer: `#${customerNumber}`, ...v }))
      .sort((a, b) => b.paid - a.paid)
      .slice(0, 8)
  }, [sales])

  const byHour = useMemo(() => {
    const counts = new Array(24).fill(0)
    for (const s of sales ?? []) counts[new Date(s.timestamp).getHours()] += 1
    return counts.map((count, h) => ({ hour: HOUR_LABELS[h], count }))
  }, [sales])

  const byDay = useMemo(() => {
    const counts = new Array(7).fill(0)
    for (const s of sales ?? []) counts[new Date(s.timestamp).getDay()] += 1
    return counts.map((count, d) => ({ day: DAY_LABELS[d], count }))
  }, [sales])

  const peakHour = useMemo(() => {
    if (!byHour.some((h) => h.count > 0)) return null
    return byHour.reduce((a, b) => (b.count > a.count ? b : a))
  }, [byHour])

  const peakDay = useMemo(() => {
    if (!byDay.some((d) => d.count > 0)) return null
    return byDay.reduce((a, b) => (b.count > a.count ? b : a))
  }, [byDay])

  const tooltipStyle = {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Patterns from your recorded sales — top items and busiest times.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-[var(--surface-1)] p-0.5 border border-[var(--border)]">
            {(['USD', 'LRD'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  currency === c ? 'bg-[var(--page-plane)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg bg-[var(--surface-1)] p-0.5 border border-[var(--border)]">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  rangeDays === r.days ? 'bg-[var(--page-plane)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Ledger revenue — {RANGE_OPTIONS.find((r) => r.days === rangeDays)?.label}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-[var(--text-muted)]">USD</div>
              <div className="tabular text-xl font-semibold">{money(rangeTotals.USD, 'USD')}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--text-muted)]">LRD</div>
              <div className="tabular text-xl font-semibold">{money(rangeTotals.LRD, 'LRD')}</div>
            </div>
          </div>
          <div className="mt-3 border-t border-[var(--gridline)] pt-3">
            <div className="text-xs font-medium text-[var(--text-muted)]">
              All-time running total <span className="text-[var(--text-secondary)]">— every day's revenue added on top of the last</span>
            </div>
            <div className="tabular mt-1 text-sm font-semibold">
              {money(allTimeTotals.USD, 'USD')} + {money(allTimeTotals.LRD, 'LRD')}
            </div>
            <div className="tabular mt-1 text-xs text-[var(--text-muted)]">
              ≈ {money(blendedUsd, 'USD')} blended at L${rate}/$1
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Actual drawer cash</h2>
          {latestCount ? (
            <div className="mb-3 text-sm">
              <div className="tabular font-semibold">
                {money(latestCount.usdActual, 'USD')} + {money(latestCount.lrdActual, 'LRD')}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Counted {format(latestCount.timestamp, 'MMM d, h:mm a')}{latestCount.note ? ` — ${latestCount.note}` : ''}
              </div>
              <div className="tabular mt-1 text-xs">
                <span className={latestCount.usdActual - allTimeTotals.USD < 0 ? 'text-[var(--status-critical)]' : 'text-[var(--status-good)]'}>
                  {latestCount.usdActual - allTimeTotals.USD >= 0 ? '+' : ''}
                  {money(latestCount.usdActual - allTimeTotals.USD, 'USD')}
                </span>
                {' · '}
                <span className={latestCount.lrdActual - allTimeTotals.LRD < 0 ? 'text-[var(--status-critical)]' : 'text-[var(--status-good)]'}>
                  {latestCount.lrdActual - allTimeTotals.LRD >= 0 ? '+' : ''}
                  {money(latestCount.lrdActual - allTimeTotals.LRD, 'LRD')}
                </span>
                {' vs all-time ledger total'}
              </div>
            </div>
          ) : (
            <p className="mb-3 text-sm text-[var(--text-muted)]">No drawer count logged yet.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">USD in drawer</span>
              <input type="number" min={0} step="0.01" className={inputClass + ' w-28'} value={usdActual} onChange={(e) => setUsdActual(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">LRD in drawer</span>
              <input type="number" min={0} step="0.01" className={inputClass + ' w-28'} value={lrdActual} onChange={(e) => setLrdActual(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Note (optional)</span>
              <input placeholder="e.g. exchanged $10 for change" className={inputClass} value={countNote} onChange={(e) => setCountNote(e.target.value)} />
            </div>
            <Button onClick={saveDrawerCount}>Log count</Button>
          </div>
        </Card>
      </div>

      {(sales?.length ?? 0) === 0 && (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            No {currency} sales recorded in this range yet. Record a few sales to see patterns here.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Top selling items — by quantity</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--gridline)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), 'Units sold']} cursor={{ fill: 'var(--page-plane)' }} />
                <Bar dataKey="qty" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {topItems.length === 0 && <p className="text-sm text-[var(--text-muted)]">No data yet.</p>}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Top customers — by amount paid</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomers} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--gridline)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                />
                <YAxis
                  type="category"
                  dataKey="customer"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'var(--page-plane)' }}
                  formatter={(v, _name, item) => [
                    `${money(Number(v), currency)} · ${item.payload.qty} item${item.payload.qty === 1 ? '' : 's'}`,
                    'Paid',
                  ]}
                />
                <Bar dataKey="paid" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {topCustomers.length === 0 && <p className="text-sm text-[var(--text-muted)]">No data yet.</p>}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">
            Busiest time of day{peakHour && peakHour.count > 0 ? ` — peak around ${peakHour.hour}` : ''}
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byHour} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--gridline)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} interval={2} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), 'Sales']} cursor={{ fill: 'var(--page-plane)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={14}>
                  {byHour.map((h, i) => (
                    <Cell key={i} fill={peakHour && h.hour === peakHour.hour && h.count > 0 ? 'var(--series-1)' : 'var(--baseline)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">
            Busiest day of week{peakDay && peakDay.count > 0 ? ` — peak on ${peakDay.day}` : ''}
          </h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--gridline)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [String(v), 'Sales']} cursor={{ fill: 'var(--page-plane)' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {byDay.map((d, i) => (
                    <Cell key={i} fill={peakDay && d.day === peakDay.day && d.count > 0 ? 'var(--series-1)' : 'var(--baseline)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <p className="text-xs text-[var(--text-muted)]">
          Note: since this is an offline store, "busiest time" here is based on when sales were recorded, not
          separate foot-traffic/visitor data — there's no way to track people who browsed but didn't buy without a
          door counter or POS-linked sensor.
        </p>
      </Card>
    </div>
  )
}
