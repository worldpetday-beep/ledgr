import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, profitOf, type Sale } from '../db'
import { ShopifyShell, ShopifyHeaderIconButton, shopifyInputClass, shopifyChipClass, shopifyCardClass } from '../components/ShopifyShell'
import { PlusIcon, EditIcon, SearchIcon, MoreVerticalIcon, BoxesIcon, ScanIcon } from '../components/icons'
import { DaybookRow } from '../components/DaybookRow'
import { LedgerScanView } from '../components/LedgerScan'
import { WarehouseLedgerView } from '../components/WarehouseLedger'
import { InvoicePopup } from '../components/InvoicePopup'
import { BottomSheet, Field } from '../components/ui'
import { useAppActions } from '../context/AppActions'
import { money, dateKeyMonrovia, formatDateMonrovia, formatShortDateMonrovia, formatTimeMonrovia, selectOnFocus } from '../lib/format'
import { lrdAmountOf, usdAmountOf, customerLabelOf, deleteSaleLine, markSalePickedUp, withoutVoided } from '../lib/salesLedger'

type FilterTab = 'all' | 'tbs'

type DateFilter = 'today' | 'yesterday' | 'last3' | 'last7' | 'last30' | 'all'

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last3', label: 'Last 3 days' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

const DAY_MS = 24 * 60 * 60 * 1000

// The Book Tab used to be a separate "archive" screen for past days --
// folded directly into the Orders tab instead (Shopify-orders-page style):
// one list, a date-range dropdown instead of a hard "today only" cutoff,
// and every order (today or years back) opens through the same edit sheet.
function allowedDateKeysFor(filter: DateFilter): Set<string> | null {
  if (filter === 'all') return null
  if (filter === 'today') return new Set([dateKeyMonrovia(Date.now())])
  if (filter === 'yesterday') return new Set([dateKeyMonrovia(Date.now() - DAY_MS)])
  const spanDays = filter === 'last3' ? 3 : filter === 'last7' ? 7 : 30
  const set = new Set<string>()
  for (let i = 0; i < spanDays; i++) set.add(dateKeyMonrovia(Date.now() - i * DAY_MS))
  return set
}

interface OrderGroup {
  orderNumber: number
  timestamp: number
  customerNumber: number
  customerName?: string
  lines: Sale[]
  anyTbs: boolean
}

