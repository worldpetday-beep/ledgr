import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  profitOf,
  EXCHANGE_RATE_KEY,
  DEFAULT_EXCHANGE_RATE,
  BRANCHES_KEY,
  DEFAULT_BRANCHES,
  type Currency,
} from '../db'
import { Card, Badge, BottomSheet, Field, Button, inputClass } from '../components/ui'
import { AlertIcon, SettingsIcon, PlusIcon, TrashIcon } from '../components/icons'
import { money, dateKeyMonrovia, isLowStock, selectOnFocus } from '../lib/format'
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

export default function Numbers() {
  const [filter, setFilter] = useState<DateFilter>('today')
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [trendCurrency, setTrendCurrency] = useState<Currency>('USD')
  const [setupOpen, setSetupOpen] = useState(false)

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
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Numbers</h1>
            <p className="truncate text-sm text-[var(--text-secondary)]">{label}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Net Profit</div>
              <div className="tabular text-sm font-bold" style={{ color: '#1a7f37' }}>
                {money(netProfit.usd, 'USD')} + {money(netProfit.lrd, 'LRD')}
              </div>
            </div>
            <button
              onClick={() => setSetupOpen(true)}
              aria-label="Setup"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
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

      {setupOpen && <SetupSheet onClose={() => setSetupOpen(false)} />}
    </div>
  )
}

// Everything the app already lets you configure, in one place: exchange
// rate, branches (editable/addable), categories, and backup/restore --
// folded in here since Numbers absorbed the old standalone Settings tab.
function SetupSheet({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [])
  const [newCategory, setNewCategory] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rateRow = useLiveQuery(() => db.settings.get(EXCHANGE_RATE_KEY), [])
  const [rateInput, setRateInput] = useState<string | null>(null)
  const rateValue = rateInput ?? rateRow?.value ?? String(DEFAULT_EXCHANGE_RATE)

  const branchesRow = useLiveQuery(() => db.settings.get(BRANCHES_KEY), [])
  const branches = useMemo<string[]>(() => {
    if (!branchesRow) return DEFAULT_BRANCHES
    try {
      const parsed = JSON.parse(branchesRow.value)
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BRANCHES
    } catch {
      return DEFAULT_BRANCHES
    }
  }, [branchesRow])
  const [newBranch, setNewBranch] = useState('')

  async function saveRate(value: string) {
    setRateInput(value)
    const num = Number(value)
    if (num > 0) await db.settings.put({ key: EXCHANGE_RATE_KEY, value: String(num) })
  }

  async function saveBranches(next: string[]) {
    await db.settings.put({ key: BRANCHES_KEY, value: JSON.stringify(next) })
  }

  function addBranch() {
    const name = newBranch.trim()
    if (!name || branches.includes(name)) return
    saveBranches([...branches, name])
    setNewBranch('')
  }

  function removeBranch(name: string) {
    if (branches.length <= 1) return
    saveBranches(branches.filter((b) => b !== name))
  }

  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    const exists = await db.categories.where('name').equalsIgnoreCase(name).first()
    if (!exists) await db.categories.add({ name })
    setNewCategory('')
  }

  async function removeCategory(id: number) {
    await db.categories.delete(id)
  }

  async function exportBackup() {
    const [products, variants, sales, cats, transfers, drawerCounts, warehouseLedger, abbreviations, customUnits] = await Promise.all([
      db.products.toArray(),
      db.variants.toArray(),
      db.sales.toArray(),
      db.categories.toArray(),
      db.stockTransfers.toArray(),
      db.drawerCounts.toArray(),
      db.warehouseLedger.toArray(),
      db.abbreviations.toArray(),
      db.customUnits.toArray(),
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      products,
      variants,
      sales,
      categories: cats,
      stockTransfers: transfers,
      drawerCounts,
      warehouseLedger,
      abbreviations,
      customUnits,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledgr-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Backup downloaded.')
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await db.transaction('rw', db.products, db.variants, db.sales, db.categories, db.stockTransfers, async () => {
        const productIdMap = new Map<number, number>()
        if (Array.isArray(data.products)) {
          for (const product of data.products) {
            const { id, image, ...rest } = product
            const newId = (await db.products.add({ archived: false, description: '', images: [], options: [], ...rest })) as number
            if (id != null) productIdMap.set(id, newId)
          }
        }
        const variantIdMap = new Map<number, number>()
        if (Array.isArray(data.variants)) {
          for (const variant of data.variants) {
            const { id, productId, ...rest } = variant
            const newProductId = productIdMap.get(productId) ?? productId
            const newId = (await db.variants.add({ optionValues: [], ...rest, productId: newProductId })) as number
            if (id != null) variantIdMap.set(id, newId)
          }
        }
        if (Array.isArray(data.sales)) {
          for (const sale of data.sales) {
            const { id, productId, variantId, ...rest } = sale
            await db.sales.add({
              ...rest,
              productId: productId != null ? productIdMap.get(productId) ?? productId : undefined,
              variantId: variantId != null ? variantIdMap.get(variantId) ?? variantId : undefined,
            })
          }
        }
        if (Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const exists = await db.categories.where('name').equalsIgnoreCase(cat.name).first()
            if (!exists) await db.categories.add({ name: cat.name, allowedUnits: cat.allowedUnits })
          }
        }
        if (Array.isArray(data.stockTransfers)) {
          for (const transfer of data.stockTransfers) {
            const { id, productId, variantId, ...rest } = transfer
            await db.stockTransfers.add({
              ...rest,
              productId: productId != null ? productIdMap.get(productId) ?? productId : productId,
              variantId: variantId != null ? variantIdMap.get(variantId) ?? variantId : variantId,
            })
          }
        }
      })
      setStatus('Backup imported successfully.')
    } catch {
      setStatus('Could not read that file — make sure it is a Ledgr backup JSON.')
    }
  }

  return (
    <BottomSheet open onClose={onClose}>
      <div className="flex flex-col gap-4 pt-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Setup</h2>

        <div>
          <Field label="Exchange rate (L$ per $1)">
            <input
              type="number"
              min={1}
              step="1"
              className={inputClass + ' w-40'}
              value={rateValue}
              onFocus={selectOnFocus}
              onChange={(e) => saveRate(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Branches</div>
          <div className="mb-2 flex flex-wrap gap-2">
            {branches.map((b) => (
              <span key={b} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--page-plane)] px-3 py-1 text-xs font-medium">
                {b}
                {branches.length > 1 && (
                  <button onClick={() => removeBranch(b)} className="text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Remove branch">
                    <TrashIcon className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="New branch name"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addBranch()}
            />
            <Button onClick={addBranch}>
              <PlusIcon className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Categories</div>
          <div className="mb-2 flex flex-wrap gap-2">
            {(categories ?? []).map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--page-plane)] px-3 py-1 text-xs font-medium">
                {c.name}
                <button onClick={() => c.id && removeCategory(c.id)} className="text-[var(--text-muted)] hover:text-[var(--status-critical)]" aria-label="Remove">
                  <TrashIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
            {(categories ?? []).length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">No custom categories yet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="New category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            />
            <Button onClick={addCategory}>
              <PlusIcon className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Backup</div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportBackup}>Export backup (.json)</Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Import backup
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importBackup(file)
                e.target.value = ''
              }}
            />
          </div>
          {status && <p className="mt-2 text-xs text-[var(--text-muted)]">{status}</p>}
        </div>
      </div>
    </BottomSheet>
  )
}