function statusBadge(text: string, tone: 'muted' | 'warning' | 'good') {
  const styles: Record<string, string> = {
    muted: 'bg-slate-100 text-slate-600',
    warning: 'bg-amber-100 text-amber-700',
    good: 'bg-green-100 text-green-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{text}</span>
}

export default function Sales() {
  const { openRecordSale } = useAppActions()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [warehouseLedgerOpen, setWarehouseLedgerOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')

  const todayKey = dateKeyMonrovia(Date.now())
  const allSalesRaw = useLiveQuery(() => db.sales.orderBy('timestamp').reverse().toArray(), [])
  const allSales = useMemo(() => withoutVoided(allSalesRaw ?? []), [allSalesRaw])
  // The end-of-day balance panel always reflects literal "today", independent
  // of whatever date range is currently selected for browsing/searching
  // orders above it.
  const todaySales = useMemo(() => allSales.filter((s) => dateKeyMonrovia(s.timestamp) === todayKey), [allSales, todayKey])

  const allowedDateKeys = useMemo(() => allowedDateKeysFor(dateFilter), [dateFilter])
  const rangeSales = useMemo(
    () => (allowedDateKeys ? allSales.filter((s) => allowedDateKeys.has(dateKeyMonrovia(s.timestamp))) : allSales),
    [allSales, allowedDateKeys],
  )

  const orders = useMemo(() => {
    const map = new Map<number, Sale[]>()
    for (const s of rangeSales) {
      const list = map.get(s.orderNumber) ?? []
      list.push(s)
      map.set(s.orderNumber, list)
    }
    const groups: OrderGroup[] = Array.from(map.entries()).map(([orderNumber, lines]) => ({
      orderNumber,
      timestamp: lines[0].timestamp,
      customerNumber: lines[0].customerNumber,
      customerName: lines.find((l) => l.customerName)?.customerName,
      lines,
      anyTbs: lines.some((l) => l.tbs),
    }))
    groups.sort((a, b) => b.timestamp - a.timestamp)
    return groups
  }, [rangeSales])

  const filteredOrders = useMemo(() => {
    let list = orders
    if (filterTab === 'tbs') list = list.filter((o) => o.anyTbs)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((o) => {
        if (customerLabelOf(o).toLowerCase().includes(q)) return true
        if (String(o.orderNumber).includes(q)) return true
        return o.lines.some((l) => l.itemName.toLowerCase().includes(q))
      })
    }
    return list
  }, [orders, filterTab, searchQuery])

  const ledgerSumUsd = useMemo(() => todaySales.reduce((s, l) => s + usdAmountOf(l), 0), [todaySales])
  const ledgerSumLrd = useMemo(() => todaySales.reduce((s, l) => s + lrdAmountOf(l), 0), [todaySales])

  // Net profit is an aggregate summary only — the underlying per-item cost
  // price itself is never shown on any individual daybook row.
  const netProfitUsd = useMemo(
    () => todaySales.filter((s) => s.currency === 'USD').reduce((s, l) => s + profitOf(l), 0),
    [todaySales],
  )
  const netProfitLrd = useMemo(
    () => todaySales.filter((s) => s.currency === 'LRD').reduce((s, l) => s + profitOf(l), 0),
    [todaySales],
  )

  const drawerCounts = useLiveQuery(() => db.drawerCounts.orderBy('timestamp').reverse().toArray(), [])
  const yesterdayClose = useMemo(() => (drawerCounts ?? []).find((d) => dateKeyMonrovia(d.timestamp) !== todayKey), [drawerCounts, todayKey])

  const [drawerUsd, setDrawerUsd] = useState('')
  const [drawerLrd, setDrawerLrd] = useState('')
  const [outboundUsd, setOutboundUsd] = useState('')
  const [outboundLrd, setOutboundLrd] = useState('')
  const [eodNote, setEodNote] = useState('')

  const finalHandCashUsd = (yesterdayClose?.usdActual ?? 0) + ledgerSumUsd - (Number(outboundUsd) || 0)
  const finalHandCashLrd = (yesterdayClose?.lrdActual ?? 0) + ledgerSumLrd - (Number(outboundLrd) || 0)

  async function logDayEndCount() {
    await db.drawerCounts.add({
      timestamp: Date.now(),
      usdActual: Number(drawerUsd) || 0,
      lrdActual: Number(drawerLrd) || 0,
      outboundUsd: Number(outboundUsd) || 0,
      outboundLrd: Number(outboundLrd) || 0,
      note: eodNote.trim() || undefined,
    })
    setDrawerUsd('')
    setDrawerLrd('')
    setOutboundUsd('')
    setOutboundLrd('')
    setEodNote('')
  }

  // Only the selected order NUMBER is kept in state — the order data itself
  // is looked up live from `orders` on every render, so edits made inside
  // the invoice popup (qty/price/etc.) are reflected immediately in its own
  // totals instead of showing a stale snapshot from when it was opened.
  const [invoiceOrderNumber, setInvoiceOrderNumber] = useState<number | null>(null)
  const invoiceOrder = useMemo(
    () => (invoiceOrderNumber != null ? orders.find((o) => o.orderNumber === invoiceOrderNumber) ?? null : null),
    [orders, invoiceOrderNumber],
  )

  // Daily sequential index (1 = the day's first order, chronologically) —
  // independent of the persisted, never-resetting order/ticket number, used
  // only for the invoice's "#N" display and default customer label.
  const dailyIndexByOrder = useMemo(() => {
    const chronological = [...orders].sort((a, b) => a.timestamp - b.timestamp)
    const map = new Map<number, number>()
    chronological.forEach((o, i) => map.set(o.orderNumber, i + 1))
    return map
  }, [orders])

  function startEdit(order: OrderGroup) {
    setEditingOrderNumber(order.orderNumber)
    setEditValue(order.customerName ?? '')
  }

  async function saveEdit(order: OrderGroup) {
    const name = editValue.trim() || undefined
    await db.transaction('rw', db.sales, async () => {
      for (const line of order.lines) {
        await db.sales.update(line.id!, { customerName: name })
      }
    })
    setEditingOrderNumber(null)
  }

  return (
    <ShopifyShell
      title="Sales"
      headerRight={
        <>
          <ShopifyHeaderIconButton onClick={openRecordSale} label="Record sale">
            <PlusIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
          <ShopifyHeaderIconButton onClick={() => setMoreMenuOpen(true)} label="More options">
            <MoreVerticalIcon className="h-5 w-5" />
          </ShopifyHeaderIconButton>
        </>
      }
    >
      <div className="flex max-w-full flex-col gap-4 overflow-x-hidden" style={{ boxSizing: 'border-box' }}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={shopifyInputClass + ' pl-9'}
            placeholder="Search orders, items, or customers"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {(['all', 'tbs'] as FilterTab[]).map((tab) => (
              <button key={tab} onClick={() => setFilterTab(tab)} className={shopifyChipClass(filterTab === tab)}>
                {tab === 'all' ? 'All' : 'TBS'}
              </button>
            ))}
          </div>
          <select
            className={shopifyInputClass + ' ml-auto w-auto shrink-0 py-1.5 pr-7 text-xs font-semibold'}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            aria-label="Date range"
          >
            {DATE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="px-1 text-xs font-semibold text-slate-500">
          {dateFilter === 'today' ? `${formatDateMonrovia(Date.now())} — today's ledger` : DATE_FILTER_OPTIONS.find((o) => o.value === dateFilter)?.label}
        </div>

        <div className="flex flex-col gap-3">
          {filteredOrders.map((order) => {
            const label = customerLabelOf(order)
            const itemCount = order.lines.length
            const anyPendingPickup = order.lines.some((l) => l.tbs && !l.pickedUp)
            const anyPickedUp = order.lines.some((l) => l.tbs && l.pickedUp)

            return (
              <div key={order.orderNumber} className={shopifyCardClass}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-slate-500">
                    <span className="shrink-0 font-semibold text-slate-900">#{order.orderNumber}</span>
                    {editingOrderNumber === order.orderNumber ? (
                      <input
                        autoFocus
                        className={shopifyInputClass + ' w-32 shrink-0 py-1 text-xs'}
                        value={editValue}
                        placeholder={`Customer ${String(order.customerNumber).padStart(3, '0')}`}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(order)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(order)}
                      />
                    ) : (
                      <>
                        <span className="min-w-0 truncate">· {label}</span>
                        <button onClick={() => startEdit(order)} className="shrink-0 text-slate-400 hover:text-slate-900" aria-label="Rename customer">
                          <EditIcon className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="shrink-0 text-xs text-slate-400">
                    {dateKeyMonrovia(order.timestamp) !== todayKey && `${formatShortDateMonrovia(order.timestamp)} · `}
                    {formatTimeMonrovia(order.timestamp)}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap gap-1.5">
                  {!order.anyTbs && statusBadge('Delivered', 'muted')}
                  {anyPendingPickup && statusBadge('TBS — awaiting pickup', 'warning')}
                  {anyPickedUp && !anyPendingPickup && statusBadge('Picked up', 'good')}
                  <span className="text-xs text-slate-400">
                    {itemCount} item{itemCount === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-1.5 divide-y divide-slate-100">
                  {order.lines.map((line) => (
                    <DaybookRow
                      key={line.id}
                      sale={line}
                      onEdit={() => setInvoiceOrderNumber(order.orderNumber)}
                      onDelete={() => deleteSaleLine(line)}
                      onMarkPickedUp={() => markSalePickedUp(line)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          {filteredOrders.length === 0 && (
            <div className={shopifyCardClass}>
              <p className="py-8 text-center text-sm text-slate-500">
                No sales recorded today yet. Tap the + above to add your first one.
              </p>
            </div>
          )}
        </div>

        <div className={shopifyCardClass}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">End-of-day balance</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <div className="text-slate-500">Ledger sales — USD</div>
            <div className="tabular text-right font-semibold text-slate-900">{money(ledgerSumUsd, 'USD')}</div>
            <div className="text-slate-500">Ledger sales — LRD</div>
            <div className="tabular text-right font-semibold text-slate-900">{money(ledgerSumLrd, 'LRD')}</div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2 text-sm">
            <div className="text-slate-500">Net profit — USD</div>
            <div className="tabular text-right font-semibold text-green-700">{money(netProfitUsd, 'USD')}</div>
            <div className="text-slate-500">Net profit — LRD</div>
            <div className="tabular text-right font-semibold text-green-700">{money(netProfitLrd, 'LRD')}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Drawer cash — USD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={drawerUsd}
                onFocus={selectOnFocus}
                onChange={(e) => setDrawerUsd(e.target.value)}
              />
            </Field>
            <Field label="Drawer cash — LRD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={drawerLrd}
                onFocus={selectOnFocus}
                onChange={(e) => setDrawerLrd(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Outbound — USD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={outboundUsd}
                onFocus={selectOnFocus}
                onChange={(e) => setOutboundUsd(e.target.value)}
              />
            </Field>
            <Field label="Outbound — LRD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={shopifyInputClass}
                value={outboundLrd}
                onFocus={selectOnFocus}
                onChange={(e) => setOutboundLrd(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="text-slate-500">Final hand cash — USD</div>
              <div className="tabular text-right text-base font-bold text-slate-900">{money(finalHandCashUsd, 'USD')}</div>
              <div className="text-slate-500">Final hand cash — LRD</div>
              <div className="tabular text-right text-base font-bold text-slate-900">{money(finalHandCashLrd, 'LRD')}</div>
            </div>
            {yesterdayClose && (
              <p className="mt-2 text-xs text-slate-400">
                Carries forward {money(yesterdayClose.usdActual, 'USD')} + {money(yesterdayClose.lrdActual, 'LRD')} counted on{' '}
                {formatDateMonrovia(yesterdayClose.timestamp)}.
              </p>
            )}
          </div>

          <input
            className={shopifyInputClass + ' mt-3'}
            placeholder="Note (optional)"
            value={eodNote}
            onChange={(e) => setEodNote(e.target.value)}
          />
          <button onClick={logDayEndCount} className="mt-3 w-full rounded-lg bg-black py-2.5 text-sm font-semibold text-white">
            Log day-end count
          </button>
        </div>
      </div>

      <BottomSheet open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} contentClassName="!bg-white !text-slate-900">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="px-1 pb-2 text-sm font-semibold text-slate-500">More options</h2>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setScanOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            <ScanIcon className="h-5 w-5 text-slate-500" />
            Upload Ledger Image
          </button>
          <button
            onClick={() => {
              setMoreMenuOpen(false)
              setWarehouseLedgerOpen(true)
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            <BoxesIcon className="h-5 w-5 text-slate-500" />
            Warehouse Ledger
          </button>
        </div>
      </BottomSheet>

      {scanOpen && <LedgerScanView onClose={() => setScanOpen(false)} />}
      {warehouseLedgerOpen && <WarehouseLedgerView onClose={() => setWarehouseLedgerOpen(false)} />}
      <InvoicePopup
        order={invoiceOrder}
        dailyIndex={invoiceOrder ? dailyIndexByOrder.get(invoiceOrder.orderNumber) ?? 1 : 1}
        onClose={() => setInvoiceOrderNumber(null)}
      />
    </ShopifyShell>
  )
}
